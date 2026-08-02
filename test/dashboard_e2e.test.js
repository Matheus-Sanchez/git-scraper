import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import test, { after, before } from 'node:test';

import { chromium } from 'playwright';
import { selectRecentRunFiles } from '../docs/dashboard-model.js';

const docsRoot = path.resolve('docs');
const DASHBOARD_ASSET_VERSION = '20260801a';
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

let server;
let browser;
let baseUrl;
let realDataUrl;

const fixtureProducts = [
  {
    id: 'coffee', name: 'Café Especial', category: 'mercado', required_terms: ['cafe'],
    unit_rule: { basis: 'unit', label: 'unidade' }, is_active: true,
  },
  { id: 'speaker', name: 'Caixa Inteligente', category: 'audio', required_terms: ['caixa'], is_active: true },
  { id: 'failed', name: 'Produto Falhou', category: 'hardware', required_terms: ['produto'], is_active: true },
  {
    id: 'echo', name: 'Echo Pop', category: 'casa-inteligente', required_terms: ['echo', 'pop'],
    excluded_terms: ['suporte'], required_attributes: { is_accessory: false }, is_active: true,
  },
  { id: 'inactive', name: 'Produto Inativo', category: 'legado', is_active: false },
];

function fixtureRun(day) {
  const date = `2026-01-${String(day).padStart(2, '0')}`;
  const runId = `${date}T10-00-00-000Z`;
  const coffeeUnitPrice = 10 - (day * 0.5);
  const results = [
    {
      product_id: 'coffee', name: 'Café Especial', title: 'Cafe Especial pacote promocional',
      category: 'mercado', price: 100 + (day * 10), unit_price: coffeeUnitPrice,
      unit_basis: 'unidade', store: 'Loja A', url: 'https://example.com/cafe', status: 'ok',
    },
    {
      product_id: 'speaker', name: 'Caixa Inteligente', title: 'Caixa Inteligente preta',
      category: 'audio', price: 200 + day, store: 'Loja B', url: 'https://example.com/caixa',
      status: day === 8 ? 'carried_forward' : 'ok',
      engine_used: day === 8 ? 'carry_forward' : 'chromium_search',
      ...(day === 8 ? {
        carried_forward_reason: 'blocked',
        carried_forward_from: {
          run_id: '2026-01-07T10-00-00-000Z',
          run_date: '2026-01-07',
          fetched_at: '2026-01-07T10:00:00.000Z',
        },
      } : {}),
    },
    {
      product_id: 'echo', name: 'Echo Pop',
      title: day === 8 ? '<img src=x onerror="window.__escaped=false"> Suporte para Echo Pop' : 'Echo Pop com Alexa',
      category: 'casa-inteligente', price: day === 8 ? 29.99 : 350 + day,
      attributes: { is_accessory: day === 8 }, store: 'Loja A',
      url: day === 8 ? 'javascript:window.__unsafeUrl=true' : 'https://example.com/echo', status: 'ok',
    },
    {
      product_id: 'legacy-product', name: 'Produto Legado', title: 'Produto Legado',
      category: 'legado', price: 80 + day, store: 'Loja Antiga', status: 'ok',
    },
  ];
  if (day < 8) {
    results.push({
      product_id: 'failed', name: 'Produto Falhou', title: 'Produto principal', category: 'hardware',
      price: 300 + day, store: 'Loja C', url: 'https://example.com/produto', status: 'ok',
    });
  }
  const failures = day === 8 ? [
    { product_id: 'speaker', store: 'Loja B', error_code: 'blocked', error_detail: 'bloqueio temporário' },
    { product_id: 'failed', store: 'Loja C', error_code: 'no_search_offers', error_detail: 'nenhuma oferta' },
  ] : [];
  const offers = [
    {
      product_id: 'coffee', title: 'Cafe Especial Loja A', store: 'Loja A', price: 100 + (day * 10),
      unit_price: coffeeUnitPrice, unit_basis: 'unidade', url: 'https://example.com/cafe-a', rejected: false,
    },
    {
      product_id: 'coffee', title: 'Cafe Especial Loja B', store: 'Loja B', price: 120 + (day * 10),
      unit_price: coffeeUnitPrice + 1, unit_basis: 'unidade', url: 'https://example.com/cafe-b', rejected: false,
    },
  ];
  if (day === 8) {
    offers.push({
      product_id: 'coffee', title: 'Cafe Especial para auditoria', store: 'Loja Auditoria',
      price: 20, unit_price: 1, unit_basis: 'unidade', url: 'javascript:window.__unsafeOffer=true',
      rejected: false, suspicious: true,
    });
  }
  return {
    run_id: runId,
    run_date: date,
    generated_at: `${date}T10:00:00.000Z`,
    currency: 'BRL',
    results,
    offers,
    failures,
    summary: {
      total_products: 4,
      success_count: results.filter((result) => result.product_id !== 'legacy-product').length,
      failure_count: failures.length,
      engines: {
        lightpanda_search: { attempted: 4, success: 0, failed: 4 },
        chromium_search: { attempted: 4, success: day === 8 ? 3 : 4, failed: day === 8 ? 1 : 0 },
      },
    },
  };
}

const fixtureRuns = Array.from({ length: 8 }, (_, index) => fixtureRun(index + 1));
const fixtureManifest = {
  generated_at: fixtureRuns.at(-1).generated_at,
  runs: [...fixtureRuns].reverse().map((run) => ({
    run_id: run.run_id,
    run_date: run.run_date,
    generated_at: run.generated_at,
    run_file: `${run.run_id}.json`,
  })),
};
const fixtureLatestRun = fixtureRuns.at(-1);
const fixtureLatest = {
  ...fixtureLatestRun,
  items: fixtureLatestRun.results,
};
delete fixtureLatest.results;
const fixtureData = new Map([
  ['data/products.json', fixtureProducts],
  ['data/latest.json', fixtureLatest],
  ['data/runs/index.json', fixtureManifest],
  ...fixtureRuns.map((run) => [`data/runs/${run.run_id}.json`, run]),
]);

const fatalRun = {
  run_id: '2026-01-09T10-00-00-000Z',
  run_date: '2026-01-09',
  generated_at: '2026-01-09T10:00:00.000Z',
  currency: 'BRL',
  summary: { total_products: 0, success_count: 0, failure_count: 0, engines: {} },
  results: [], offers: [], failures: [],
};
const fatalError = {
  run_id: fatalRun.run_id,
  run_date: fatalRun.run_date,
  generated_at: fatalRun.generated_at,
  fatal: true,
  phase: 'read_products',
  error_code: 'catalog_unavailable',
  error_detail: 'Catálogo indisponível no início da execução',
  engine_summary: {},
  errors: [],
};
const fatalManifest = {
  generated_at: fatalRun.generated_at,
  runs: [
    {
      run_id: fatalRun.run_id,
      run_date: fatalRun.run_date,
      generated_at: fatalRun.generated_at,
      run_file: `${fatalRun.run_id}.json`,
      error_file: `${fatalRun.run_id}.json`,
      status: 'fatal',
    },
    ...fixtureManifest.runs,
  ],
};

async function saveFailureArtifacts(page, name, error) {
  const outputDir = path.resolve('.cache', 'dashboard-e2e');
  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all([
    page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: true }).catch(() => {}),
    page.content().then((html) => fs.writeFile(path.join(outputDir, `${name}.html`), html)).catch(() => {}),
    fs.writeFile(path.join(outputDir, `${name}.txt`), error?.stack || String(error)),
  ]);
}

async function neutralizeExternalAssets(page) {
  await page.route(/https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/, (route) => route.fulfill({
    status: 200,
    contentType: 'text/css; charset=utf-8',
    body: '',
  }));
}

function monitorPage(page) {
  const consoleErrors = [];
  const pageErrors = [];
  const failedResponses = [];
  const failedRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', (request) => failedRequests.push(`${request.url()} ${request.failure()?.errorText || ''}`));
  return { consoleErrors, pageErrors, failedResponses, failedRequests };
}

async function waitForHistoryState(page, state = 'ready') {
  await page.waitForFunction((expected) => document.querySelector('#history-chart')?.dataset.chartState === expected, state);
}

async function historySnapshot(page) {
  return page.locator('#history-chart').evaluate((canvas) => {
    const chart = canvas.__dashboardChart;
    const data = chart?.config?.data;
    return {
      labels: [...(data?.labels || [])],
      datasets: (data?.datasets || []).map((dataset) => ({
        label: dataset.label,
        data: [...dataset.data],
        unit: dataset._series?.unit,
        productId: dataset._series?.product_id,
        statuses: (dataset._points || []).map((point) => point.status),
        suspicious: (dataset._points || []).map((point) => Boolean(point.suspicious || point.unverified)),
      })),
    };
  });
}

before(async () => {
  server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, 'http://127.0.0.1');
      let pathname = decodeURIComponent(requestUrl.pathname);
      const fixturePrefix = '/git-scraper/';
      const realPrefix = '/git-scraper-real/';
      const usesFixture = pathname.startsWith(fixturePrefix);
      const prefix = usesFixture ? fixturePrefix : realPrefix;
      if (!pathname.startsWith(prefix)) {
        response.writeHead(404).end('Not found');
        return;
      }
      pathname = pathname.slice(prefix.length) || 'index.html';
      if (usesFixture && fixtureData.has(pathname)) {
        response.writeHead(200, {
          'cache-control': 'no-store',
          'content-type': 'application/json; charset=utf-8',
        });
        response.end(JSON.stringify(fixtureData.get(pathname)));
        return;
      }
      const filePath = path.resolve(docsRoot, pathname);
      if (!filePath.startsWith(`${docsRoot}${path.sep}`) && filePath !== docsRoot) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      const body = await fs.readFile(filePath);
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': mimeTypes[path.extname(filePath)] || 'application/octet-stream',
      });
      response.end(body);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/git-scraper/`;
  realDataUrl = `http://127.0.0.1:${server.address().port}/git-scraper-real/`;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

test('dashboard desenha cinco gráficos e mantém controles funcionais sob subpath', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await neutralizeExternalAssets(page);
    const diagnostics = monitorPage(page);
    const runRequests = new Set();
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname;
      if (/\/data\/runs\/(?!index\.json$).+\.json$/.test(pathname)) runRequests.add(pathname);
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.dashboardReady === 'true', null, { timeout: 45_000 });

    const versionedAssets = await page.evaluate(() => window.performance.getEntriesByType('resource').map((entry) => entry.name));
    assert.ok(versionedAssets.some((url) => new RegExp(`dashboard-model\\.js\\?v=${DASHBOARD_ASSET_VERSION}$`).test(url)), 'o módulo do modelo deve usar cache-busting');
    assert.ok(versionedAssets.some((url) => new RegExp(`vendor/visuals-runtime\\.js\\?v=${DASHBOARD_ASSET_VERSION}$`).test(url)), 'o runtime visual deve usar um caminho neutro e cache-busting');
    assert.ok(!versionedAssets.some((url) => /vendor\/chart\.umd\.js/.test(url)), 'o asset conhecido por bloqueadores não deve ser requisitado pelo dashboard');
    assert.equal(await page.evaluate(() => typeof window.Chart), 'function', 'o runtime visual precisa definir Chart antes do app');

    const expectedRunFiles = selectRecentRunFiles(fixtureManifest, 30);
    assert.equal(runRequests.size, expectedRunFiles.length, 'o app deve baixar somente os runs selecionados no manifesto');

    const chartIds = [
      'store-health-chart',
      'engine-health-chart',
      'failure-breakdown-chart',
      'category-pie-chart',
      'history-chart',
    ];
    for (const id of chartIds) {
      const result = await page.locator(`#${id}`).evaluate((canvas) => {
        const context = canvas.getContext('2d');
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let painted = 0;
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index] > 0) painted += 1;
        }
        const runtimeState = canvas.parentElement.querySelector('.chart-runtime-state');
        return {
          hidden: canvas.hidden,
          painted,
          rendered: canvas.dataset.dashboardRendered,
          state: canvas.dataset.chartState,
          role: canvas.getAttribute('role'),
          label: canvas.getAttribute('aria-label'),
          runtimeRole: runtimeState?.getAttribute('role'),
          runtimeLive: runtimeState?.getAttribute('aria-live'),
        };
      });
      assert.equal(result.hidden, false, `${id} não deveria estar oculto`);
      assert.equal(result.state, 'ready', `${id} deveria estar pronto`);
      assert.equal(result.rendered, 'true', `${id} deveria registrar renderização`);
      assert.ok(result.painted > 100, `${id} deveria conter pixels desenhados`);
      assert.equal(result.role, 'img');
      assert.ok(result.label);
      assert.equal(result.runtimeRole, 'status');
      assert.equal(result.runtimeLive, 'polite');
    }

    assert.match(await page.locator('#hero-metrics').innerText(), /COBERTURA CONFIÁVEL\s+50%/i);
    assert.match(await page.locator('#hero-metrics').innerText(), /COBERTURA BRUTA\s+75%/i);
    const opportunityText = await page.locator('#price-opportunities').innerText();
    assert.match(opportunityText, /Café Especial/);
    assert.match(opportunityText, /6,00/);
    assert.match(opportunityText, /unidade/);
    assert.match(opportunityText, /2026-01-08/);
    assert.doesNotMatch(opportunityText, /Caixa Inteligente/, 'valor reaproveitado não pode entrar em oportunidades');
    assert.doesNotMatch(opportunityText, /Echo Pop|Produto Falhou/);
    const riskText = await page.locator('#risk-list').innerText();
    assert.match(riskText, /Caixa Inteligente/);
    assert.match(riskText, /Produto Falhou/);
    assert.match(riskText, /Echo Pop/);
    assert.equal(await page.locator('#products-tbody img').count(), 0, 'títulos coletados precisam permanecer escapados');
    assert.equal(await page.locator('a[href^="javascript:"], a[href^="data:"]').count(), 0, 'links coletados exigem http(s)');
    const carriedRowText = await page.locator('#products-tbody tr[data-product-id="speaker"]').innerText();
    assert.match(carriedRowText, /Reaproveitado após falha/i);
    assert.match(carriedRowText, /Valor histórico reaproveitado/);
    assert.match(carriedRowText, /última observação de 2026-01-07/);
    assert.match(carriedRowText, /Tentativa atual falhou: bloqueio temporário/);
    assert.doesNotMatch(carriedRowText, /Preço encontrado na coleta atual/);
    const failedRowText = await page.locator('#products-tbody tr[data-product-id="failed"]').innerText();
    assert.match(failedRowText, /Sem valor atual publicável/);
    assert.match(failedRowText, /Falha definitiva/i);

    let snapshot = await historySnapshot(page);
    assert.ok(snapshot.datasets.some((dataset) => dataset.label === 'Café Especial' && dataset.data[0] === 100));
    assert.ok(snapshot.datasets.some((dataset) => dataset.label === 'Produto Falhou' && dataset.data.at(-1) === null));
    assert.ok(!snapshot.datasets.some((dataset) => dataset.label === 'Produto Legado'));

    const coffeePoint = await page.locator('#history-chart').evaluate((canvas) => {
      const chart = canvas.__dashboardChart;
      const datasetIndex = chart.config.data.datasets.findIndex((dataset) => dataset.label === 'Café Especial');
      const point = chart.getDatasetMeta(datasetIndex).data.find(Boolean);
      return { x: point.x, y: point.y };
    });
    await page.locator('#history-chart').scrollIntoViewIfNeeded();
    const initialChartBox = await page.locator('#history-chart').boundingBox();
    await page.mouse.click(initialChartBox.x + coffeePoint.x, initialChartBox.y + coffeePoint.y);
    await page.waitForFunction(() => document.querySelector('#chart-scope')?.value === 'single-product');
    assert.equal(await page.locator('#product-select').inputValue(), 'coffee');
    await page.locator('#dashboard-reset-filters').click();
    await waitForHistoryState(page);

    await page.locator('#advanced-filters').evaluate((details) => { details.open = true; });
    await page.locator('#hide-legacy-series').uncheck();
    snapshot = await historySnapshot(page);
    assert.ok(snapshot.datasets.some((dataset) => dataset.label === 'Produto Legado'));
    await page.locator('#history-category-filter').selectOption('mercado');
    snapshot = await historySnapshot(page);
    assert.deepEqual(snapshot.datasets.map((dataset) => dataset.label), ['Café Especial']);
    await page.locator('#dashboard-reset-filters').click();
    await waitForHistoryState(page);

    await page.locator('#chart-scope').selectOption('by-category');
    await waitForHistoryState(page);
    snapshot = await historySnapshot(page);
    assert.ok(snapshot.datasets.every((dataset) => dataset.unit === 'index'));
    assert.ok(snapshot.datasets.some((dataset) => dataset.label === 'Mercado'));

    await page.locator('#chart-scope').selectOption('comparison-group');
    await page.locator('#product-select').selectOption('coffee');
    await waitForHistoryState(page);
    snapshot = await historySnapshot(page);
    assert.deepEqual(snapshot.datasets.map((dataset) => dataset.label), ['Loja A', 'Loja B']);
    assert.ok(snapshot.datasets.every((dataset) => dataset.unit === 'BRL/unidade'));
    await page.locator('#include-suspicious-series').check();
    snapshot = await historySnapshot(page);
    const auditSeries = snapshot.datasets.find((dataset) => dataset.label === 'Loja Auditoria');
    assert.ok(auditSeries);
    assert.equal(auditSeries.suspicious.at(-1), true);

    await page.locator('#include-suspicious-series').uncheck();
    await page.locator('#chart-scope').selectOption('single-product');
    await page.locator('#product-select').selectOption('speaker');
    await waitForHistoryState(page);
    const carriedSemantics = await page.locator('#history-chart').evaluate((canvas) => {
      const chart = canvas.__dashboardChart;
      const dataset = chart.config.data.datasets[0];
      const lastIndex = dataset.data.length - 1;
      const label = chart.config.options.plugins.tooltip.callbacks.label({
        dataset,
        dataIndex: lastIndex,
        parsed: { y: dataset.data[lastIndex] },
      });
      return {
        label,
        status: dataset._points[lastIndex].status,
        dash: dataset.segment.borderDash({ p0DataIndex: lastIndex - 1, p1DataIndex: lastIndex }),
      };
    });
    assert.equal(carriedSemantics.status, 'carried_forward');
    assert.deepEqual(carriedSemantics.dash, [7, 5]);
    assert.match(carriedSemantics.label, /reaproveitado/);

    const chartPoint = await page.locator('#history-chart').evaluate((canvas) => {
      const chart = canvas.__dashboardChart;
      const point = chart.getDatasetMeta(0).data.at(-1);
      return { x: point.x, y: point.y };
    });
    await page.locator('#history-chart').scrollIntoViewIfNeeded();
    const chartBox = await page.locator('#history-chart').boundingBox();
    await page.mouse.move(chartBox.x + chartPoint.x, chartBox.y + chartPoint.y);
    await page.waitForFunction(() => !document.querySelector('#history-hover-tooltip')?.hidden);
    assert.match(await page.locator('#history-hover-tooltip').innerText(), /Caixa Inteligente|Preço reaproveitado/);

    await page.locator('#dashboard-reset-filters').click();
    await page.locator('#status-filter').selectOption('hard_failure');
    await waitForHistoryState(page);
    snapshot = await historySnapshot(page);
    assert.deepEqual(snapshot.datasets.map((dataset) => dataset.label), ['Produto Falhou']);
    assert.equal(snapshot.datasets[0].data.at(-1), null);
    assert.match(await page.locator('#products-tbody').innerText(), /Produto Falhou/);
    await page.locator('#status-filter').selectOption('carried_forward');
    await waitForHistoryState(page);
    snapshot = await historySnapshot(page);
    assert.deepEqual(snapshot.datasets.map((dataset) => dataset.label), ['Caixa Inteligente']);

    await page.locator('#dashboard-reset-filters').click();
    await page.locator('#zoom-in').click();
    assert.equal(await page.locator('#zoom-out').isDisabled(), false);
    await page.locator('#zoom-reset').click();
    assert.equal(await page.locator('#zoom-out').isDisabled(), true);
    await page.locator('#site-filter').selectOption('Loja A');
    assert.match(await page.locator('#active-filter-pills').innerText(), /Loja: Loja A/);
    await page.locator('#dashboard-search').fill('produto-que-nao-existe-xyz');
    await waitForHistoryState(page, 'empty');
    assert.equal(await page.locator('#history-chart').getAttribute('data-dashboard-rendered'), null);
    assert.match(await page.locator('#products-tbody').innerText(), /Nenhuma intenção/);
    await page.locator('#dashboard-reset-filters').click();
    await waitForHistoryState(page);

    const initialTheme = await page.locator('html').getAttribute('data-theme');
    const initialCanvasPixel = await page.locator('#history-chart').evaluate((canvas) => (
      [...canvas.getContext('2d').getImageData(1, 1, 1, 1).data]
    ));
    await page.locator('[data-theme-toggle]').first().click();
    await page.waitForFunction((theme) => document.documentElement.dataset.theme !== theme, initialTheme);
    assert.equal(await page.locator('#history-chart').getAttribute('data-chart-state'), 'ready');
    const updatedCanvasPixel = await page.locator('#history-chart').evaluate((canvas) => (
      [...canvas.getContext('2d').getImageData(1, 1, 1, 1).data]
    ));
    assert.notDeepEqual(updatedCanvasPixel, initialCanvasPixel, 'o canvas deve refletir a troca real de tema');
    assert.equal(initialCanvasPixel[3], 255);
    assert.equal(updatedCanvasPixel[3], 255);

    const firstRow = page.locator('#products-tbody tr[data-product-id="coffee"]');
    await firstRow.focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#chart-scope').inputValue(), 'single-product');
    assert.equal(await page.locator('#product-select').inputValue(), 'coffee');

    await page.locator('#open-add-modal').click();
    await page.waitForFunction(() => document.activeElement?.id === 'close-add-modal');
    assert.equal(await page.locator('.app-shell').evaluate((element) => element.inert), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Abrir Issue no GitHub');
    await page.locator('[data-field="name"]').first().fill('<img src=x onerror="window.__escaped=false">');
    await page.locator('#ap-add-item').click();
    assert.equal(await page.locator('#ap-items img').count(), 0, 'conteúdo do formulário precisa permanecer escapado');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#add-modal').getAttribute('aria-hidden'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'open-add-modal');
    assert.equal(await page.locator('.app-shell').evaluate((element) => element.inert), false);

    for (const width of [861, 1181, 1265]) {
      await page.setViewportSize({ width, height: 900 });
      const compactLayout = await page.evaluate(() => {
        const bar = document.querySelector('.history-toolbar-panel > .filter-bar').getBoundingClientRect();
        const children = [...document.querySelectorAll('.history-toolbar-panel > .filter-bar > *')]
          .map((element) => element.getBoundingClientRect());
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          barLeft: bar.left,
          barRight: bar.right,
          minChildLeft: Math.min(...children.map((rect) => rect.left)),
          maxChildRight: Math.max(...children.map((rect) => rect.right)),
        };
      });
      assert.ok(compactLayout.overflow <= 1, `a página não deve transbordar em ${width}px: ${JSON.stringify(compactLayout)}`);
      assert.ok(compactLayout.minChildLeft >= compactLayout.barLeft - 1, `filtro escapou à esquerda em ${width}px`);
      assert.ok(compactLayout.maxChildRight <= compactLayout.barRight + 1, `filtro escapou à direita em ${width}px`);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok((await page.locator('#history-section').boundingBox()).width <= 390);
    const mobileLayout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      offenders: [...document.querySelectorAll('body *')].map((element) => ({
        tag: element.tagName,
        id: element.id,
        className: typeof element.className === 'string' ? element.className : '',
        right: Math.round(element.getBoundingClientRect().right),
        width: Math.round(element.getBoundingClientRect().width),
      })).filter((entry) => entry.right > document.documentElement.clientWidth + 1).slice(0, 8),
    }));
    assert.ok(mobileLayout.overflow <= 1, `a página móvel não deve produzir overflow horizontal: ${JSON.stringify(mobileLayout)}`);
    const mobileLabel = await page.locator('#products-tbody tr').first().locator('td').nth(3).evaluate((cell) => (
      getComputedStyle(cell, '::before').content.replaceAll('"', '')
    ));
    assert.equal(mobileLabel, 'Origem do valor');

    assert.deepEqual(diagnostics.consoleErrors, []);
    assert.deepEqual(diagnostics.pageErrors, []);
    assert.deepEqual(diagnostics.failedResponses, []);
    assert.deepEqual(diagnostics.failedRequests, []);
  } catch (error) {
    await saveFailureArtifacts(page, 'dashboard-main', error);
    throw error;
  } finally {
    await page.close();
  }
});

test('gestão mantém escaping, modal acessível e rótulos móveis coerentes', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await neutralizeExternalAssets(page);
    const diagnostics = monitorPage(page);
    const managedProducts = [
      ...fixtureProducts,
      {
        id: 'unsafe-name',
        name: '<img src=x onerror="window.__manageEscaped=false">',
        category: 'auditoria',
        required_terms: ['teste'],
        stores: ['amazon'],
        is_active: true,
      },
    ];
    await page.route('**/data/products.json', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(managedProducts),
    }));
    await page.goto(`${baseUrl}manage.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#products-manage-tbody button[data-action="edit"]');

    assert.equal(await page.locator('#products-manage-tbody img').count(), 0);
    await page.locator('#open-add').click();
    await page.waitForFunction(() => document.activeElement?.id === 'close-manage-modal');
    assert.equal(await page.locator('#manage-modal').getAttribute('aria-hidden'), 'false');
    assert.equal(await page.locator('.app-shell').evaluate((element) => element.inert), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Abrir Issue de Alteração');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#manage-modal').getAttribute('aria-hidden'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'open-add');
    assert.equal(await page.locator('.app-shell').evaluate((element) => element.inert), false);

    const editButton = page.locator('#products-manage-tbody button[data-action="edit"]').first();
    await editButton.click();
    await page.waitForFunction(() => document.activeElement?.id === 'close-manage-modal');
    await page.locator('#close-manage-modal').click();
    assert.equal(await editButton.evaluate((element) => document.activeElement === element), true);

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileLabels = await page.locator('#products-manage-tbody tr').first().locator('td').evaluateAll((cells) => (
      cells.slice(1, 4).map((cell) => getComputedStyle(cell, '::before').content.replaceAll('"', ''))
    ));
    assert.deepEqual(mobileLabels, ['Categoria', 'Lojas', 'Obrigatórios']);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1));
    assert.deepEqual(diagnostics.consoleErrors, []);
    assert.deepEqual(diagnostics.pageErrors, []);
    assert.deepEqual(diagnostics.failedResponses, []);
    assert.deepEqual(diagnostics.failedRequests, []);
  } catch (error) {
    await saveFailureArtifacts(page, 'manage-accessibility', error);
    throw error;
  } finally {
    await page.close();
  }
});

test('run fatal mais recente do manifesto prevalece sobre latest antigo sem apagar o histórico', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await neutralizeExternalAssets(page);
    const diagnostics = monitorPage(page);
    const fulfillJson = (route, payload) => route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(payload),
    });
    await page.route('**/data/latest.json', (route) => fulfillJson(route, fixtureLatest));
    await page.route('**/data/runs/index.json', (route) => fulfillJson(route, fatalManifest));
    await page.route(`**/data/runs/${fatalRun.run_id}.json`, (route) => fulfillJson(route, fatalRun));
    await page.route(`**/data/errors/${fatalRun.run_id}.json`, (route) => fulfillJson(route, fatalError));

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.dashboardReady === 'true');

    assert.equal(await page.locator('#overview-status').innerText(), 'Falha fatal');
    assert.match(await page.locator('#generated-at').innerText(), /09\/01\/2026/);
    assert.match(await page.locator('#overall-narrative').innerText(), /Catálogo indisponível/);
    assert.match(await page.locator('#overall-narrative').innerText(), /snapshot anterior permanece somente como histórico/i);
    assert.match(await page.locator('#hero-metrics').innerText(), /ESTADO OPERACIONAL\s+Fatal/i);
    assert.equal(await page.locator('#latest-json-link').getAttribute('data-state'), 'stale-snapshot');
    assert.match(await page.locator('#products-tbody').innerText(), /falha definitiva/i);
    assert.doesNotMatch(await page.locator('#price-opportunities').innerText(), /Café Especial|Caixa Inteligente/);
    assert.match(await page.locator('#history-run-drilldown').innerText(), /fatal/i);

    const snapshot = await historySnapshot(page);
    const coffee = snapshot.datasets.find((dataset) => dataset.label === 'Café Especial');
    assert.ok(coffee);
    assert.equal(coffee.data.at(-1), null);
    assert.equal(coffee.statuses.at(-1), 'hard_failure');
    assert.ok(coffee.data.slice(0, -1).some((value) => value !== null));
    assert.deepEqual(diagnostics.consoleErrors, []);
    assert.deepEqual(diagnostics.pageErrors, []);
    assert.deepEqual(diagnostics.failedResponses, []);
    assert.deepEqual(diagnostics.failedRequests, []);
  } catch (error) {
    await saveFailureArtifacts(page, 'dashboard-fatal-operational-run', error);
    throw error;
  } finally {
    await page.close();
  }
});

test('manifesto corrompido produz estado de erro acionável sem gráfico enganoso', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await neutralizeExternalAssets(page);
    await page.route('**/runs/index.json', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{ manifesto corrompido',
    }));
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.dashboardReady === 'error');
    assert.match(await page.locator('#summary-grid').textContent(), /Erro/);
    const states = await page.locator('canvas').evaluateAll((canvases) => canvases.map((canvas) => canvas.dataset.chartState));
    assert.deepEqual(states, ['error', 'error', 'error', 'error', 'error']);
    assert.match(await page.locator('.chart-runtime-state[data-state="error"]').first().textContent(), /Falha ao carregar o dashboard/);
  } catch (error) {
    await saveFailureArtifacts(page, 'dashboard-corrupt-manifest', error);
    throw error;
  } finally {
    await page.close();
  }
});

test('runtime visual indisponível mantém dados textuais e estados acionáveis', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await neutralizeExternalAssets(page);
    const diagnostics = monitorPage(page);
    await page.route(/\/vendor\/visuals-runtime\.js(?:\?.*)?$/, (route) => route.fulfill({
      status: 200,
      contentType: 'text/javascript; charset=utf-8',
      body: '',
    }));
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.dashboardReady === 'true');
    const states = await page.locator('canvas').evaluateAll((canvases) => canvases.map((canvas) => ({
      state: canvas.dataset.chartState,
      rendered: canvas.dataset.dashboardRendered,
      hidden: canvas.hidden,
    })));
    assert.ok(states.every((state) => state.state === 'unavailable' && state.rendered === undefined && state.hidden));
    assert.match(await page.locator('.chart-runtime-state[data-state="unavailable"]').first().innerText(), /runtime de gráficos não foi carregado/i);
    assert.match(await page.locator('#products-tbody').innerText(), /Café Especial/);
    assert.deepEqual(diagnostics.consoleErrors, []);
    assert.deepEqual(diagnostics.pageErrors, []);
    assert.deepEqual(diagnostics.failedResponses, []);
    assert.deepEqual(diagnostics.failedRequests, []);
  } catch (error) {
    await saveFailureArtifacts(page, 'dashboard-chart-unavailable', error);
    throw error;
  } finally {
    await page.close();
  }
});

test('dados reais carregam como smoke separado sem impor conteúdo volátil', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await neutralizeExternalAssets(page);
    const diagnostics = monitorPage(page);
    await page.goto(realDataUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.dashboardReady === 'true', null, { timeout: 45_000 });
    const states = await page.locator('canvas').evaluateAll((canvases) => canvases.map((canvas) => canvas.dataset.chartState));
    assert.ok(states.every((state) => ['ready', 'empty'].includes(state)));
    assert.deepEqual(diagnostics.consoleErrors, []);
    assert.deepEqual(diagnostics.pageErrors, []);
    assert.deepEqual(diagnostics.failedResponses, []);
    assert.deepEqual(diagnostics.failedRequests, []);
  } catch (error) {
    await saveFailureArtifacts(page, 'dashboard-real-data-smoke', error);
    throw error;
  } finally {
    await page.close();
  }
});
