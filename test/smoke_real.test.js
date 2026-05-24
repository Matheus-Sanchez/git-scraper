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
      id: 'amazon-1',
      name: 'Amazon 1',
      url: 'https://www.amazon.com.br/dp/ABC',
      is_active: true,
    },
    {
      id: 'amazon-2',
      name: 'Amazon 2',
      url: 'https://www.amazon.com.br/dp/DEF',
      is_active: true,
    },
    {
      id: 'kabum-1',
      name: 'Kabum 1',
      url: 'https://www.kabum.com.br/produto/123',
      is_active: true,
    },
    {
      id: 'mercadolivre-1',
      name: 'Mercado Livre 1',
      url: 'https://www.mercadolivre.com.br/produto/p/MLB123',
      is_active: true,
    },
    {
      id: 'magalu-1',
      name: 'Magalu 1',
      url: 'https://www.magazineluiza.com.br/produto/p/abc123',
      is_active: true,
    },
    {
      id: 'shopee-1',
      name: 'Shopee 1',
      url: 'https://shopee.com.br/produto/123',
      is_active: true,
    },
    {
      id: 'pichau-1',
      name: 'Pichau 1',
      url: 'https://www.pichau.com.br/produto-gamer',
      is_active: true,
    },
    {
      id: 'petz-1',
      name: 'Petz 1',
      url: 'https://www.petz.com.br/produto/racao-123',
      is_active: true,
    },
    {
      id: 'amazon-inativo',
      name: 'Amazon Inativo',
      url: 'https://www.amazon.com.br/dp/GHI',
      is_active: false,
    },
  ], {
    maxProductsPerStore: 1,
  });

  assert.deepEqual(
    selected.map((product) => [product.id, product.smoke_store]),
    [
      ['amazon-1', 'Amazon'],
      ['kabum-1', 'KaBuM'],
      ['mercadolivre-1', 'Mercado Livre'],
      ['magalu-1', 'Magalu'],
      ['shopee-1', 'Shopee'],
      ['pichau-1', 'Pichau'],
      ['petz-1', 'Petz'],
    ],
  );
});

test('selectSmokeProducts respects explicit product ids', () => {
  const selected = selectSmokeProducts([
    {
      id: 'amazon-1',
      name: 'Amazon 1',
      url: 'https://www.amazon.com.br/dp/ABC',
      is_active: true,
    },
    {
      id: 'kabum-1',
      name: 'Kabum 1',
      url: 'https://www.kabum.com.br/produto/123',
      is_active: true,
    },
  ], {
    productIds: ['kabum-1'],
  });

  assert.deepEqual(selected.map((product) => product.id), ['kabum-1']);
});

test('summarizeSmokeRun fails stores that only carried forward or errored', () => {
  const selectedProducts = [
    {
      id: 'amazon-1',
      name: 'Amazon 1',
      url: 'https://www.amazon.com.br/dp/ABC',
      is_active: true,
    },
    {
      id: 'kabum-1',
      name: 'Kabum 1',
      url: 'https://www.kabum.com.br/produto/123',
      is_active: true,
    },
  ];

  const summary = summarizeSmokeRun({
    selectedProducts,
    latestPayload: {
      items: [
        {
          product_id: 'amazon-1',
          status: 'ok',
          engine_used: 'engine1_http',
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
