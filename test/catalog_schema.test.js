import assert from 'node:assert/strict';
import test from 'node:test';
import { ZodError } from 'zod';
import {
  parseStoredProduct,
  validateNormalizedMutation,
} from '../src/schema/catalog.js';

test('parseStoredProduct rejects malformed selector arrays', () => {
  assert.throws(() => {
    parseStoredProduct({
      id: 'produto-a',
      name: 'Produto A',
      url: 'https://example.com/a',
      is_active: true,
      selectors: {
        price_css: '.price',
      },
    });
  }, ZodError);
});

test('validateNormalizedMutation rejects unexpected fields', () => {
  assert.throws(() => {
    validateNormalizedMutation({
      action: 'add',
      name: 'Produto A',
      url: 'https://example.com/a',
      is_active: true,
      selectors: {
        price_css: ['.price'],
      },
      rogue_field: 'nope',
    });
  }, ZodError);
});

test('validateNormalizedMutation accepts typed selector arrays', () => {
  const payload = validateNormalizedMutation({
    action: 'edit',
    product_id: 'produto-a',
    selectors: {
      price_css: ['.price', '[data-price]'],
      jsonld_paths: ['offers.price'],
      regex_hints: ['R\\$\\s*\\d+,\\d{2}'],
    },
  });

  assert.deepEqual(payload.selectors.price_css, ['.price', '[data-price]']);
  assert.deepEqual(payload.selectors.jsonld_paths, ['offers.price']);
});
