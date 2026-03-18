import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { runScrape } from '../src/scrape.js';
import { persistRunOutputs } from '../src/io/storage.js';

function runScrapeProcess(dataRoot) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ['src/scrape.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATA_ROOT: dataRoot,
        DEBUG: '0',
        CONCURRENCY: '1',
        HTTP_TIMEOUT_MS: '4000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      resolvePromise({ code, stdout, stderr });
    });
  });
}

async function makeTempDataRoot() {
  const root = await mkdtemp(resolve(tmpdir(), 'git-scraper-run-'));
  await mkdir(resolve(root, 'data'), { recursive: true });
  return root;
}

async function writeProducts(dataRoot, productsBody) {
  await writeFile(resolve(dataRoot, 'data', 'products.json'), productsBody, 'utf8');
}

async function readJson(dataRoot, relativePath) {
  return JSON.parse(await readFile(resolve(dataRoot, relativePath), 'utf8'));
}

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

test('fatal scrape path exits with code 1 and writes fatal error payload', async () => {
  const dataRoot = await makeTempDataRoot();
  await writeProducts(dataRoot, '{invalid json');

  const result = await runScrapeProcess(dataRoot);
  const manifest = await readJson(dataRoot, 'data/runs/index.json');
  const fatalRun = manifest.runs[0];
  const fatalError = await readJson(dataRoot, `data/errors/${fatalRun.error_file}`);

  assert.equal(result.code, 1);
  assert.equal(fatalRun.status, 'fatal');
  assert.equal(fatalError.fatal, true);
  assert.equal(fatalError.phase, 'read_products');
});

test('empty active product set writes a successful empty snapshot', async () => {
  const dataRoot = await makeTempDataRoot();
  await writeProducts(dataRoot, JSON.stringify([
    {
      id: 'produto-inativo',
      name: 'Produto Inativo',
      url: 'https://example.com/inativo',
      is_active: false,
    },
  ], null, 2));

  const result = await runScrapeProcess(dataRoot);
  const latest = await readJson(dataRoot, 'data/latest.json');
  const manifest = await readJson(dataRoot, 'data/runs/index.json');

  assert.equal(result.code, 0);
  assert.equal(latest.summary.total_products, 0);
  assert.deepEqual(latest.items, []);
  assert.equal(manifest.runs[0].status, 'success');
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
    await writeProducts(dataRoot, JSON.stringify([
      {
        id: 'produto-a',
        name: 'Produto A',
        url,
        is_active: true,
      },
    ], null, 2));

    const first = await runScrapeProcess(dataRoot);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    const second = await runScrapeProcess(dataRoot);

    assert.equal(first.code, 0);
    assert.equal(second.code, 0);
  });

  const manifest = await readJson(dataRoot, 'data/runs/index.json');
  const latest = await readJson(dataRoot, 'data/latest.json');

  assert.equal(manifest.runs.length, 2);
  assert.notEqual(manifest.runs[0].run_id, manifest.runs[1].run_id);
  assert.equal(manifest.daily[0].total_runs, 2);
  assert.equal(latest.summary.success_count, 1);
  assert.match(latest.run_file, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/);
});

test('failed scrape carries forward the last valid price into the current snapshot', async () => {
  const dataRoot = await makeTempDataRoot();
  process.env.DATA_ROOT = dataRoot;

  const noopLogger = {
    info() {},
    warn() {},
    error() {},
    debug() {},
    summary() {},
  };

  try {
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
    assert.equal(currentRun.failures[0].error_code, 'captcha_or_block');
  } finally {
    delete process.env.DATA_ROOT;
  }
});
