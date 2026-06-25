import assert from 'node:assert/strict';
import test from 'node:test';
import { ZodError } from 'zod';
import {
  generateRequiredTerms,
  parseStoredProduct,
  parseStoredProducts,
  validateNormalizedMutation,
} from '../src/schema/catalog.js';

test('parseStoredProduct rejects URL-based legacy fields', () => {
  assert.throws(() => {
    parseStoredProduct({
      id: 'produto-a',
      name: 'Produto A',
      url: 'https://example.com/a',
      is_active: true,
    });
  }, ZodError);

  assert.throws(() => {
    parseStoredProduct({
      id: 'produto-a',
      name: 'Produto A',
      selectors: { price_css: ['.price'] },
      is_active: true,
    });
  }, ZodError);
});

test('parseStoredProduct normalizes search intent defaults', () => {
  const product = parseStoredProduct({
    id: 'memoria-ddr4',
    name: 'Memória RAM',
    characteristics: 'DDR4 16GB 3200MHz',
    category: 'Hardware e PC',
    is_active: true,
  });

  assert.equal(product.category, 'hardware-e-pc');
  assert.equal(product.characteristics, 'DDR4 16GB 3200MHz');
  assert.deepEqual(product.required_terms, ['memoria', 'ram']);
  assert.deepEqual(product.preferred_terms, []);
  assert.deepEqual(product.excluded_terms, []);
  assert.ok(product.stores.includes('amazon'));
  assert.ok(product.stores.includes('kabum'));
});

test('parseStoredProduct accepts required and preferred attributes', () => {
  const product = parseStoredProduct({
    id: 'fralda-g',
    name: 'Fralda',
    characteristics: 'tamanho G',
    required_attributes: { size: 'G' },
    unit_rule: { basis: 'unit', label: 'fralda' },
    is_active: true,
  });

  assert.deepEqual(product.required_attributes, { size: 'G' });
  assert.deepEqual(product.unit_rule, { basis: 'unit', label: 'fralda' });
});

test('parseStoredProducts validates product arrays with normalized entries', () => {
  const products = parseStoredProducts([
    {
      id: 'produto-a',
      name: 'Produto A',
      characteristics: 'Teste',
      stores: ['amazon', 'kabum'],
      is_active: true,
    },
    {
      id: 'produto-b',
      name: 'Produto B',
      is_active: false,
    },
  ]);

  assert.equal(products.length, 2);
  assert.deepEqual(products[0].stores, ['amazon', 'kabum']);
});

test('validateNormalizedMutation rejects unexpected legacy fields', () => {
  assert.throws(() => {
    validateNormalizedMutation({
      action: 'add',
      name: 'Produto A',
      url: 'https://example.com/a',
    });
  }, ZodError);
});

test('validateNormalizedMutation accepts priority fields', () => {
  const payload = validateNormalizedMutation({
    action: 'add',
    name: 'Memória RAM',
    characteristics: 'DDR4 16GB',
    stores: 'amazon,kabum',
    required_attributes: { memory_type: 'ddr4' },
    preferred_attributes: { capacity_total_gb: 16 },
    unit_rule: { basis: 'gb' },
  });

  assert.deepEqual(payload.stores, ['amazon', 'kabum']);
  assert.deepEqual(payload.required_attributes, { memory_type: 'ddr4' });
  assert.deepEqual(payload.preferred_attributes, { capacity_total_gb: 16 });
  assert.deepEqual(payload.unit_rule, { basis: 'gb', label: 'gb' });
});

test('generateRequiredTerms removes stopwords and preserves useful tokens', () => {
  assert.deepEqual(
    generateRequiredTerms('Pacote de fralda para bebê tamanho G'),
    ['pacote', 'fralda', 'bebe', 'tamanho'],
  );
});
