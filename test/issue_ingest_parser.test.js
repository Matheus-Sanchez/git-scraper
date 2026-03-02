import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectDuplicate,
  parseIssuePayload,
  validateAndBuildProduct,
} from '../.github/scripts/ingest_issue.mjs';

test('parseIssuePayload parses JSON code blocks', () => {
  const body = [
    '## Add Product',
    '```json',
    '{"name":"Cafe Teste","url":"https://example.com/p/1","is_active":true}',
    '```',
  ].join('\n');

  const parsed = parseIssuePayload(body);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.payload.name, 'Cafe Teste');
  assert.equal(parsed.payload.url, 'https://example.com/p/1');
});

test('parseIssuePayload parses issue form sections', () => {
  const body = [
    '### Nome do produto',
    'Cafe Especial 500g',
    '',
    '### URL do produto',
    'https://example.com/cafe',
    '',
    '### Categoria',
    'mercado',
    '',
    '### Ativo para scraping?',
    'true',
  ].join('\n');

  const parsed = parseIssuePayload(body);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.payload.name, 'Cafe Especial 500g');
  assert.equal(parsed.payload.category, 'mercado');
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
    {
      id: 'p1',
      name: 'A',
      url: 'https://example.com/item?utm_source=abc',
      is_active: true,
    },
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
