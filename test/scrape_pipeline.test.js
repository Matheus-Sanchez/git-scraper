import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
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
  SCRAPING_API_KEY: '',
  AMAZON_PAAPI_ACCESS_KEY: '',
  AMAZON_PAAPI_SECRET_KEY: '',
  AMAZON_PAAPI_PARTNER_TAG: '',
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

async function withFixtureServer(html, callback) {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });

  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/produto`;

  try {
    return await callback(url);
  } finally {
    await new Promise((resolvePromise, rejectPromise) => {
      server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
    });
  }
}

test('fatal scrape path persists fatal error payload and rejects', async () => {
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
    assert.equal(fatalError.engine, 'pipeline');
    assert.match(fatalError.error_detail, /(unexpected token|expected property name)/i);
  });
});

test('empty active product set writes a successful empty snapshot', async () => {
  const dataRoot = await makeTempDataRoot();
  await withDataRoot(dataRoot, async () => {
    await writeProducts(dataRoot, JSON.stringify([
      {
        id: 'produto-inativo',
        name: 'Produto Inativo',
        url: 'https://example.com/inativo',
        is_active: false,
      },
    ], null, 2));

    const result = await runScrape({
      runtimeEnv,
      baseLogger: noopLogger,
    });
    const latest = await readJson(dataRoot, 'data/latest.json');
    const manifest = await readJson(dataRoot, 'data/runs/index.json');

    assert.equal(result.status, 'success');
    assert.equal(latest.summary.total_products, 0);
    assert.deepEqual(latest.items, []);
    assert.equal(manifest.runs[0].status, 'success');
  });
});

test('same-day runs create unique run_ids and update manifest daily drilldown', async () => {
  const dataRoot = await makeTempDataRoot();
  const html = `
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <script type="application/ld+json">
          {"@context":"https://schema.org","@type":"Product","offers":{"price":"199.90"}}
        </script>
      </head>
      <body>
        <div class="price">R$ 199,90</div>
      </body>
    </html>
  `;

  await withFixtureServer(html, async (url) => {
    await withDataRoot(dataRoot, async () => {
      await writeProducts(dataRoot, JSON.stringify([
        {
          id: 'produto-a',
          name: 'Produto A',
          url,
          is_active: true,
        },
      ], null, 2));

      const first = await runScrape({
        runtimeEnv,
        baseLogger: noopLogger,
      });
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
      const second = await runScrape({
        runtimeEnv,
        baseLogger: noopLogger,
      });

      assert.equal(first.status, 'success');
      assert.equal(second.status, 'success');
    });
  });

  const manifest = await readJson(dataRoot, 'data/runs/index.json');
  const latest = await readJson(dataRoot, 'data/latest.json');

  assert.equal(manifest.runs.length, 2);
  assert.notEqual(manifest.runs[0].run_id, manifest.runs[1].run_id);
  assert.equal(manifest.daily[0].total_runs, 2);
  assert.equal(latest.summary.success_count, 1);
  assert.match(latest.run_file, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/);
});

test('amazon products can succeed via official PA-API fallback before browser engines', async () => {
  const dataRoot = await makeTempDataRoot();

  await withDataRoot(dataRoot, async () => {
    await writeProducts(dataRoot, JSON.stringify([{
      id: 'echo-pop',
      name: 'Echo Pop',
      url: 'https://www.amazon.com.br/dp/B09WXVH7WK?th=1',
      is_active: true,
    }], null, 2));

    const result = await runScrape({
      runtimeEnv: {
        DEBUG: false,
        CONCURRENCY: 1,
        HTTP_TIMEOUT_MS: 1000,
        PROXY_URL: '',
        SCRAPING_API_KEY: '',
        AMAZON_PAAPI_ACCESS_KEY: 'ak',
        AMAZON_PAAPI_SECRET_KEY: 'sk',
        AMAZON_PAAPI_PARTNER_TAG: 'tag-20',
      },
      baseLogger: noopLogger,
      lookupPreviousResults: async () => new Map(),
      engineRunners: {
        async runEngine1(products) {
          return products.map((product) => ({
            engine: 'engine1_http',
            product,
            ok: true,
            elapsed_ms: 10,
            result: {
              product_id: product.id,
              url: product.url,
              name: product.name,
              price: 379,
              currency: 'BRL',
              unit_price: null,
              engine_used: 'engine1_http',
              fetched_at: '2026-03-18T10:13:45.765Z',
              source: 'amazon-paapi',
              confidence: 0.99,
              status: 'ok',
            },
          }));
        },
        async runEngine2() { return []; },
        async runEngine3() { return []; },
      },
    });

    assert.equal(result.success, true);
  });
});

test('failed scrape carries forward the last valid price into the current snapshot', async () => {
  const dataRoot = await makeTempDataRoot();

  await withDataRoot(dataRoot, async () => {
    await writeProducts(dataRoot, JSON.stringify([
      {
        id: 'produto-a',
        name: 'Produto A',
        url: 'https://example.com/produto-a',
        is_active: true,
        units_per_package: 1,
      },
    ], null, 2));

    const previousRunId = '2026-03-17T10-00-00-000Z';
    await persistRunOutputs({
      runId: previousRunId,
      runDate: '2026-03-17',
      generatedAt: '2026-03-17T10:00:00.000Z',
      status: 'success',
      runPayload: {
        run_id: previousRunId,
        run_date: '2026-03-17',
        generated_at: '2026-03-17T10:00:00.000Z',
        currency: 'BRL',
        summary: {
          total_products: 1,
          success_count: 1,
          failure_count: 0,
        },
        results: [{
          product_id: 'produto-a',
          name: 'Produto A',
          url: 'https://example.com/produto-a',
          price: 199.9,
          unit_price: 199.9,
          currency: 'BRL',
          fetched_at: '2026-03-17T10:00:00.000Z',
          status: 'ok',
          source: 'json-ld',
          confidence: 0.97,
          engine_used: 'engine1_http',
        }],
        failures: [],
      },
      errorPayload: {
        run_id: previousRunId,
        run_date: '2026-03-17',
        generated_at: '2026-03-17T10:00:00.000Z',
        engine_summary: {},
        errors: [],
      },
      latestPayload: {
        run_id: previousRunId,
        generated_at: '2026-03-17T10:00:00.000Z',
        currency: 'BRL',
        summary: {
          total_products: 1,
          success_count: 1,
          failure_count: 0,
        },
        items: [{
          product_id: 'produto-a',
          name: 'Produto A',
          url: 'https://example.com/produto-a',
          price: 199.9,
          unit_price: 199.9,
          currency: 'BRL',
          fetched_at: '2026-03-17T10:00:00.000Z',
          status: 'ok',
          source: 'json-ld',
          confidence: 0.97,
          engine_used: 'engine1_http',
        }],
        failures: [],
        run_file: `${previousRunId}.json`,
      },
    });

    const result = await runScrape({
      runtimeEnv: {
        DEBUG: false,
        CONCURRENCY: 1,
        HTTP_TIMEOUT_MS: 1000,
        PROXY_URL: '',
        SCRAPING_API_KEY: '',
      },
      baseLogger: noopLogger,
      engineRunners: {
        async runEngine1(products) {
          return products.map((product) => ({
            engine: 'engine1_http',
            product,
            ok: false,
            elapsed_ms: 1,
            error: 'Amazon anti-bot or captcha page detected',
            error_code: 'captcha_or_block',
            error_detail: 'Amazon anti-bot or captcha page detected',
          }));
        },
        async runEngine2() {
          return [];
        },
        async runEngine3() {
          return [];
        },
      },
    });

    const latest = await readJson(dataRoot, 'data/latest.json');
    const currentRun = await readJson(dataRoot, `data/runs/${latest.run_file}`);

    assert.equal(result.status, 'partial');
    assert.equal(latest.summary.success_count, 0);
    assert.equal(latest.summary.failure_count, 1);
    assert.equal(latest.items.length, 1);
    assert.equal(latest.failures.length, 1);
    assert.equal(latest.items[0].status, 'carried_forward');
    assert.equal(latest.items[0].price, 199.9);
    assert.equal(latest.items[0].engine_used, 'carry_forward');
    assert.equal(latest.items[0].carried_forward_from.run_id, previousRunId);
    assert.equal(currentRun.results[0].status, 'carried_forward');
    assert.equal(currentRun.failures[0].engine, 'engine1_http');
    assert.equal(currentRun.failures[0].error_code, 'captcha_or_block');
    assert.equal(currentRun.failures[0].artifact_dir, null);
  });
});
