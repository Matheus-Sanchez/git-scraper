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

test('kabum search adapter extracts available SSR products at the discounted price', async () => {
  const adapter = getSearchStoreAdapter('kabum');
  const searchUrl = adapter.buildSearchUrl('placa mae asus tuf gaming b760 ddr5');
  const html = await readFixture('search-kabum-ssr.html');
  const offers = adapter.extractSearchResults({ searchUrl, html });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].title, 'Placa-Mãe ASUS TUF GAMING B760-PLUS WIFI, INTEL, B760, ATX, DDR5, Preto - 90MB1ER0-M0EAY0');
  assert.equal(offers[0].price, 1482.99);
  assert.equal(offers[0].url, 'https://www.kabum.com.br/produto/521058/placa-mae-asus-tuf-gaming-b760-plus-wifi-intel-b760-atx-ddr5-preto-90mb1er0-m0eay0');
  assert.equal(offers[0].source, 'search-next-data');
});

test('kabum search adapter accepts only explicitly in-stock JSON-LD products', async () => {
  const adapter = getSearchStoreAdapter('kabum');
  const searchUrl = adapter.buildSearchUrl('placa mae asus tuf gaming b760 ddr5');
  const html = await readFixture('search-kabum-jsonld.html');
  const offers = adapter.extractSearchResults({ searchUrl, html });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].title, 'Placa-Mãe ASUS TUF GAMING B760-PLUS WIFI, INTEL, B760, ATX, DDR5');
  assert.equal(offers[0].price, 1482.99);
  assert.equal(offers[0].source, 'search-json-ld');
});

test('kabum normal Robótica navigation is not classified as an anti-bot page', async () => {
  const adapter = getSearchStoreAdapter('kabum');
  const html = await readFixture('search-kabum-ssr.html');

  assert.equal(adapter.classifySearchFailure(html), null);
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

test('amazon search adapter unwraps a same-domain sponsored redirect to its product URL', () => {
  const adapter = getSearchStoreAdapter('amazon');
  const offers = adapter.extractSearchResults({
    searchUrl: adapter.buildSearchUrl('echo pop'),
    html: `
      <div data-component-type="s-search-result">
        <h2>
          <a href="/sspa/click?ie=UTF8&amp;url=%2FEcho-Pop%2Fdp%2FB0ECHO123%3Ftag%3Dsponsored">
            Echo Pop com Alexa
          </a>
        </h2>
        <span class="a-price"><span class="a-offscreen">R$ 299,90</span></span>
      </div>
      <div data-component-type="s-search-result">
        <h2>
          <a href="/sspa/click?url=https%3A%2F%2Fevil.example%2Fdp%2FPHISH">
            Redirect externo
          </a>
        </h2>
        <span class="a-price"><span class="a-offscreen">R$ 1,00</span></span>
      </div>
    `,
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].price, 299.9);
  assert.equal(offers[0].url, 'https://www.amazon.com.br/Echo-Pop/dp/B0ECHO123?tag=sponsored');
});

test('amazon search adapter ignores an old a-text-price before the current price', () => {
  const adapter = getSearchStoreAdapter('amazon');
  const offers = adapter.extractSearchResults({
    searchUrl: adapter.buildSearchUrl('echo pop'),
    html: `
      <div data-component-type="s-search-result">
        <h2><a href="/Echo-Pop/dp/B0ABC123">Echo Pop com Alexa</a></h2>
        <span class="a-price a-text-price">
          <span class="a-offscreen">R$ 499,90</span>
        </span>
        <span class="a-price">
          <span class="a-offscreen">R$ 299,90</span>
        </span>
      </div>
    `,
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].price, 299.9);
});

test('current price remains eligible inside a discount wrapper', () => {
  const adapter = getSearchStoreAdapter('kabum');
  const offers = adapter.extractSearchResults({
    searchUrl: adapter.buildSearchUrl('placa mae b760'),
    html: `
      <article data-testid="product-card">
        <a href="/produto/999/placa-mae-asus-tuf-b760-ddr5">
          <h2 data-testid="product-card-name">Placa Mae ASUS TUF B760 DDR5</h2>
        </a>
        <div class="price-with-discount">
          <span data-testid="price-current">R$ 999,99</span>
        </div>
      </article>
    `,
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].price, 999.99);
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

test('search adapters reject lookalike store domains and non-http product URLs', () => {
  const adapter = getSearchStoreAdapter('amazon');
  const searchUrl = adapter.buildSearchUrl('echo pop');
  const offers = adapter.extractSearchResults({
    searchUrl,
    html: `
      <div data-component-type="s-search-result">
        <h2><a href="https://evilamazon.com.br/dp/PHISH">Echo Pop Alexa</a></h2>
        <span class="a-offscreen">R$ 99,99</span>
      </div>
      <div data-component-type="s-search-result">
        <h2><a href="ftp://amazon.com.br/dp/UNSAFE">Echo Pop Alexa</a></h2>
        <span class="a-offscreen">R$ 89,99</span>
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

  assert.deepEqual(adapter.classifySearchFailure('<html>captcha robot check</html>'), {
    error_code: 'captcha_or_block',
    error_detail: 'Amazon search blocked or anti-bot page detected (captcha)',
    block_marker: 'captcha',
  });
  assert.deepEqual(adapter.classifySearchFailure('<html>não encontramos nenhum produto</html>'), {
    error_code: 'no_search_results',
    error_detail: 'Amazon search returned no products (não encontramos)',
    empty_result_marker: 'não encontramos',
  });
  assert.equal(adapter.classifySearchFailure('<html>resultados normais</html>'), null);
  assert.equal(adapter.classifySearchFailure('<html><a href="/robotica">Robótica</a></html>'), null);
  assert.equal(adapter.classifySearchFailure('<html>robot check</html>')?.block_marker, 'robot check');
  assert.equal(adapter.classifySearchFailure('<meta http-equiv="refresh" content="0;/?bm-verify=token">')?.block_marker, 'bm-verify=');
});

test('generic card fallback ignores ratings, DPI and installment values', () => {
  const adapter = getSearchStoreAdapter('mercadolivre');
  const offers = adapter.extractSearchResults({
    searchUrl: adapter.buildSearchUrl('mouse logitech g203'),
    html: `
      <article class="product-card">
        <a href="https://www.mercadolivre.com.br/mouse-logitech-g203/p/MLB999">
          Mouse Logitech G203 Lightsync 8.000 DPI
        </a>
        <span class="rating">4.4 de 5 estrelas</span>
        <span class="installment">10x de R$ 29,40 sem juros</span>
        <span class="current-price">R$ 199,99</span>
      </article>
    `,
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].price, 199.99);
});

test('card extraction prefers current price over old price and discount amount', () => {
  const adapter = getSearchStoreAdapter('kabum');
  const offers = adapter.extractSearchResults({
    searchUrl: adapter.buildSearchUrl('placa mae b760'),
    html: `
      <article data-testid="product-card">
        <a href="/produto/999/placa-mae-asus-tuf-b760-ddr5">
          <h2 data-testid="product-card-name">Placa Mae ASUS TUF B760 DDR5</h2>
        </a>
        <span class="old-price">De R$ 1.299,99</span>
        <span class="discount">Economize R$ 300,00</span>
        <span data-testid="price-current">Por R$ 999,99 no PIX</span>
      </article>
    `,
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].price, 999.99);
});

test('card extraction parses Brazilian thousands with and without cents without truncation', () => {
  const adapter = getSearchStoreAdapter('kabum');
  const cases = [
    ['R$ 1.299', 1299],
    ['R$ 1.299,00', 1299],
    ['R$ 1299', 1299],
    ['R$ 1299,00', 1299],
  ];

  for (const [priceText, expected] of cases) {
    const offers = adapter.extractSearchResults({
      searchUrl: adapter.buildSearchUrl('placa mae b760'),
      html: `
        <article data-testid="product-card">
          <a href="/produto/999/placa-mae-asus-tuf-b760-ddr5">
            <h2 data-testid="product-card-name">Placa Mae ASUS TUF B760 DDR5</h2>
          </a>
          <span data-testid="price-current">${priceText}</span>
        </article>
      `,
    });
    assert.equal(offers[0]?.price, expected, priceText);
  }
});

test('adapter does not turn an isolated rating into a product price', () => {
  const adapter = getSearchStoreAdapter('mercadolivre');
  const offers = adapter.extractSearchResults({
    searchUrl: adapter.buildSearchUrl('mouse'),
    html: `
      <article class="product-card">
        <a href="https://www.mercadolivre.com.br/mouse/p/MLB777">Mouse Gamer 8.000 DPI</a>
        <span class="rating">4.54</span>
      </article>
    `,
  });

  assert.deepEqual(offers, []);
});
