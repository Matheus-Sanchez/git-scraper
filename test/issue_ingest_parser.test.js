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
    '{"action":"add","name":"Memoria RAM","characteristics":"DDR4 16GB","required_attributes":{"memory_type":"ddr4"}}',
    '```',
  ].join('\n');

  const parsed = parseIssuePayload(body);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.payload.action, 'add');
  assert.equal(parsed.payload.name, 'Memoria RAM');
});

test('parseIssuePayload parses issue form fields with priority attributes', () => {
  const body = [
    '### Acao',
    'add',
    '',
    '### Nome do produto',
    'Fralda',
    '',
    '### Caracteristicas',
    'tamanho G',
    '',
    '### Atributos obrigatorios',
    '{"size":"G"}',
    '',
    '### Unidade base',
    'unit',
  ].join('\n');

  const parsed = parseIssuePayload(body);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.payload.name, 'Fralda');
  assert.deepEqual(parsed.payload.required_attributes, { size: 'G' });
  assert.deepEqual(parsed.payload.unit_rule, { basis: 'unit' });
});

test('normalizeAction accepts aliases', () => {
  assert.equal(normalizeAction('adicionar'), 'add');
  assert.equal(normalizeAction('lote'), 'batch');
  assert.equal(normalizeAction('editar'), 'edit');
  assert.equal(normalizeAction('remove'), 'remove');
  assert.equal(normalizeAction('???'), 'invalid');
});

test('validateAndBuildProduct rejects URL payloads', () => {
  const result = validateAndBuildProduct({
    name: 'Produto Invalido',
    url: 'https://example.com/a',
  });
  assert.equal(result.ok, false);
});

test('detectDuplicate identifies same search intent', () => {
  const existing = [
    {
      id: 'memoria-a',
      name: 'Memoria RAM',
      characteristics: 'DDR4',
      category: 'hardware',
      is_active: true,
    },
  ];

  const candidateResult = validateAndBuildProduct({
    name: 'Memória RAM',
    characteristics: 'DDR4',
    category: 'hardware',
    is_active: true,
  });

  assert.equal(candidateResult.ok, true);
  const duplicate = detectDuplicate(existing, candidateResult.product);
  assert.equal(duplicate?.id, 'memoria-a');
});

test('mutateProducts can add search intent', () => {
  const result = mutateProducts([], {
    action: 'add',
    name: 'Memoria RAM',
    characteristics: 'DDR4 16GB',
    category: 'hardware',
    required_attributes: { memory_type: 'ddr4' },
    preferred_attributes: { capacity_total_gb: 16 },
    is_active: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].name, 'Memoria RAM');
  assert.deepEqual(result.products[0].required_attributes, { memory_type: 'ddr4' });
});

test('mutateProducts can edit intent by id', () => {
  const products = [
    {
      id: 'produto-a',
      name: 'Produto A',
      characteristics: 'A',
      category: 'cat-a',
      is_active: true,
    },
  ];

  const result = mutateProducts(products, {
    action: 'edit',
    product_id: 'produto-a',
    characteristics: 'Atualizado',
    preferred_terms: ['novo'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.products[0].characteristics, 'Atualizado');
  assert.deepEqual(result.products[0].preferred_terms, ['novo']);
});

test('mutateProducts can remove intent by id', () => {
  const products = [
    { id: 'produto-a', name: 'Produto A', is_active: true },
    { id: 'produto-b', name: 'Produto B', is_active: true },
  ];

  const result = mutateProducts(products, {
    action: 'remove',
    product_id: 'produto-a',
  });

  assert.equal(result.ok, true);
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].id, 'produto-b');
});

test('mutateProducts can apply batch add operations atomically', () => {
  const result = mutateProducts([], {
    action: 'batch',
    operations: [
      {
        action: 'add',
        name: 'Produto A',
        characteristics: 'A',
        category: 'hardware',
      },
      {
        action: 'add',
        name: 'Produto B',
        characteristics: 'B',
        category: 'hardware',
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.products.length, 2);
  assert.match(result.message, /Lote aplicado com sucesso/);
});

test('mutateProducts aborts batch when one operation fails', () => {
  const result = mutateProducts([], {
    action: 'batch',
    operations: [
      {
        action: 'add',
        name: 'Produto A',
      },
      {
        action: 'add',
        name: 'Produto Invalido',
        url: 'https://example.com/a',
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'invalid');
  assert.match(result.message, /Operacao 2\/2 falhou/);
});
