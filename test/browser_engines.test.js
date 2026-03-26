import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { chromium } from 'playwright';
import { runEngine2 } from '../src/engines/engine2_browser.js';
import { runEngine3 } from '../src/engines/engine3_hardmode.js';
import { makeTempDataRoot, withDataRoot } from '../test_support/data_root.js';

const noopLogger = {
  child() { return this; },
  product() {},
  info() {},
  warn() {},
  error() {},
  debug() {},
  summary() {},
};

const runtimeEnv = {
  DEBUG: false,
  CONCURRENCY: 1,
  HTTP_TIMEOUT_MS: 1000,
  PROXY_URL: '',
  SCRAPING_API_KEY: '',
  USER_AGENT: 'git-scraper-test-agent',
};

const fastSleep = async () => {};
const deterministicRandomBetween = (min) => min;

function createBrowserPage({ html, contentType = 'text/html; charset=utf-8' }) {
  let currentUrl = '';

  return {
    async goto(url) {
      currentUrl = url;
      return {
        status: () => 200,
        headers: () => ({ 'content-type': contentType }),
      };
    },
    url() {
      return currentUrl;
    },
    async content() {
      return html;
    },
    async evaluate() {},
    async screenshot() {},
  };
}

function createEngine2Browser(page) {
  return {
    async newContext() {
      return {
        async newPage() {
          return page;
        },
        async close() {},
      };
    },
    async close() {},
  };
}

function createEngine3Context(page) {
  return {
    tracing: {
      async start() {},
      async stop() {},
    },
    async addInitScript() {},
    async newPage() {
      return page;
    },
    async close() {},
  };
}

function createEngine3Page({ html }) {
  const page = createBrowserPage({ html });
  return {
    ...page,
    mouse: {
      async wheel() {},
    },
    async close() {},
  };
}

test('runEngine2 extracts a deterministic price with a mocked browser', async () => {
  const page = createBrowserPage({
    html: `
      <!doctype html>
      <html lang="pt-BR">
        <body>
          <div data-testid="price-current">R$ 174,66</div>
        </body>
      </html>
    `,
  });

  mock.method(chromium, 'launch', async () => createEngine2Browser(page));

  try {
    const attempts = await runEngine2([{
      id: 'kabum-produto',
      name: 'Kabum Produto',
      url: 'https://www.kabum.com.br/produto/123',
      is_active: true,
    }], {
      env: runtimeEnv,
      logger: noopLogger,
      runId: '2026-03-26T10-00-00-000Z',
      sleepFn: fastSleep,
    });

    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].ok, true);
    assert.equal(attempts[0].engine, 'engine2_browser');
    assert.equal(attempts[0].result.price, 174.66);
  } finally {
    mock.restoreAll();
  }
});

test('runEngine2 captures artifact metadata when the rendered DOM is empty', async () => {
  const dataRoot = await makeTempDataRoot('git-scraper-engine2-');
  const page = createBrowserPage({ html: '' });

  mock.method(chromium, 'launch', async () => createEngine2Browser(page));

  try {
    const attempts = await withDataRoot(dataRoot, async () => runEngine2([{
      id: 'produto-generico',
      name: 'Produto Generico',
      url: 'https://loja-exemplo.test/produto/1',
      is_active: true,
    }], {
      env: runtimeEnv,
      logger: noopLogger,
      runId: '2026-03-26T10-00-00-000Z',
      sleepFn: fastSleep,
    }));

    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].ok, false);
    assert.equal(attempts[0].engine, 'engine2_browser');
    assert.equal(attempts[0].error_code, 'empty_post_render_dom');
    assert.match(attempts[0].artifact_dir, /^\.cache\/debug\//);
  } finally {
    mock.restoreAll();
  }
});

test('runEngine3 extracts a deterministic price with a mocked persistent context', async () => {
  const page = createEngine3Page({
    html: `
      <!doctype html>
      <html lang="pt-BR">
        <body>
          <div class="price">R$ 321,90</div>
        </body>
      </html>
    `,
  });

  mock.method(chromium, 'launchPersistentContext', async () => createEngine3Context(page));

  try {
    const attempts = await runEngine3([{
      id: 'produto-generico',
      name: 'Produto Generico',
      url: 'https://loja-exemplo.test/produto/1',
      is_active: true,
    }], {
      env: runtimeEnv,
      logger: noopLogger,
      runId: '2026-03-26T10-00-00-000Z',
      sleepFn: fastSleep,
      randomBetweenFn: deterministicRandomBetween,
    });

    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].ok, true);
    assert.equal(attempts[0].engine, 'engine3_hardmode');
    assert.equal(attempts[0].result.price, 321.9);
  } finally {
    mock.restoreAll();
  }
});

test('runEngine3 surfaces launch failures with a stable error contract', async () => {
  mock.method(chromium, 'launchPersistentContext', async () => {
    throw new Error('browserType.launchPersistentContext: failed');
  });

  try {
    const attempts = await runEngine3([{
      id: 'produto-generico',
      name: 'Produto Generico',
      url: 'https://loja-exemplo.test/produto/1',
      is_active: true,
    }], {
      env: runtimeEnv,
      logger: noopLogger,
      runId: '2026-03-26T10-00-00-000Z',
      sleepFn: fastSleep,
      randomBetweenFn: deterministicRandomBetween,
    });

    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].ok, false);
    assert.equal(attempts[0].engine, 'engine3_hardmode');
    assert.equal(attempts[0].error_code, 'persistent_context_launch_failed');
  } finally {
    mock.restoreAll();
  }
});

test('runEngine3 captures artifact metadata when the rendered DOM is empty', async () => {
  const dataRoot = await makeTempDataRoot('git-scraper-engine3-');
  const page = createEngine3Page({ html: '' });

  mock.method(chromium, 'launchPersistentContext', async () => createEngine3Context(page));

  try {
    const attempts = await withDataRoot(dataRoot, async () => runEngine3([{
      id: 'produto-generico',
      name: 'Produto Generico',
      url: 'https://loja-exemplo.test/produto/1',
      is_active: true,
    }], {
      env: runtimeEnv,
      logger: noopLogger,
      runId: '2026-03-26T10-00-00-000Z',
      sleepFn: fastSleep,
      randomBetweenFn: deterministicRandomBetween,
    }));

    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].ok, false);
    assert.equal(attempts[0].engine, 'engine3_hardmode');
    assert.equal(attempts[0].error_code, 'empty_post_render_dom');
    assert.match(attempts[0].artifact_dir, /^\.cache\/debug\//);
  } finally {
    mock.restoreAll();
  }
});
