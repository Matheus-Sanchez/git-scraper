import assert from 'node:assert/strict';
import test from 'node:test';
import { supportMatrix } from '../src/config/support_matrix.js';
import {
  parseSmokeProductIds,
  selectSmokeProducts,
  summarizeSmokeRun,
} from '../src/smoke/real.js';

test('support matrix keeps smoke real restricted to dedicated validated stores', () => {
  const smokeEnabledStores = supportMatrix.filter((entry) => entry.smoke_real);

  assert.deepEqual(
    smokeEnabledStores.map((entry) => [entry.store, entry.support_level, entry.adapter]),
    [
      ['Amazon', 'dedicated_validated', 'amazon'],
      ['KaBuM', 'dedicated_validated', 'kabum'],
      ['Mercado Livre', 'dedicated_validated', 'mercadolivre'],
      ['Magalu', 'dedicated_validated', 'magalu'],
      ['Shopee', 'dedicated_validated', 'shopee'],
      ['Pichau', 'dedicated_validated', 'pichau'],
      ['Petz', 'dedicated_validated', 'petz'],
    ],
  );
});

test('parseSmokeProductIds normalizes comma-separated product identifiers', () => {
  assert.deepEqual(
    parseSmokeProductIds(' amazon-1, kabum-1 , amazon-1 ,, '),
    ['amazon-1', 'kabum-1'],
  );
});

test('selectSmokeProducts keeps only active products from smoke-enabled stores', () => {
  const selected = selectSmokeProducts([
    {
      id: 'intent-all-stores',
      name: 'Produto multi loja',
      stores: ['amazon', 'kabum', 'mercadolivre', 'magalu', 'shopee', 'pichau', 'petz'],
      is_active: true,
    },
    {
      id: 'intent-inactive',
      name: 'Produto inativo',
      stores: ['amazon'],
      is_active: false,
    },
  ], {
    maxProductsPerStore: 1,
  });

  assert.deepEqual(
    selected.map((product) => [product.id, product.smoke_store]),
    [
      ['intent-all-stores-amazon', 'Amazon'],
      ['intent-all-stores-kabum', 'KaBuM'],
      ['intent-all-stores-mercadolivre', 'Mercado Livre'],
      ['intent-all-stores-magalu', 'Magalu'],
      ['intent-all-stores-shopee', 'Shopee'],
      ['intent-all-stores-pichau', 'Pichau'],
      ['intent-all-stores-petz', 'Petz'],
    ],
  );
});

test('selectSmokeProducts respects explicit product ids', () => {
  const selected = selectSmokeProducts([
    {
      id: 'intent-1',
      name: 'Produto 1',
      stores: ['amazon'],
      is_active: true,
    },
    {
      id: 'intent-2',
      name: 'Produto 2',
      stores: ['kabum'],
      is_active: true,
    },
  ], {
    productIds: ['intent-2'],
  });

  assert.deepEqual(selected.map((product) => product.id), ['intent-2-kabum']);
});

test('summarizeSmokeRun fails stores that only carried forward or errored', () => {
  const selectedProducts = [
    {
      id: 'amazon-1',
      name: 'Amazon 1',
      is_active: true,
      smoke_store: 'Amazon',
      smoke_support_level: 'dedicated_validated',
    },
    {
      id: 'kabum-1',
      name: 'Kabum 1',
      is_active: true,
      smoke_store: 'KaBuM',
      smoke_support_level: 'dedicated_validated',
    },
  ];

  const summary = summarizeSmokeRun({
    selectedProducts,
    latestPayload: {
      items: [
        {
          product_id: 'amazon-1',
          status: 'ok',
          engine_used: 'lightpanda_search',
        },
        {
          product_id: 'kabum-1',
          status: 'carried_forward',
          engine_used: 'carry_forward',
        },
      ],
      failures: [
        {
          product_id: 'kabum-1',
          error_code: 'captcha_or_block',
        },
      ],
    },
  });

  assert.equal(summary.ok, false);
  assert.equal(summary.overall_status, 'fail');
  assert.deepEqual(
    summary.store_results.map((entry) => [entry.store, entry.status, entry.direct_success_count, entry.carried_forward_count]),
    [
      ['Amazon', 'pass', 1, 0],
      ['KaBuM', 'fail', 0, 1],
    ],
  );
});
