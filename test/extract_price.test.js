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

test('extractPriceFromHtml ignores malformed custom selectors', async () => {
  const html = await readFixture('kabum-price.html');
  const product = {
    id: 'kabum-produto',
    name: 'Kabum Produto',
    url: 'https://www.kabum.com.br/produto/123',
    is_active: true,
    selectors: {
      price_css: ['h4 class="text-4xl text-secondary-500 font-bold"', '"a-offscreen"'],
    },
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

test('extractPriceFromHtml prefers current cash price over old, installment and cashback values', () => {
  const html = `
    <!doctype html>
    <html lang="pt-BR">
      <body>
        <div class="old-wrapper"><span class="old-price">Preco original R$ 999,90</span></div>
        <div class="current-wrapper"><span class="current-price">Por R$ 749,90 a vista no Pix</span></div>
        <div class="installment-wrapper"><span class="installment">10x de R$ 89,99 sem juros</span></div>
        <div class="cashback-wrapper"><span class="cashback">Cashback R$ 50,00</span></div>
      </body>
    </html>
  `;

  const extraction = extractPriceFromHtml({
    html,
    selectors: {
      price_css: ['.old-price', '.current-price', '.installment', '.cashback'],
    },
  });

  assert.equal(extraction.ok, true);
  assert.equal(extraction.price, 749.9);
});

test('extractPriceFromHtml rejects a partir de teaser prices when a current price exists', () => {
  const html = `
    <!doctype html>
    <html lang="pt-BR">
      <body>
        <div><span class="teaser">A partir de R$ 29,90</span></div>
        <div><span class="current-price">Preco atual R$ 99,90</span></div>
      </body>
    </html>
  `;

  const extraction = extractPriceFromHtml({
    html,
    selectors: {
      price_css: ['.teaser', '.current-price'],
    },
  });

  assert.equal(extraction.ok, true);
  assert.equal(extraction.price, 99.9);
});
