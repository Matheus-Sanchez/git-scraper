import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { getSearchStoreAdapter } from '../src/search/store_adapters.js';

async function readFixture(name) {
  return readFile(join(process.cwd(), 'test', 'fixtures', name), 'utf8');
}

test('kabum search adapter builds search URL and extracts offer cards', async () => {
  const adapter = getSearchStoreAdapter('kabum');
  const searchUrl = adapter.buildSearchUrl('memoria ram ddr4');
  const html = await readFixture('search-kabum.html');
  const offers = adapter.extractSearchResults({
    searchUrl,
    html,
  });

  assert.equal(searchUrl, 'https://www.kabum.com.br/busca/memoria-ram-ddr4');
  assert.equal(offers.length, 1);
  assert.equal(offers[0].store_id, 'kabum');
  assert.equal(offers[0].title, 'Memória Kingston DDR4 16GB 3200MHz');
  assert.equal(offers[0].price, 199.9);
  assert.equal(offers[0].url, 'https://www.kabum.com.br/produto/123/memoria-kingston-ddr4-16gb');
});

test('search adapters build the configured store search URLs', () => {
  assert.equal(
    getSearchStoreAdapter('amazon').buildSearchUrl('ssd 1tb'),
    'https://www.amazon.com.br/s?k=ssd%201tb',
  );
  assert.equal(
    getSearchStoreAdapter('kabum').buildSearchUrl('memoria ram ddr4'),
    'https://www.kabum.com.br/busca/memoria-ram-ddr4',
  );
  assert.equal(
    getSearchStoreAdapter('mercadolivre').buildSearchUrl('mouse g203'),
    'https://lista.mercadolivre.com.br/mouse-g203',
  );
  assert.equal(
    getSearchStoreAdapter('magalu').buildSearchUrl('fralda tamanho g'),
    'https://www.magazineluiza.com.br/busca/fralda+tamanho+g/',
  );
  assert.equal(
    getSearchStoreAdapter('shopee').buildSearchUrl('capsula cafe'),
    'https://shopee.com.br/search?keyword=capsula%20cafe',
  );
  assert.equal(
    getSearchStoreAdapter('pichau').buildSearchUrl('monitor 24'),
    'https://www.pichau.com.br/search?q=monitor%2024',
  );
  assert.equal(
    getSearchStoreAdapter('petz').buildSearchUrl('racao 10kg'),
    'https://www.petz.com.br/busca?q=racao%2010kg',
  );
});

test('amazon search adapter extracts product cards', async () => {
  const adapter = getSearchStoreAdapter('amazon');
  const html = await readFixture('search-amazon.html');
  const offers = adapter.extractSearchResults({
    searchUrl: adapter.buildSearchUrl('ssd 1tb'),
    html,
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].store_id, 'amazon');
  assert.equal(offers[0].title, 'SSD Kingston NV2 1TB NVMe M.2');
  assert.equal(offers[0].price, 319.9);
  assert.equal(offers[0].url, 'https://www.amazon.com.br/Kingston-SSD-NV2-1TB/dp/B0ABC123');
});

test('search adapters reject empty links and search page URLs as product offers', () => {
  const adapter = getSearchStoreAdapter('amazon');
  const searchUrl = adapter.buildSearchUrl('echo pop');
  const offers = adapter.extractSearchResults({
    searchUrl,
    html: `
      <div data-component-type="s-search-result">
        <h2><a href="">Echo Pop Alexa</a></h2>
        <span class="a-offscreen">R$ 299,90</span>
      </div>
      <div data-component-type="s-search-result">
        <h2><a href="/s?k=echo+pop">Echo Pop Alexa</a></h2>
        <span class="a-offscreen">R$ 299,90</span>
      </div>
    `,
  });

  assert.deepEqual(offers, []);
});

test('magalu search adapter extracts product results', async () => {
  const adapter = getSearchStoreAdapter('magalu');
  const html = await readFixture('search-magalu.html');
  const offers = adapter.extractSearchResults({
    searchUrl: adapter.buildSearchUrl('fralda tamanho g'),
    html,
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].store_id, 'magalu');
  assert.equal(offers[0].price, 79.9);
});

test('mercadolivre search adapter falls back to anchor extraction', async () => {
  const adapter = getSearchStoreAdapter('mercadolivre');
  const html = await readFixture('search-mercadolivre.html');
  const offers = adapter.extractSearchResults({
    searchUrl: adapter.buildSearchUrl('mouse g203'),
    html,
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].title, 'Mouse Logitech G203 Lightsync');
  assert.equal(offers[0].price, 129.9);
});

test('shopee search adapter extracts product cards', async () => {
  const adapter = getSearchStoreAdapter('shopee');
  const html = await readFixture('search-shopee.html');
  const offers = adapter.extractSearchResults({
    searchUrl: adapter.buildSearchUrl('capsula cafe'),
    html,
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].store_id, 'shopee');
  assert.equal(offers[0].title, 'Café em cápsulas intenso 30 unidades');
  assert.equal(offers[0].price, 45.9);
});

test('pichau search adapter extracts product cards', async () => {
  const adapter = getSearchStoreAdapter('pichau');
  const html = await readFixture('search-pichau.html');
  const offers = adapter.extractSearchResults({
    searchUrl: adapter.buildSearchUrl('monitor 24'),
    html,
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].store_id, 'pichau');
  assert.equal(offers[0].title, 'Monitor Gamer Pichau 24 144Hz IPS');
  assert.equal(offers[0].price, 699.99);
});

test('petz search adapter extracts product cards', async () => {
  const adapter = getSearchStoreAdapter('petz');
  const html = await readFixture('search-petz.html');
  const offers = adapter.extractSearchResults({
    searchUrl: adapter.buildSearchUrl('racao 10kg'),
    html,
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].store_id, 'petz');
  assert.equal(offers[0].title, 'Ração Golden Adultos Frango 10kg');
  assert.equal(offers[0].price, 154.9);
});

test('search adapter classifies block and empty-result pages', () => {
  const adapter = getSearchStoreAdapter('amazon');

  assert.equal(adapter.classifySearchFailure('<html>captcha robot check</html>').error_code, 'captcha_or_block');
  assert.equal(adapter.classifySearchFailure('<html>não encontramos nenhum produto</html>').error_code, 'no_search_results');
});
