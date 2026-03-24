import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getAdapterForUrl } from '../src/adapters/index.js';
import { extractPriceFromHtml } from '../src/extract/extract_price.js';

const fixturesDir = resolve(process.cwd(), 'test', 'fixtures');

async function readFixture(name) {
  return readFile(resolve(fixturesDir, name), 'utf8');
}

function buildProduct(id, url) {
  return {
    id,
    name: `Produto ${id}`,
    url,
    is_active: true,
  };
}

function runExtraction(adapter, product, html) {
  return extractPriceFromHtml({
    html,
    selectors: adapter.getSelectors(product),
    adapterCandidates: adapter.extractCandidates({ html, product }),
    adapterName: adapter.id,
  });
}

const cases = [
  {
    name: 'amazon routes to the dedicated adapter and extracts the canonical price fixture',
    fixture: 'amazon-price.html',
    url: 'https://www.amazon.com.br/dp/B09WXVH7WK?th=1',
    expectedAdapter: 'amazon',
    expectedPrice: 379,
  },
  {
    name: 'amazon variation fixture stays on the amazon adapter and reports variation_required',
    fixture: 'amazon-variation.html',
    url: 'https://www.amazon.com.br/dp/B09WXVH7WK?th=1',
    expectedAdapter: 'amazon',
    expectedExtractionError: 'no_candidates',
    expectedFailureCode: 'variation_required',
  },
  {
    name: 'amazon captcha fixture stays on the amazon adapter and reports captcha_or_block',
    html: `
      <!doctype html>
      <html lang="pt-BR">
        <body>
          <main>
            <h1>Robot Check</h1>
            <p>Digite os caracteres exibidos para continuar.</p>
          </main>
        </body>
      </html>
    `,
    url: 'https://www.amazon.com.br/dp/B09WXVH7WK?th=1',
    expectedAdapter: 'amazon',
    expectedExtractionError: 'no_candidates',
    expectedFailureCode: 'captcha_or_block',
  },
  {
    name: 'kabum routes to the dedicated adapter and extracts the canonical price fixture',
    fixture: 'kabum-price.html',
    url: 'https://www.kabum.com.br/produto/123',
    expectedAdapter: 'kabum',
    expectedPrice: 174.66,
  },
  {
    name: 'kabum unavailable fixture stays on the kabum adapter and reports price_not_found',
    html: `
      <!doctype html>
      <html lang="pt-BR">
        <body>
          <main>
            <h1>Produto indisponivel</h1>
            <p>Este item esta esgotado no momento.</p>
          </main>
        </body>
      </html>
    `,
    url: 'https://www.kabum.com.br/produto/123',
    expectedAdapter: 'kabum',
    expectedExtractionError: 'no_candidates',
    expectedFailureCode: 'price_not_found',
  },
  {
    name: 'kabum no-price fixture stays on the kabum adapter and surfaces a generic extraction failure',
    html: `
      <!doctype html>
      <html lang="pt-BR">
        <body>
          <main>
            <h1>Mouse Gamer</h1>
            <p>Confira detalhes, reviews e frete para a sua regiao.</p>
          </main>
        </body>
      </html>
    `,
    url: 'https://www.kabum.com.br/produto/123',
    expectedAdapter: 'kabum',
    expectedExtractionError: 'no_candidates',
    expectedFailureCode: null,
  },
];

for (const scenario of cases) {
  test(scenario.name, async () => {
    const html = scenario.fixture ? await readFixture(scenario.fixture) : String(scenario.html || '');
    const product = buildProduct(scenario.expectedAdapter, scenario.url);
    const adapter = getAdapterForUrl(product.url);

    assert.equal(adapter.id, scenario.expectedAdapter);

    const extraction = runExtraction(adapter, product, html);
    if (scenario.expectedPrice !== undefined) {
      assert.equal(extraction.ok, true);
      assert.equal(extraction.price, scenario.expectedPrice);
    } else {
      assert.equal(extraction.ok, false);
      assert.equal(extraction.error_code, scenario.expectedExtractionError);
    }

    const classifiedFailure = adapter.classifyFailure({
      html,
      product,
      extraction,
      engineName: 'engine1_http',
    });

    if (scenario.expectedFailureCode === null || scenario.expectedFailureCode === undefined) {
      assert.equal(classifiedFailure, null);
    } else {
      assert.equal(classifiedFailure?.error_code, scenario.expectedFailureCode);
    }
  });
}
