import assert from 'node:assert/strict';
import test from 'node:test';
import { supportMatrix } from '../src/config/support_matrix.js';
import { listRegisteredSmokeCases } from '../src/smoke/cases.js';
import {
  assertSmokeSelectionCoverage,
  parseSmokeProductIds,
  parseSmokeStoreIds,
  selectSmokeProducts,
  summarizeSmokeRun,
} from '../src/smoke/real.js';

const echoProduct = {
  id: 'echo-pop-5f33e662',
  name: 'Echo Pop',
  characteristics: 'alto-falante inteligente com Alexa',
  stores: ['amazon', 'kabum'],
  required_terms: ['echo', 'pop'],
  excluded_terms: [],
  is_active: true,
};

const motherboardProduct = {
  id: 'placa-mae-asus-tuf-gaming-b760-ddr5-1525c3b8',
  name: 'Placa Mãe Asus TUF Gaming B760',
  characteristics: 'DDR5',
  stores: ['amazon', 'kabum'],
  required_terms: ['asus', 'tuf', 'b760'],
  excluded_terms: ['ddr4'],
  is_active: true,
};

const keyboardProduct = {
  id: 'teclado-logitech-k835',
  name: 'Teclado Logitech K835 TKL',
  characteristics: 'mecanico',
  stores: ['amazon', 'mercadolivre'],
  required_terms: ['logitech', 'k835'],
  excluded_terms: [],
  is_active: true,
};

test('support matrix exposes only Amazon and KaBuM as validated search/smoke stores', () => {
  const validated = supportMatrix.filter((entry) => entry.support_level === 'dedicated_validated');
  const backlog = supportMatrix.filter((entry) => entry.support_level === 'backlog_unvalidated');

  assert.deepEqual(validated.map((entry) => [entry.store, entry.adapter, entry.smoke_real]), [
    ['Amazon', 'amazon', true],
    ['KaBuM', 'kabum', true],
  ]);
  assert.deepEqual(backlog.map((entry) => entry.adapter), [
    'mercadolivre',
    'magalu',
    'shopee',
    'pichau',
    'petz',
  ]);
  assert.equal(backlog.every((entry) => entry.smoke_real === false), true);
});

test('smoke registry has a store-appropriate fixed case for every adapter', () => {
  assert.deepEqual(listRegisteredSmokeCases().map((entry) => entry.id), [
    'amazon-echo-pop',
    'kabum-asus-tuf-b760-ddr5',
    'mercadolivre-logitech-k835',
    'magalu-acer-aspire-go-15-i7-512gb',
    'shopee-hyperx-cloud-stinger-2-preto',
    'pichau-asus-tuf-b760-ddr5',
    'petz-pampers-confort-sec-g',
  ]);
  assert.deepEqual(listRegisteredSmokeCases({ enabledOnly: true }).map((entry) => entry.store_id), [
    'amazon',
    'kabum',
  ]);
});

test('parseSmokeProductIds normalizes comma-separated product identifiers', () => {
  assert.deepEqual(
    parseSmokeProductIds(' amazon-echo-pop, kabum-asus-tuf-b760-ddr5 , amazon-echo-pop ,, '),
    ['amazon-echo-pop', 'kabum-asus-tuf-b760-ddr5'],
  );
  assert.deepEqual(parseSmokeStoreIds(' MercadoLivre, PETZ, mercadolivre '), [
    'mercadolivre',
    'petz',
  ]);
});

test('selectSmokeProducts uses the fixed case instead of the first product for each store', () => {
  const selected = selectSmokeProducts([
    {
      id: 'unrelated-first-product',
      name: 'Produto que não deve ser usado no smoke',
      stores: ['amazon', 'kabum'],
      is_active: true,
    },
    echoProduct,
    motherboardProduct,
  ]);

  assert.deepEqual(selected.map((product) => [product.smoke_case_id, product.id, product.smoke_store]), [
    ['amazon-echo-pop', 'echo-pop-5f33e662-amazon', 'Amazon'],
    ['kabum-asus-tuf-b760-ddr5', 'placa-mae-asus-tuf-gaming-b760-ddr5-1525c3b8-kabum', 'KaBuM'],
  ]);
  assert.deepEqual(selected[0].required_attributes, { is_accessory: false });
  assert.deepEqual(selected[1].required_attributes, { chipset: 'b760', memory_type: 'ddr5' });
});

test('selectSmokeProducts respects explicit case identifiers', () => {
  const selected = selectSmokeProducts([echoProduct, motherboardProduct], {
    productIds: ['kabum-asus-tuf-b760-ddr5'],
  });

  assert.deepEqual(selected.map((product) => product.id), [
    'placa-mae-asus-tuf-gaming-b760-ddr5-1525c3b8-kabum',
  ]);
});

test('selectSmokeProducts permits a registered backlog case only through an explicit store allowlist', () => {
  const defaultSelection = selectSmokeProducts([echoProduct, motherboardProduct, keyboardProduct]);
  assert.equal(defaultSelection.some((product) => product.smoke_store_id === 'mercadolivre'), false);

  const backlogSelection = selectSmokeProducts([keyboardProduct], {
    storeIds: ['mercadolivre'],
  });
  assert.deepEqual(backlogSelection.map((product) => [
    product.smoke_case_id,
    product.smoke_store_id,
    product.smoke_support_level,
  ]), [[
    'mercadolivre-logitech-k835',
    'mercadolivre',
    'backlog_unvalidated',
  ]]);
  assert.throws(
    () => selectSmokeProducts([keyboardProduct], { storeIds: ['unknown-store'] }),
    /Unknown or unregistered smoke store/,
  );
});

test('scheduled smoke selection fails closed when an enabled store has no active case', () => {
  const incomplete = selectSmokeProducts([echoProduct]);
  assert.throws(
    () => assertSmokeSelectionCoverage(incomplete),
    /kabum/,
  );

  const complete = selectSmokeProducts([echoProduct, motherboardProduct]);
  assert.equal(assertSmokeSelectionCoverage(complete), true);
  assert.equal(assertSmokeSelectionCoverage([complete[0]], {
    productIds: ['amazon-echo-pop'],
  }), true);
});

test('summarizeSmokeRun requires a direct identity match and a non-rejected selected offer', () => {
  const selectedProducts = selectSmokeProducts([echoProduct, motherboardProduct]);
  const amazon = selectedProducts[0];
  const kabum = selectedProducts[1];
  const amazonUrl = 'https://www.amazon.com.br/echo-pop/dp/B0TEST';

  const summary = summarizeSmokeRun({
    selectedProducts,
    latestPayload: {
      items: [
        {
          product_id: amazon.id,
          status: 'ok',
          engine_used: 'chromium_search',
          store_id: 'amazon',
          title: 'Echo Pop smart speaker com Alexa - preto',
          url: amazonUrl,
          match_score: 1,
          attributes: { is_accessory: false, color: 'preto' },
        },
        {
          product_id: kabum.id,
          status: 'carried_forward',
          engine_used: 'carry_forward',
        },
      ],
      offers: [
        {
          intent_id: amazon.id,
          store_id: 'amazon',
          title: 'Echo Pop smart speaker com Alexa - preto',
          url: amazonUrl,
          rejected: false,
        },
      ],
      failures: [{ product_id: kabum.id, error_code: 'captcha_or_block' }],
    },
  });

  assert.equal(summary.ok, false);
  assert.deepEqual(
    summary.store_results.map((entry) => [
      entry.store,
      entry.status,
      entry.direct_success_count,
      entry.accepted_offer_count,
      entry.carried_forward_count,
    ]),
    [
      ['Amazon', 'pass', 1, 1, 0],
      ['KaBuM', 'fail', 0, 0, 1],
    ],
  );
});

test('summarizeSmokeRun rejects a cheap accessory even if the scrape status is ok', () => {
  const [amazon] = selectSmokeProducts([echoProduct, motherboardProduct]);
  const accessoryUrl = 'https://www.amazon.com.br/suporte-echo-pop/dp/B0ACCESSORY';
  const summary = summarizeSmokeRun({
    selectedProducts: [amazon],
    latestPayload: {
      items: [{
        product_id: amazon.id,
        status: 'ok',
        engine_used: 'chromium_search',
        store_id: 'amazon',
        title: 'Suporte de mesa para Echo Pop',
        url: accessoryUrl,
        match_score: 1,
        attributes: { is_accessory: true },
      }],
      offers: [{
        intent_id: amazon.id,
        store_id: 'amazon',
        title: 'Suporte de mesa para Echo Pop',
        url: accessoryUrl,
        rejected: false,
      }],
      failures: [],
    },
  });

  assert.equal(summary.ok, false);
  assert.equal(summary.store_results[0].identity_failure_count, 1);
  assert.deepEqual(summary.store_results[0].identity_failure_reasons, [
    'excluded_terms:suporte',
    'required_attributes:is_accessory',
  ]);
});
