import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  checkBrowserReadiness,
  runSearchEngine,
} from '../src/engines/engine_search.js';

const runtimeEnv = {
  CONCURRENCY: 1,
  HTTP_TIMEOUT_MS: 10,
  LIGHTPANDA_CDP_URL: 'ws://127.0.0.1:9222',
  SEARCH_TOP_N_PER_STORE: 5,
  USER_AGENT: 'git-scraper-test',
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

async function readFixture(name) {
  return readFile(join(process.cwd(), 'test', 'fixtures', name), 'utf8');
}

function makeIntent(overrides = {}) {
  return {
    id: 'memoria-ddr4',
    name: 'Memoria Kingston',
    characteristics: 'DDR4 16GB 3200MHz',
    stores: ['kabum'],
    required_terms: ['memoria', 'kingston'],
    required_attributes: { memory_type: 'ddr4' },
    excluded_terms: [],
    ...overrides,
  };
}

function makeBrowser({
  html,
  htmlForUrl,
  readinessHtml = '<html><title>git-scraper-browser-ready</title><main>git-scraper-browser-ready</main></html>',
  gotoError,
  contentError,
  status = 200,
  closeError = null,
  maxContextCreations = Number.POSITIVE_INFINITY,
} = {}) {
  const calls = {
    contextsClosed: 0,
    contextCreations: 0,
    pagesClosed: 0,
    browsersClosed: 0,
    contextOptions: [],
    visitedUrls: [],
  };
  const browser = {
    async newContext(options) {
      calls.contextOptions.push(options);
      calls.contextCreations += 1;
      if (calls.contextCreations > maxContextCreations) {
        throw new Error('browser.newContext: Protocol error (Target.createBrowserContext): Cannot have more than one browser context at a time');
      }
      return {
        async newPage() {
          let currentUrl = '';
          return {
            async goto(url) {
              currentUrl = url;
              calls.visitedUrls.push(url);
              if (!url.startsWith('data:') && gotoError) throw gotoError;
              return { status: () => status };
            },
            async content() {
              if (!currentUrl.startsWith('data:') && contentError) throw contentError;
              return currentUrl.startsWith('data:')
                ? readinessHtml
                : (typeof htmlForUrl === 'function' ? htmlForUrl(currentUrl) : (html || ''));
            },
            url() {
              return currentUrl;
            },
            async close() {
              calls.pagesClosed += 1;
            },
          };
        },
        async close() {
          calls.contextsClosed += 1;
        },
      };
    },
    async close() {
      calls.browsersClosed += 1;
      if (closeError) throw closeError;
    },
  };

  return { browser, calls };
}

test('checkBrowserReadiness renders a local marker and always closes its context', async () => {
  const ready = makeBrowser();
  assert.equal(await checkBrowserReadiness(ready.browser, { timeoutMs: 10 }), true);
  assert.equal(ready.calls.contextsClosed, 1);
  assert.match(ready.calls.visitedUrls[0], /^data:text\/html/);

  const notReady = makeBrowser({ readinessHtml: '<html>not ready</html>' });
  await assert.rejects(() => checkBrowserReadiness(notReady.browser), /expected marker/);
  assert.equal(notReady.calls.contextsClosed, 1);
});

test('runSearchEngine uses a ready Lightpanda and skips Chromium', async () => {
  const html = await readFixture('search-kabum.html');
  const lightpanda = makeBrowser({ html });
  let chromiumCalls = 0;
  const attempts = await runSearchEngine([makeIntent()], {
    env: runtimeEnv,
    logger: noopLogger,
    sleepFn: async () => undefined,
    browserFactories: {
      lightpanda: async () => lightpanda.browser,
      chromium: async () => {
        chromiumCalls += 1;
        return makeBrowser({ html }).browser;
      },
    },
  });

  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].ok, true);
  assert.equal(attempts[0].engine, 'lightpanda_search');
  assert.equal(attempts[0].result.price, 199.9);
  assert.equal(chromiumCalls, 0);
  assert.equal(lightpanda.calls.contextsClosed, 1);
  assert.equal(lightpanda.calls.browsersClosed, 1);
});

test('runSearchEngine reuses one Lightpanda context for readiness and every search page', async () => {
  const html = await readFixture('search-kabum.html');
  const lightpanda = makeBrowser({ html, maxContextCreations: 1 });
  let chromiumCalls = 0;
  const attempts = await runSearchEngine([
    makeIntent(),
    makeIntent({ id: 'memoria-ddr4-2' }),
  ], {
    env: runtimeEnv,
    logger: noopLogger,
    sleepFn: async () => undefined,
    browserFactories: {
      lightpanda: async () => lightpanda.browser,
      chromium: async () => {
        chromiumCalls += 1;
        return makeBrowser({ html }).browser;
      },
    },
  });

  assert.equal(attempts.length, 2);
  assert.ok(attempts.every((attempt) => attempt.ok));
  assert.equal(chromiumCalls, 0);
  assert.equal(lightpanda.calls.contextCreations, 1);
  assert.equal(lightpanda.calls.contextsClosed, 1);
  assert.equal(lightpanda.calls.pagesClosed, 3);
});

test('runSearchEngine falls back to Chromium on Lightpanda launch failure', async () => {
  const html = await readFixture('search-kabum.html');
  const chromium = makeBrowser({ html });
  const attempts = await runSearchEngine([makeIntent()], {
    env: runtimeEnv,
    logger: noopLogger,
    sleepFn: async () => undefined,
    browserFactories: {
      lightpanda: async () => { throw new Error('browserType.launch failed for test'); },
      chromium: async () => chromium.browser,
    },
  });

  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].error_code, 'browser_launch_failed');
  assert.equal(attempts[1].ok, true);
  assert.equal(attempts[1].fallback_from, 'lightpanda_search');
  assert.equal(attempts[1].fallback_reason, 'browser_launch_failed');
  assert.equal(attempts[1].result.fallback_reason, 'browser_launch_failed');
  assert.equal(chromium.calls.contextsClosed, 1);
  assert.equal(chromium.calls.browsersClosed, 1);
  assert.equal(chromium.calls.contextOptions[0].userAgent, 'git-scraper-test');
});

test('runSearchEngine classifies an unavailable Lightpanda CDP endpoint separately from launch errors', async () => {
  const html = await readFixture('search-kabum.html');
  const chromium = makeBrowser({ html });
  const attempts = await runSearchEngine([makeIntent()], {
    env: runtimeEnv,
    logger: noopLogger,
    sleepFn: async () => undefined,
    browserFactories: {
      lightpanda: async () => { throw new Error('browserType.connectOverCDP: WebSocket error: connect ECONNREFUSED 127.0.0.1:9222'); },
      chromium: async () => chromium.browser,
    },
  });

  assert.equal(attempts[0].error_code, 'browser_connection_failed');
  assert.equal(attempts[0].failure_stage, 'browser_connect');
  assert.equal(attempts[1].fallback_reason, 'browser_connection_failed');
  assert.equal(attempts[1].ok, true);
});

test('a failed Lightpanda readiness probe makes Chromium the run browser', async () => {
  const html = await readFixture('search-kabum.html');
  const lightpanda = makeBrowser({ readinessHtml: '<html>CDP connected but renderer unavailable</html>' });
  const chromium = makeBrowser({ html });
  const attempts = await runSearchEngine([makeIntent()], {
    env: runtimeEnv,
    logger: noopLogger,
    sleepFn: async () => undefined,
    browserFactories: {
      lightpanda: async () => lightpanda.browser,
      chromium: async () => chromium.browser,
    },
  });

  assert.equal(attempts[0].error_code, 'browser_readiness_failed');
  assert.equal(attempts[0].failure_stage, 'browser_readiness');
  assert.equal(attempts[1].ok, true);
  assert.equal(attempts[1].fallback_reason, 'browser_readiness_failed');
  assert.equal(lightpanda.calls.contextsClosed, 1);
  assert.equal(lightpanda.calls.browsersClosed, 1);
});

test('navigation timeout falls back and closes both browser contexts', async () => {
  const html = await readFixture('search-kabum.html');
  const timeout = new Error('page.goto: Timeout 10000ms exceeded');
  timeout.name = 'TimeoutError';
  const lightpanda = makeBrowser({ html, gotoError: timeout });
  const chromium = makeBrowser({ html });
  const attempts = await runSearchEngine([makeIntent()], {
    env: runtimeEnv,
    logger: noopLogger,
    sleepFn: async () => undefined,
    browserFactories: {
      lightpanda: async () => lightpanda.browser,
      chromium: async () => chromium.browser,
    },
  });

  assert.equal(attempts[0].ok, false);
  assert.equal(attempts[0].store_errors[0].error_code, 'navigation_timeout');
  assert.equal(attempts[1].ok, true);
  assert.equal(attempts[1].fallback_reason, 'navigation_timeout');
  assert.equal(lightpanda.calls.contextsClosed, 1);
  assert.equal(lightpanda.calls.browsersClosed, 1);
  assert.equal(chromium.calls.contextsClosed, 1);
  assert.equal(chromium.calls.browsersClosed, 1);
});

test('both browser launch failures are returned with explicit fallback telemetry', async () => {
  const attempts = await runSearchEngine([makeIntent()], {
    env: runtimeEnv,
    logger: noopLogger,
    browserFactories: {
      lightpanda: async () => { throw new Error('browserType.launch failed: Lightpanda'); },
      chromium: async () => { throw new Error('browserType.launch failed: Chromium'); },
    },
  });

  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts.map((attempt) => [attempt.engine, attempt.ok, attempt.error_code]), [
    ['lightpanda_search', false, 'browser_launch_failed'],
    ['chromium_search', false, 'browser_launch_failed'],
  ]);
  assert.equal(attempts[1].fallback_reason, 'browser_launch_failed');
});

test('disabled backlog stores are not visited even when retained in the catalog intent', async () => {
  const html = await readFixture('search-kabum.html');
  const lightpanda = makeBrowser({ html });
  const attempts = await runSearchEngine([makeIntent({ stores: ['kabum', 'petz', 'shopee'] })], {
    env: runtimeEnv,
    logger: noopLogger,
    sleepFn: async () => undefined,
    browserFactories: { lightpanda: async () => lightpanda.browser },
  });

  assert.equal(attempts[0].ok, true);
  assert.equal(attempts[0].stores_checked, 1);
  assert.deepEqual(lightpanda.calls.visitedUrls.filter((url) => !url.startsWith('data:')), [
    'https://www.kabum.com.br/busca/memoria-kingston-ddr4-16gb-3200mhz',
  ]);
});

test('store outcomes preserve a successful store and a failed store in the same intent attempt', async () => {
  const lightpanda = makeBrowser({
    htmlForUrl(url) {
      if (url.includes('amazon.com.br')) {
        return `
          <div data-component-type="s-search-result">
            <h2><a href="/Memoria-Kingston/dp/B0MEMORY"><span>Memoria Kingston DDR4 16GB</span></a></h2>
            <span class="a-price"><span class="a-offscreen">R$ 299,90</span></span>
          </div>
        `;
      }
      return '<html><title>Just a moment</title><div>captcha</div></html>';
    },
  });
  const attempts = await runSearchEngine([makeIntent({ stores: ['amazon', 'kabum'] })], {
    env: runtimeEnv,
    logger: noopLogger,
    sleepFn: async () => undefined,
    browserFactories: { lightpanda: async () => lightpanda.browser },
  });

  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].ok, true);
  assert.equal(attempts[0].result.store_id, 'amazon');
  assert.deepEqual(attempts[0].store_outcomes.map((outcome) => ({
    store_id: outcome.store_id,
    status: outcome.status,
    error_code: outcome.error_code || null,
  })), [
    { store_id: 'amazon', status: 'fresh_success', error_code: null },
    { store_id: 'kabum', status: 'hard_failure', error_code: 'captcha_or_block' },
  ]);
  assert.deepEqual(attempts[0].result.store_outcomes, attempts[0].store_outcomes);
});

test('an explicit smoke allowlist can visit one registered backlog store without enabling it globally', async () => {
  const html = await readFixture('search-petz.html');
  const lightpanda = makeBrowser({ html });
  const intent = makeIntent({
    id: 'racao-golden',
    name: 'Racao Golden',
    characteristics: 'adultos frango 10kg',
    stores: ['petz', 'kabum'],
    required_terms: ['racao', 'golden'],
    required_attributes: {},
    unit_rule: { basis: 'kg' },
  });
  const attempts = await runSearchEngine([intent], {
    env: runtimeEnv,
    logger: noopLogger,
    sleepFn: async () => undefined,
    allowedStoreIds: ['petz'],
    browserFactories: { lightpanda: async () => lightpanda.browser },
  });

  assert.equal(attempts[0].ok, true);
  assert.equal(attempts[0].result.store_id, 'petz');
  assert.equal(attempts[0].stores_checked, 1);
  assert.deepEqual(lightpanda.calls.visitedUrls.filter((url) => !url.startsWith('data:')), [
    'https://www.petz.com.br/busca?q=Racao%20Golden%20adultos%20frango%2010kg',
  ]);
});

test('Chromium receives the configured proxy without exposing it to Lightpanda contexts', async () => {
  const html = await readFixture('search-kabum.html');
  const chromium = makeBrowser({ html });
  await runSearchEngine([makeIntent()], {
    env: {
      ...runtimeEnv,
      PROXY_URL: 'http://agent:secret@proxy.example:8080',
    },
    logger: noopLogger,
    sleepFn: async () => undefined,
    browserFactories: {
      lightpanda: async () => { throw new Error('ECONNREFUSED'); },
      chromium: async () => chromium.browser,
    },
  });

  assert.deepEqual(chromium.calls.contextOptions[0].proxy, {
    server: 'http://proxy.example:8080',
    username: 'agent',
    password: 'secret',
  });
});

test('empty and blocked search pages produce auditable failures and close resources', async () => {
  const emptyLightpanda = makeBrowser({ html: '   ' });
  const blockedChromium = makeBrowser({ html: '<html>captcha robot check</html>', closeError: new Error('close failed') });
  const attempts = await runSearchEngine([makeIntent()], {
    env: runtimeEnv,
    logger: noopLogger,
    sleepFn: async () => undefined,
    browserFactories: {
      lightpanda: async () => emptyLightpanda.browser,
      chromium: async () => blockedChromium.browser,
    },
  });

  assert.equal(attempts[0].store_errors[0].error_code, 'empty_search_dom');
  assert.equal(attempts[1].store_errors[0].error_code, 'captcha_or_block');
  assert.equal(attempts[1].store_errors[0].block_marker, 'captcha');
  assert.equal(attempts[1].store_errors[0].http_status, 200);
  assert.equal(attempts[1].ok, false);
  assert.equal(attempts[1].error_code, 'captcha_or_block');
  assert.equal(attempts[1].primary_store_error.error_code, 'captcha_or_block');
  assert.equal(emptyLightpanda.calls.contextsClosed, 1);
  assert.equal(blockedChromium.calls.contextsClosed, 1);
  assert.equal(blockedChromium.calls.browsersClosed, 1);
});

test('runSearchEngine does not launch browsers for an empty intent list', async () => {
  let factoryCalls = 0;
  const attempts = await runSearchEngine([], {
    env: runtimeEnv,
    logger: noopLogger,
    browserFactories: {
      lightpanda: async () => {
        factoryCalls += 1;
        return makeBrowser().browser;
      },
    },
  });

  assert.deepEqual(attempts, []);
  assert.equal(factoryCalls, 0);
});
