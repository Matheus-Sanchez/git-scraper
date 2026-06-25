import assert from 'node:assert/strict';
import test from 'node:test';
import { extractOfferAttributes } from '../src/search/unit.js';
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
