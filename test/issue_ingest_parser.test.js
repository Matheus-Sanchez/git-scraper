import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectDuplicate,
  mutateProducts,
  normalizeAction,
  parseIssuePayload,
  validateAndBuildProduct,
} from '../.github/scripts/ingest_issue.mjs';

test('parseIssuePayload parses JSON code blocks', () => {
  const body = [
    '## Manage Product',
    '```json',
    '{"action":"add","name":"Cafe Teste","url":"https://example.com/p/1","is_active":true}',
    '```',
  ].join('\n');

  const parsed = parseIssuePayload(body);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.payload.action, 'add');
  assert.equal(parsed.payload.name, 'Cafe Teste');
});

test('parseIssuePayload parses issue form fields with action', () => {
  const body = [
    '### Acao',
    'edit',
    '',
    '### ID do produto',
    'cafe-1',
    '',
    '### Nome do produto',
    'Cafe Especial 500g',
    '',
    '### URL do produto',
    'https://example.com/cafe',
  ].join('\n');

  const parsed = parseIssuePayload(body);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.payload.action, 'edit');
  assert.equal(parsed.payload.product_id, 'cafe-1');
});

test('normalizeAction accepts aliases', () => {
  assert.equal(normalizeAction('adicionar'), 'add');
  assert.equal(normalizeAction('editar'), 'edit');
  assert.equal(normalizeAction('remove'), 'remove');
  assert.equal(normalizeAction('???'), 'invalid');
});

test('validateAndBuildProduct rejects invalid URL', () => {
  const result = validateAndBuildProduct({
    name: 'Produto Invalido',
    url: 'javascript:alert(1)',
  });
  assert.equal(result.ok, false);
});

test('detectDuplicate identifies same URL after normalization', () => {
  const existing = [
    { id: 'p1', name: 'A', url: 'https://example.com/item?utm_source=abc', is_active: true },
  ];

  const candidateResult = validateAndBuildProduct({
    name: 'Novo Nome',
    url: 'https://example.com/item',
    is_active: true,
  });

  assert.equal(candidateResult.ok, true);
  const duplicate = detectDuplicate(existing, candidateResult.product);
  assert.equal(duplicate?.id, 'p1');
});

test('mutateProducts can add product', () => {
  const result = mutateProducts([], {
    action: 'add',
    name: 'Produto X',
    url: 'https://example.com/x',
    category: 'teste',
    is_active: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].name, 'Produto X');
});

test('mutateProducts can edit product by id', () => {
  const products = [
    {
      id: 'produto-a',
      name: 'Produto A',
      url: 'https://example.com/a',
      category: 'cat-a',
      is_active: true,
      selectors: { price_css: ['.price'] },
    },
  ];

  const result = mutateProducts(products, {
    action: 'edit',
    product_id: 'produto-a',
    name: 'Produto A Atualizado',
    category: 'cat-b',
  });

  assert.equal(result.ok, true);
  assert.equal(result.products[0].name, 'Produto A Atualizado');
  assert.equal(result.products[0].category, 'cat-b');
  assert.equal(result.products[0].id, 'produto-a');
});

test('mutateProducts can remove product by id', () => {
  const products = [
    { id: 'produto-a', name: 'Produto A', url: 'https://example.com/a', is_active: true },
    { id: 'produto-b', name: 'Produto B', url: 'https://example.com/b', is_active: true },
  ];

  const result = mutateProducts(products, {
    action: 'remove',
    product_id: 'produto-a',
  });

  assert.equal(result.ok, true);
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].id, 'produto-b');
});
