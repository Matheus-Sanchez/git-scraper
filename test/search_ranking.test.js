import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeUnitPrice,
  extractOfferAttributes,
  quantityForUnitRule,
} from '../src/search/unit.js';
import { rankOffersForIntent } from '../src/search/ranking.js';

test('extractOfferAttributes reads RAM capacity, kit size, speed and memory type', () => {
  const attrs = extractOfferAttributes('Memória Kingston Fury Beast 16GB (2x8GB) DDR4 3200MHz');

  assert.equal(attrs.memory_type, 'ddr4');
  assert.equal(attrs.capacity_total_gb, 16);
  assert.equal(attrs.module_count, 2);
  assert.equal(attrs.module_gb, 8);
  assert.equal(attrs.speed_mhz, 3200);
});

test('extractOfferAttributes reads diaper size and package count', () => {
  const attrs = extractOfferAttributes('Fralda Pampers Confort Sec tamanho G pacote com 80 unidades');

  assert.equal(attrs.size, 'G');
  assert.equal(attrs.package_count, 80);
});

test('extractOfferAttributes reads weight, volume and generic package counts', () => {
  const weightAttrs = extractOfferAttributes('Ração Golden Adultos Frango 10kg');
  const volumeAttrs = extractOfferAttributes('Sabão líquido concentrado 1,5L');
  const countAttrs = extractOfferAttributes('Café em cápsulas intenso 30 unidades');

  assert.equal(weightAttrs.weight_kg, 10);
  assert.equal(weightAttrs.weight_g, 10000);
  assert.equal(volumeAttrs.volume_l, 1.5);
  assert.equal(volumeAttrs.volume_ml, 1500);
  assert.equal(countAttrs.package_count, 30);
});

test('ranking uses required attributes as hard filters and preferred attributes as priority', () => {
  const intent = {
    id: 'memoria-ddr4',
    name: 'Memoria RAM',
    characteristics: 'DDR4',
    required_attributes: { memory_type: 'ddr4' },
    preferred_attributes: { capacity_total_gb: 16 },
    required_terms: [],
    preferred_terms: [],
    excluded_terms: [],
  };

  const ranked = rankOffersForIntent(intent, [
    {
      store_id: 'kabum',
      store: 'KaBuM',
      title: 'Memoria Kingston DDR5 16GB 5600MHz',
      url: 'https://www.kabum.com.br/produto/1',
      price: 100,
    },
    {
      store_id: 'kabum',
      store: 'KaBuM',
      title: 'Memoria Kingston DDR4 8GB 3200MHz',
      url: 'https://www.kabum.com.br/produto/2',
      price: 120,
    },
    {
      store_id: 'kabum',
      store: 'KaBuM',
      title: 'Memoria Kingston DDR4 16GB 2666MHz',
      url: 'https://www.kabum.com.br/produto/3',
      price: 180,
    },
  ]);

  assert.equal(ranked.best.title, 'Memoria Kingston DDR4 16GB 2666MHz');
  assert.equal(ranked.best.priority_score, 1);
  assert.equal(ranked.accepted.length, 2);
  assert.equal(ranked.offers.some((offer) => offer.title.includes('DDR5') && offer.rejected), true);
});

test('ranking compares diapers by unit price when size is mandatory', () => {
  const intent = {
    id: 'fralda-g',
    name: 'Fralda',
    characteristics: 'tamanho G',
    required_terms: ['fralda'],
    required_attributes: { size: 'G' },
    excluded_terms: [],
    unit_rule: { basis: 'unit', label: 'fralda' },
  };

  const ranked = rankOffersForIntent(intent, [
    {
      store_id: 'magalu',
      store: 'Magalu',
      title: 'Fralda Baby tamanho G 40 unidades',
      url: 'https://www.magazineluiza.com.br/produto/p/a',
      price: 50,
    },
    {
      store_id: 'magalu',
      store: 'Magalu',
      title: 'Fralda Baby tamanho G 80 unidades',
      url: 'https://www.magazineluiza.com.br/produto/p/b',
      price: 80,
    },
    {
      store_id: 'magalu',
      store: 'Magalu',
      title: 'Fralda Baby tamanho M 90 unidades',
      url: 'https://www.magazineluiza.com.br/produto/p/c',
      price: 70,
    },
  ]);

  assert.equal(ranked.best.title, 'Fralda Baby tamanho G 80 unidades');
  assert.equal(ranked.best.unit_price, 1);
  assert.equal(ranked.accepted.length, 2);
});

test('ranking compares pet food by price per kg when weight is the comparison unit', () => {
  const intent = {
    id: 'racao-golden',
    name: 'Racao Golden',
    characteristics: 'adultos frango',
    required_terms: ['racao', 'golden'],
    required_attributes: {},
    excluded_terms: ['filhotes'],
    unit_rule: { basis: 'kg', label: 'kg' },
  };

  const ranked = rankOffersForIntent(intent, [
    {
      store_id: 'petz',
      store: 'Petz',
      title: 'Racao Golden Adultos Frango 10kg',
      url: 'https://www.petz.com.br/produto/a',
      price: 154.9,
    },
    {
      store_id: 'petz',
      store: 'Petz',
      title: 'Racao Golden Adultos Frango 3kg',
      url: 'https://www.petz.com.br/produto/b',
      price: 69.9,
    },
    {
      store_id: 'petz',
      store: 'Petz',
      title: 'Racao Golden Filhotes Frango 10kg',
      url: 'https://www.petz.com.br/produto/c',
      price: 119.9,
    },
  ]);

  assert.equal(ranked.best.title, 'Racao Golden Adultos Frango 10kg');
  assert.equal(ranked.best.unit_price, 15.49);
  assert.equal(ranked.accepted.length, 2);
  assert.equal(ranked.offers.some((offer) => offer.rejected_reasons.includes('excluded_term')), true);
});

test('ranking compares liquids by price per ml and accepts liter notation', () => {
  const intent = {
    id: 'sabao-liquido',
    name: 'Sabao liquido',
    characteristics: 'concentrado',
    required_terms: ['sabao', 'liquido'],
    excluded_terms: [],
    unit_rule: { basis: 'ml', label: 'ml' },
  };

  const ranked = rankOffersForIntent(intent, [
    {
      store_id: 'magalu',
      store: 'Magalu',
      title: 'Sabao liquido concentrado 500ml',
      url: 'https://www.magazineluiza.com.br/produto/p/a',
      price: 12,
    },
    {
      store_id: 'magalu',
      store: 'Magalu',
      title: 'Sabao liquido concentrado 1L',
      url: 'https://www.magazineluiza.com.br/produto/p/b',
      price: 20,
    },
  ]);

  assert.equal(ranked.best.title, 'Sabao liquido concentrado 1L');
  assert.equal(ranked.best.normalized_quantity, 1000);
  assert.equal(ranked.best.unit_price, 0.02);
});

test('ranking rejects offers without title, price or discovered URL', () => {
  const intent = {
    id: 'mouse-g203',
    name: 'Mouse Logitech G203',
    required_terms: ['mouse', 'g203'],
    excluded_terms: [],
  };

  const ranked = rankOffersForIntent(intent, [
    {
      store_id: 'mercadolivre',
      store: 'Mercado Livre',
      title: '',
      url: 'https://lista.mercadolivre.com.br/MLB-1',
      price: 129.9,
    },
    {
      store_id: 'mercadolivre',
      store: 'Mercado Livre',
      title: 'Mouse Logitech G203',
      url: '',
      price: 129.9,
    },
    {
      store_id: 'mercadolivre',
      store: 'Mercado Livre',
      title: 'Mouse Logitech G203',
      url: 'https://lista.mercadolivre.com.br/MLB-3',
      price: null,
    },
  ]);

  assert.equal(ranked.best, null);
  assert.equal(ranked.rejected_count, 3);
  assert.equal(ranked.offers.some((offer) => offer.rejected_reasons.includes('missing_title')), true);
  assert.equal(ranked.offers.some((offer) => offer.rejected_reasons.includes('missing_url')), true);
  assert.equal(ranked.offers.some((offer) => offer.rejected_reasons.includes('missing_price')), true);
});

test('unit calculations keep null and missing quantities as null instead of coercing them to zero', () => {
  assert.equal(quantityForUnitRule({ package_count: null }, { basis: 'unit' }), null);
  assert.equal(quantityForUnitRule({ package_count: '' }, { basis: 'unit' }), null);
  assert.equal(computeUnitPrice(null, { package_count: 10 }, { basis: 'unit' }), null);
  assert.equal(computeUnitPrice(99.9, { package_count: null }, { basis: 'unit' }), null);

  const ranked = rankOffersForIntent({
    id: 'fralda-g',
    name: 'Fralda',
    required_terms: ['fralda'],
    required_attributes: { size: 'G' },
    excluded_terms: [],
    unit_rule: { basis: 'unit' },
  }, [
    {
      store_id: 'amazon',
      store: 'Amazon',
      title: 'Fralda tamanho G sem quantidade informada',
      url: 'https://www.amazon.com.br/dp/A',
      price: 20,
    },
    {
      store_id: 'amazon',
      store: 'Amazon',
      title: 'Fralda tamanho G 80 unidades',
      url: 'https://www.amazon.com.br/dp/B',
      price: 80,
    },
  ]);

  assert.equal(ranked.best.url, 'https://www.amazon.com.br/dp/B');
  assert.equal(ranked.accepted.find((offer) => offer.url.endsWith('/A')).unit_price, null);
});

test('ranking chooses the stronger identity match before a much cheaper partial match', () => {
  const intent = {
    id: 'echo-pop',
    name: 'Echo Pop',
    characteristics: 'alto falante inteligente Alexa',
    required_terms: ['echo', 'pop'],
    required_attributes: { is_accessory: false },
    excluded_terms: [],
  };
  const ranked = rankOffersForIntent(intent, [
    {
      store_id: 'amazon',
      store: 'Amazon',
      title: 'Echo Pop dispositivo',
      url: 'https://www.amazon.com.br/dp/CHEAP',
      price: 49.9,
    },
    {
      store_id: 'amazon',
      store: 'Amazon',
      title: 'Echo Pop alto falante inteligente com Alexa',
      url: 'https://www.amazon.com.br/dp/CORRECT',
      price: 299.9,
    },
  ]);

  assert.equal(ranked.best.url, 'https://www.amazon.com.br/dp/CORRECT');
  assert.ok(ranked.best.match_score > ranked.accepted[1].match_score);
});

test('ranking rejects accessories and keeps accepted offers ahead of rejected ones in store audit output', () => {
  const ranked = rankOffersForIntent({
    id: 'echo-pop',
    name: 'Echo Pop',
    characteristics: 'Alexa',
    required_terms: ['echo', 'pop'],
    required_attributes: { is_accessory: false },
    excluded_terms: [],
  }, [
    {
      store_id: 'amazon',
      store: 'Amazon',
      title: 'Suporte de mesa para Echo Pop',
      url: 'https://www.amazon.com.br/dp/STAND',
      price: 29.99,
    },
    {
      store_id: 'amazon',
      store: 'Amazon',
      title: 'Echo Pop com Alexa',
      url: 'https://www.amazon.com.br/dp/ECHO',
      price: 299.99,
    },
  ], { topPerStore: 1 });

  assert.equal(ranked.best.url, 'https://www.amazon.com.br/dp/ECHO');
  assert.equal(ranked.offers.length, 1);
  assert.equal(ranked.offers[0].rejected, false);
  assert.equal(ranked.rejected_count, 1);
});

test('accessory words do not reject a main product unless the intent explicitly requires a non-accessory', () => {
  const ranked = rankOffersForIntent({
    id: 'sandisk-ultra-128',
    name: 'SanDisk Ultra 128GB',
    required_terms: ['sandisk', '128gb'],
    excluded_terms: [],
    unit_rule: { basis: 'gb' },
  }, [{
    store_id: 'amazon',
    store: 'Amazon',
    title: 'SanDisk Ultra 128GB com adaptador SD',
    url: 'https://www.amazon.com.br/dp/SANDISK',
    price: 89.9,
  }]);

  assert.equal(ranked.best?.url, 'https://www.amazon.com.br/dp/SANDISK');
  assert.equal(ranked.best?.rejected, false);
});

test('variant extraction distinguishes notebook, headset and motherboard requirements', () => {
  assert.deepEqual(
    extractOfferAttributes('Notebook Acer Aspire Go Intel Core i7 8GB RAM DDR5 SSD 512GB'),
    {
      capacity_total_gb: 8,
      module_count: 1,
      module_gb: 8,
      memory_type: 'ddr5',
      cpu_tier: 'i7',
      storage_gb: 512,
      ram_gb: 8,
      is_accessory: false,
    },
  );

  const headset = extractOfferAttributes('Headset HyperX Cloud Stinger 2 preto multiplataforma');
  assert.equal(headset.color, 'preto');
  assert.equal(headset.platform, 'multiplataforma');
  assert.equal(
    extractOfferAttributes('Headset HyperX Cloud Stinger 2 para PC, PS4, PS5 e Xbox').platform,
    'multiplataforma',
  );
  assert.equal(
    extractOfferAttributes('Headset HyperX CloudX Stinger 2 para Xbox').platform,
    'xbox',
  );

  const motherboard = extractOfferAttributes('Placa Mae ASUS TUF Gaming B760 DDR5');
  assert.equal(motherboard.chipset, 'b760');
  assert.equal(motherboard.memory_type, 'ddr5');

  const motherboardModelSuffix = extractOfferAttributes(
    'Placa Mãe ASUS TUF GAMING B760M-PLUS II, Chipset B760, Intel LGA 1700, mATX, DDR5',
  );
  assert.equal(motherboardModelSuffix.chipset, 'b760');
  assert.equal(motherboardModelSuffix.memory_type, 'ddr5');
});

test('ranking accepts a B760M motherboard when the required chipset is B760', () => {
  const ranked = rankOffersForIntent({
    id: 'asus-tuf-b760',
    name: 'Placa Mae Asus TUF Gaming B760',
    characteristics: 'DDR5',
    required_terms: ['asus', 'tuf', 'b760'],
    required_attributes: { chipset: 'b760', memory_type: 'ddr5' },
    excluded_terms: ['ddr4'],
  }, [{
    store_id: 'kabum',
    store: 'KaBuM',
    title: 'Placa Mãe ASUS TUF GAMING B760M-PLUS II, Intel LGA 1700, mATX, DDR5',
    url: 'https://www.kabum.com.br/produto/123/asus-tuf-b760m-plus-ddr5',
    price: 1399.99,
  }]);

  assert.equal(ranked.best?.attributes.chipset, 'b760');
  assert.equal(ranked.best?.rejected, false);
});
