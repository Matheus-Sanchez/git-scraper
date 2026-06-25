import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { runSearchEngine } from '../src/engines/engine_search.js';

const runtimeEnv = {
  CONCURRENCY: 1,
  HTTP_TIMEOUT_MS: 10,
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

async function readFixture(name) {
  return readFile(join(process.cwd(), 'test', 'fixtures', name), 'utf8');
}

function makeBrowser(html) {
  const calls = {
    contextsClosed: 0,
    browsersClosed: 0,
    visitedUrls: [],
  };
  const browser = {
    async newContext() {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
      if (calls.browsersClosed > 0) {
        throw new Error('browser was closed before newContext completed');
      }
      return {
        async newPage() {
          return {
            async goto(url) {
              calls.visitedUrls.push(url);
              return { status: () => 200 };
            },
            async content() {
              return html;
            },
            url() {
              return calls.visitedUrls.at(-1) || '';
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
    },
  };

  return { browser, calls };
}

test('runSearchEngine uses Lightpanda first and falls back to Chromium on launch failure', async () => {
  const html = await readFixture('search-petz.html');
  const chromium = makeBrowser(html);
  let lightpandaCalls = 0;
  let chromiumCalls = 0;

  const attempts = await runSearchEngine([
    {
      id: 'racao-golden',
      name: 'Racao Golden',
      characteristics: 'adultos frango',
      stores: ['petz'],
      required_terms: ['racao', 'golden'],
      excluded_terms: [],
      unit_rule: { basis: 'kg' },
    },
  ], {
    env: runtimeEnv,
    logger: noopLogger,
    sleepFn: async () => undefined,
    browserFactories: {
      lightpanda: async () => {
        lightpandaCalls += 1;
        throw new Error('browserType.launch failed for test');
      },
      chromium: async () => {
        chromiumCalls += 1;
        return chromium.browser;
      },
    },
  });

  assert.equal(lightpandaCalls, 1);
  assert.equal(chromiumCalls, 1);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].engine, 'lightpanda_search');
  assert.equal(attempts[0].ok, false);
  assert.equal(attempts[1].engine, 'chromium_search');
  assert.equal(attempts[1].ok, true);
  assert.equal(attempts[1].result.title, 'Ração Golden Adultos Frango 10kg');
  assert.equal(attempts[1].result.unit_price, 15.49);
  assert.deepEqual(chromium.calls.visitedUrls, ['https://www.petz.com.br/busca?q=Racao%20Golden%20adultos%20frango']);
  assert.equal(chromium.calls.contextsClosed, 1);
  assert.equal(chromium.calls.browsersClosed, 1);
});
