import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { amazonAdapter } from '../src/adapters/amazon.js';
import { kabumAdapter } from '../src/adapters/kabum.js';
import { extractPriceFromHtml } from '../src/extract/extract_price.js';

const fixturesDir = resolve(process.cwd(), 'test', 'fixtures');

async function readFixture(name) {
  return readFile(resolve(fixturesDir, name), 'utf8');
}

test('extractPriceFromHtml reads Amazon price fixture', async () => {
  const html = await readFixture('amazon-price.html');
  const product = {
    id: 'amazon-produto',
    name: 'Amazon Produto',
    url: 'https://www.amazon.com.br/dp/B09WXVH7WK',
    is_active: true,
  };

  const selectors = amazonAdapter.getSelectors(product);
  const extraction = extractPriceFromHtml({
    html,
    selectors,
    adapterCandidates: amazonAdapter.extractCandidates({ html, product }),
    adapterName: amazonAdapter.id,
  });

  assert.equal(extraction.ok, true);
  assert.equal(extraction.price, 379);
});

test('amazonAdapter classifies variation-required pages', async () => {
  const html = await readFixture('amazon-variation.html');
  const failure = amazonAdapter.classifyFailure({ html });

  assert.equal(failure?.error_code, 'variation_required');
});

test('extractPriceFromHtml reads Kabum fixture', async () => {
  const html = await readFixture('kabum-price.html');
  const product = {
    id: 'kabum-produto',
    name: 'Kabum Produto',
    url: 'https://www.kabum.com.br/produto/123',
    is_active: true,
  };

  const selectors = kabumAdapter.getSelectors(product);
  const extraction = extractPriceFromHtml({
    html,
    selectors,
    adapterCandidates: kabumAdapter.extractCandidates({ html, product }),
    adapterName: kabumAdapter.id,
  });

  assert.equal(extraction.ok, true);
  assert.equal(extraction.price, 174.66);
});
