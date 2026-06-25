import assert from 'node:assert/strict';
import test from 'node:test';
import { runScrape } from '../src/scrape.js';
import { persistRunOutputs } from '../src/io/storage.js';
import {
  makeTempDataRoot,
  readJson,
  withDataRoot,
  writeProducts,
} from '../test_support/data_root.js';

const runtimeEnv = {
  DEBUG: false,
  CONCURRENCY: 1,
  HTTP_TIMEOUT_MS: 4000,
  PROXY_URL: '',
  LIGHTPANDA_CDP_URL: 'ws://127.0.0.1:9222',
  SEARCH_TOP_N_PER_STORE: 5,
};

const noopLogger = {
  child() { return this; },
  product() {},
  info() {},
  warn() {},
  error() {},
  debug() {},
  summary() {},
};

test('fatal scrape path persists fatal error payload and rejects invalid catalog', async () => {
  const dataRoot = await makeTempDataRoot();
  await withDataRoot(dataRoot, async () => {
    await writeProducts(dataRoot, '{invalid json');

    await assert.rejects(() => runScrape({
      runtimeEnv,
      baseLogger: noopLogger,
    }));

    const manifest = await readJson(dataRoot, 'data/runs/index.json');
    const fatalRun = manifest.runs[0];
    const fatalError = await readJson(dataRoot, `data/errors/${fatalRun.error_file}`);

    assert.equal(fatalRun.status, 'fatal');
    assert.equal(fatalError.fatal, true);
    assert.equal(fatalError.phase, 'read_products');
  });
});

test('empty active intent set writes a successful empty snapshot', async () => {
  const dataRoot = await makeTempDataRoot();
  await withDataRoot(dataRoot, async () => {
    await writeProducts(dataRoot, JSON.stringify([
      {
        id: 'produto-inativo',
        name: 'Produto Inativo',
        is_active: false,
      },
    ], null, 2));

    const result = await runScrape({
      runtimeEnv,
      baseLogger: noopLogger,
    });
    const latest = await readJson(dataRoot, 'data/latest.json');

    assert.equal(result.status, 'success');
    assert.equal(latest.summary.total_products, 0);
    assert.deepEqual(latest.items, []);
    assert.deepEqual(latest.offers, []);
  });
});

test('search pipeline persists best item and top offers', async () => {
  const dataRoot = await makeTempDataRoot();
  await withDataRoot(dataRoot, async () => {
    await writeProducts(dataRoot, JSON.stringify([
      {
        id: 'fralda-g',
        name: 'Fralda',
        characteristics: 'tamanho G',
        required_terms: ['fralda'],
        required_attributes: { size: 'G' },
        unit_rule: { basis: 'unit' },
        stores: ['magalu'],
        is_active: true,
      },
    ], null, 2));

    const result = await runScrape({
      runtimeEnv,
      baseLogger: noopLogger,
      engineRunners: {
        async runSearchEngine(products) {
          const product = products[0];
          return [{
            engine: 'lightpanda_search',
            product,
            ok: true,
            elapsed_ms: 10,
            result: {
              product_id: product.id,
              intent_id: product.id,
              name: product.name,
              characteristics: product.characteristics,
              store_id: 'magalu',
              store: 'Magalu',
              title: 'Fralda Baby tamanho G 80 unidades',
              url: 'https://www.magazineluiza.com.br/fralda/p/abc',
              price: 80,
              currency: 'BRL',
              unit_price: 1,
              unit_basis: 'unit',
              normalized_quantity: 80,
              attributes: { size: 'G', package_count: 80 },
              match_score: 1,
              priority_score: 0,
              engine_used: 'lightpanda_search',
              fetched_at: '2026-06-24T10:00:00.000Z',
              source: 'search-card',
              confidence: 1,
              status: 'ok',
            },
            offers: [{
              product_id: product.id,
              intent_id: product.id,
              store_id: 'magalu',
              store: 'Magalu',
              title: 'Fralda Baby tamanho G 80 unidades',
              url: 'https://www.magazineluiza.com.br/fralda/p/abc',
              price: 80,
              unit_price: 1,
              unit_basis: 'unit',
              normalized_quantity: 80,
              attributes: { size: 'G', package_count: 80 },
              match_score: 1,
              priority_score: 0,
              rank: 1,
              engine_used: 'lightpanda_search',
              fetched_at: '2026-06-24T10:00:00.000Z',
            }],
          }];
        },
      },
    });

    const latest = await readJson(dataRoot, 'data/latest.json');
    const currentRun = await readJson(dataRoot, `data/runs/${latest.run_file}`);

    assert.equal(result.status, 'success');
    assert.equal(latest.summary.success_count, 1);
    assert.equal(latest.items[0].url, 'https://www.magazineluiza.com.br/fralda/p/abc');
    assert.equal(latest.items[0].unit_price, 1);
    assert.equal(latest.offers.length, 1);
    assert.equal(currentRun.offers.length, 1);
  });
});

test('search pipeline persists rejected top offers when ranking finds no winner', async () => {
  const dataRoot = await makeTempDataRoot();
  await withDataRoot(dataRoot, async () => {
    await writeProducts(dataRoot, JSON.stringify([
      {
        id: 'memoria-ddr4',
        name: 'Memoria RAM',
        characteristics: 'DDR4',
        required_terms: ['memoria'],
        required_attributes: { memory_type: 'ddr4' },
        stores: ['kabum'],
        is_active: true,
      },
    ], null, 2));

    const result = await runScrape({
      runtimeEnv,
      baseLogger: noopLogger,
      engineRunners: {
        async runSearchEngine(products) {
          const product = products[0];
          return [{
            engine: 'lightpanda_search',
            product,
            ok: false,
            elapsed_ms: 10,
            error: 'Search returned offers, but none matched the required filters',
            error_code: 'no_matching_offers',
            error_detail: 'Search returned offers, but none matched the required filters',
            stores_checked: 1,
            offers_checked: 1,
            rejected_offers: 1,
            offers: [{
              product_id: product.id,
              intent_id: product.id,
              store_id: 'kabum',
              store: 'KaBuM',
              title: 'Memoria Kingston DDR5 16GB 5600MHz',
              url: 'https://www.kabum.com.br/produto/abc',
              price: 199,
              unit_price: null,
              unit_basis: null,
              normalized_quantity: null,
              attributes: { memory_type: 'ddr5', capacity_total_gb: 16 },
              match_score: 0.95,
              priority_score: 0,
              rank: 1,
              engine_used: 'lightpanda_search',
              fetched_at: '2026-06-24T10:00:00.000Z',
              rejected: true,
              rejected_reasons: ['missing_required_attributes:memory_type'],
            }],
          }];
        },
      },
    });

    const latest = await readJson(dataRoot, 'data/latest.json');
    const currentRun = await readJson(dataRoot, `data/runs/${latest.run_file}`);

    assert.equal(result.status, 'partial');
    assert.equal(latest.items.length, 0);
    assert.equal(latest.offers.length, 1);
    assert.equal(latest.offers[0].rejected, true);
    assert.deepEqual(latest.offers[0].rejected_reasons, ['missing_required_attributes:memory_type']);
    assert.equal(currentRun.offers.length, 1);
  });
});

test('failed search carries forward the last valid offer into the current snapshot', async () => {
  const dataRoot = await makeTempDataRoot();

  await withDataRoot(dataRoot, async () => {
    await writeProducts(dataRoot, JSON.stringify([
      {
        id: 'produto-a',
        name: 'Produto A',
        stores: ['amazon'],
        is_active: true,
      },
    ], null, 2));

    const previousRunId = '2026-06-23T10-00-00-000Z';
    await persistRunOutputs({
      runId: previousRunId,
      runDate: '2026-06-23',
      generatedAt: '2026-06-23T10:00:00.000Z',
      status: 'success',
      runPayload: {
        run_id: previousRunId,
        run_date: '2026-06-23',
        generated_at: '2026-06-23T10:00:00.000Z',
        currency: 'BRL',
        summary: {
          total_products: 1,
          success_count: 1,
          failure_count: 0,
        },
        results: [{
          product_id: 'produto-a',
          intent_id: 'produto-a',
          name: 'Produto A',
          title: 'Produto A oferta',
          url: 'https://www.amazon.com.br/dp/ABC',
          store_id: 'amazon',
          store: 'Amazon',
          price: 199.9,
          unit_price: null,
          currency: 'BRL',
          fetched_at: '2026-06-23T10:00:00.000Z',
          status: 'ok',
          source: 'search-card',
          confidence: 0.97,
          engine_used: 'lightpanda_search',
        }],
        offers: [],
        failures: [],
      },
      errorPayload: {
        run_id: previousRunId,
        run_date: '2026-06-23',
        generated_at: '2026-06-23T10:00:00.000Z',
        engine_summary: {},
        errors: [],
      },
      latestPayload: {
        run_id: previousRunId,
        generated_at: '2026-06-23T10:00:00.000Z',
        currency: 'BRL',
        summary: {
          total_products: 1,
          success_count: 1,
          failure_count: 0,
        },
        items: [{
          product_id: 'produto-a',
          intent_id: 'produto-a',
          name: 'Produto A',
          title: 'Produto A oferta',
          url: 'https://www.amazon.com.br/dp/ABC',
          store_id: 'amazon',
          store: 'Amazon',
          price: 199.9,
          unit_price: null,
          currency: 'BRL',
          fetched_at: '2026-06-23T10:00:00.000Z',
          status: 'ok',
          source: 'search-card',
          confidence: 0.97,
          engine_used: 'lightpanda_search',
        }],
        offers: [],
        failures: [],
        run_file: `${previousRunId}.json`,
      },
    });

    const result = await runScrape({
      runtimeEnv,
      baseLogger: noopLogger,
      engineRunners: {
        async runSearchEngine(products) {
          return products.map((product) => ({
            engine: 'lightpanda_search',
            product,
            ok: false,
            elapsed_ms: 1,
            error: 'Search did not return usable offers',
            error_code: 'no_search_offers',
            error_detail: 'Search did not return usable offers',
            stores_checked: 1,
            offers_checked: 0,
          }));
        },
      },
    });

    const latest = await readJson(dataRoot, 'data/latest.json');
    assert.equal(result.status, 'partial');
    assert.equal(latest.items[0].status, 'carried_forward');
    assert.equal(latest.items[0].price, 199.9);
    assert.equal(latest.failures[0].error_code, 'no_search_offers');
  });
});
