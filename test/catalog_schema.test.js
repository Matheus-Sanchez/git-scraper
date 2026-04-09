import assert from 'node:assert/strict';
import test from 'node:test';
import { ZodError } from 'zod';
import {
  parseStoredProducts,
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

test('parseStoredProduct strips invalid css selectors and keeps valid ones', () => {
  const product = parseStoredProduct({
    id: 'produto-a',
    name: 'Produto A',
    url: 'https://example.com/a',
    is_active: true,
    selectors: {
      price_css: ['.price', '"a-offscreen"', 'h4 class="broken"'],
      jsonld_paths: ['offers.price'],
    },
  });

  assert.deepEqual(product.selectors, {
    price_css: ['.price'],
    jsonld_paths: ['offers.price'],
  });
});

test('parseStoredProduct normalizes url, parses numeric fields and strips empty optionals', () => {
  const product = parseStoredProduct({
    id: 'produto-a',
    name: 'Produto A',
    url: 'https://example.com/produto?utm_source=mail&b=2&a=1#fragmento',
    category: 'hardware',
    comparison_key: 'monitor-25',
    units_per_package: '2',
    is_active: true,
    selectors: {
      price_css: ['.price'],
      jsonld_paths: [],
      regex_hints: [],
    },
    notes: '   ',
  });

  assert.equal(product.url, 'https://example.com/produto?a=1&b=2');
  assert.equal(product.units_per_package, 2);
  assert.deepEqual(product.selectors, {
    price_css: ['.price'],
  });
  assert.equal('notes' in product, false);
});

test('parseStoredProducts validates product arrays with normalized entries', () => {
  const products = parseStoredProducts([
    {
      id: 'produto-a',
      name: 'Produto A',
      url: 'https://example.com/a',
      is_active: true,
    },
    {
      id: 'produto-b',
      name: 'Produto B',
      url: 'https://example.com/b?utm_campaign=teste',
      units_per_package: 3,
      is_active: false,
    },
  ]);

  assert.equal(products.length, 2);
  assert.equal(products[1].url, 'https://example.com/b');
  assert.equal(products[1].units_per_package, 3);
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

test('validateNormalizedMutation normalizes url and strips empty selector collections', () => {
  const payload = validateNormalizedMutation({
    action: 'add',
    name: 'Produto A',
    url: 'https://example.com/produto?utm_source=mail&z=2&a=1',
    units_per_package: '6',
    selectors: {
      price_css: ['.price'],
      jsonld_paths: [],
      regex_hints: [],
    },
  });

  assert.equal(payload.url, 'https://example.com/produto?a=1&z=2');
  assert.equal(payload.units_per_package, 6);
  assert.deepEqual(payload.selectors, {
    price_css: ['.price'],
  });
});
