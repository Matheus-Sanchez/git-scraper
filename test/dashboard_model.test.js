import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCategoryCounts,
  buildEngineHealth,
  buildFailureBreakdown,
  buildHistoryModel,
  buildHistorySeries,
  buildOpportunities,
  buildRiskRows,
  buildStoreHealth,
  normalizeRuns,
  normalizeRunPayload,
  normalizeCategory,
  normalizeText,
  positiveNumber,
  resolveOperationalState,
  selectLatestManifestRun,
  selectRecentRunFiles,
  storeLabel,
} from '../docs/dashboard-model.js';

function run(date, { results = [], offers = [], failures = [], engines = {} } = {}) {
  return {
    run_id: `${date}T10-00-00-000Z`,
    run_date: date,
    generated_at: `${date}T10:00:00.000Z`,
    summary: {
      total_products: Math.max(results.length, 1),
      success_count: results.length,
      failure_count: failures.length,
      engines,
    },
    results,
    offers,
    failures,
  };
}

const products = [
  {
    id: 'coffee',
    name: 'Café Especial',
    category: 'mercado',
    required_terms: ['cafe'],
    unit_rule: { basis: 'kg', label: 'kg' },
    is_active: true,
  },
  {
    id: 'speaker',
    name: 'Caixa Inteligente',
    category: 'eletronicos',
    required_terms: ['caixa'],
    required_attributes: { color: 'preto' },
    is_active: true,
  },
];

test('normaliza contratos antigo e atual sem converter null em zero', () => {
  const legacy = normalizeRunPayload({
    run_date: '2026-01-01',
    generated_at: '2026-01-01T10:00:00.000Z',
    items: [{ product_id: 'coffee', name: 'Cafe', price: 20, unit_price: null, status: 'ok' }],
  }, 'legacy.json');
  assert.equal(legacy.results.length, 1);
  assert.equal(legacy.results[0].price, 20);
  assert.equal(legacy.results[0].unit_price, null);
  assert.equal(legacy.results[0].observation_status, 'fresh_success');
  assert.equal(positiveNumber(null), null);
  assert.equal(positiveNumber(0), null);

  const current = normalizeRunPayload(run('2026-01-02', {
    results: [{ product_id: 'coffee', price: 19, status: 'carried_forward', engine_used: 'carry_forward' }],
  }));
  assert.equal(current.results[0].observation_status, 'carried_forward');
});

test('baseline robusto não é contaminado quando os três primeiros preços são errados', () => {
  const payloads = Array.from({ length: 10 }, (_, index) => {
    const day = String(index + 1).padStart(2, '0');
    return run(`2026-02-${day}`, {
      results: [{
        product_id: 'speaker',
        name: 'Caixa Inteligente',
        title: 'Caixa Inteligente preta',
        attributes: { color: 'preto' },
        price: index < 3 ? 0.07 : 100,
        status: 'ok',
      }],
    });
  });
  const model = buildHistoryModel({ products, runs: payloads, limit: 20 });
  const points = model.histories.get('speaker').points;
  assert.deepEqual(points.slice(0, 3).map((point) => point.suspicious), [true, true, true]);
  assert.ok(points.slice(0, 3).every((point) => point.quality_reasons.includes('salto_de_preco_atipico')));
  assert.ok(points.slice(3).every((point) => point.suspicious === false));
});

test('atributo obrigatório ausente fica não verificado e só reaparece na auditoria', () => {
  const model = buildHistoryModel({
    products,
    runs: [run('2026-03-01', {
      results: [{ product_id: 'speaker', name: 'Caixa Inteligente', price: 100, status: 'ok' }],
    })],
  });
  const raw = model.histories.get('speaker').points[0].raw;
  assert.equal(raw.suspicious, false);
  assert.equal(raw.unverified, true);
  assert.deepEqual(raw.quality_reasons, []);
  assert.deepEqual(raw.quality_unknown_reasons, ['atributo_color_nao_informado']);
  assert.equal(buildHistorySeries(model, { scope: 'single-product', productId: 'speaker' })[0].points[0].value, null);
  assert.equal(buildHistorySeries(model, { scope: 'single-product', productId: 'speaker', includeSuspicious: true })[0].points[0].value, 100);
});

test('gera quatro modos com gaps nulos, índices, mediana e equivalentes aceitos', () => {
  const payloads = [
    run('2026-04-01', {
      results: [
        { product_id: 'coffee', name: 'Café Especial', title: 'Cafe Especial 1kg', price: 50, unit_price: 50, store: 'Loja A', status: 'ok' },
        { product_id: 'speaker', name: 'Caixa Inteligente', title: 'Caixa Inteligente preta', attributes: { color: 'preto' }, price: 200, store: 'Loja B', status: 'ok' },
      ],
      offers: [
        { product_id: 'coffee', title: 'Cafe Especial 1kg', price: 50, unit_price: 50, store: 'Loja A', rejected: false },
        { product_id: 'coffee', title: 'Cafe Especial 1kg', price: 5, unit_price: 5, store: 'Loja X', rejected: true, rejected_reasons: ['variante'] },
      ],
    }),
    run('2026-04-02', {
      results: [
        { product_id: 'coffee', name: 'Café Especial', title: 'Cafe Especial 1kg', price: 45, unit_price: 45, store: 'Loja A', status: 'carried_forward' },
        { product_id: 'speaker', name: 'Caixa Inteligente', title: 'Caixa Inteligente preta', attributes: { color: 'preto' }, price: 220, store: 'Loja B', status: 'ok' },
      ],
      offers: [
        { product_id: 'coffee', title: 'Cafe Especial 1kg', price: 47, unit_price: 47, store: 'Loja B', rejected: false },
      ],
    }),
  ];
  const model = buildHistoryModel({ products, runs: payloads, limit: 30 });

  const all = buildHistorySeries(model, { scope: 'all-products' });
  const coffeeIndex = all.find((series) => series.product_id === 'coffee');
  assert.deepEqual(coffeeIndex.points.map((point) => point.value), [100, 90]);
  assert.equal(coffeeIndex.points[1].status, 'carried_forward');

  const categories = buildHistorySeries(model, { scope: 'by-category' });
  assert.equal(categories.length, 2);
  assert.deepEqual(categories.find((series) => series.category === 'mercado').points.map((point) => point.value), [100, 90]);

  const equivalent = buildHistorySeries(model, {
    scope: 'comparison-group',
    productId: 'coffee',
  });
  assert.deepEqual(equivalent.map((series) => series.label), ['Loja A', 'Loja B']);
  assert.ok(!equivalent.some((series) => series.label === 'Loja X'));
  assert.equal(equivalent.find((series) => series.label === 'Loja A').unit, 'BRL/kg');

  const single = buildHistorySeries(model, { scope: 'single-product', productId: 'coffee' });
  assert.deepEqual(single[0].points.map((point) => point.value), [50, 45]);
  assert.equal(single[0].unit, 'BRL');
});

test('saúde da loja mantém carried-forward e falha do mesmo produto em um único estado', () => {
  const latest = run('2026-05-01', {
    results: [{ product_id: 'coffee', price: 45, store: 'Loja A', status: 'carried_forward' }],
    failures: [{ product_id: 'coffee', store: 'Loja A', error_code: 'blocked' }],
  });
  const health = buildStoreHealth(latest, [products[0]]);
  assert.deepEqual(health, [{
    store: 'Loja A',
    fresh_success: 0,
    carried_forward: 1,
    hard_failure: 0,
    total: 1,
  }]);
});

test('oportunidades exigem coleta atual e usam preço unitário quando há regra de unidade', () => {
  const payloads = [
    { price: 50, unitPrice: 5 },
    { price: 60, unitPrice: 4 },
    { price: 90, unitPrice: 3 },
  ].map(({ price, unitPrice }, index) => run(`2026-06-0${index + 1}`, {
    results: [{ product_id: 'coffee', name: 'Café Especial', title: 'Cafe Especial', price, unit_price: unitPrice, store: 'Loja A', status: 'ok' }],
  }));
  const model = buildHistoryModel({ products: [products[0]], runs: payloads });
  const opportunities = buildOpportunities(model);
  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0].price, 3);
  assert.equal(opportunities[0].total_price, 90);
  assert.equal(opportunities[0].baseline, 4.5);
  assert.equal(opportunities[0].metric, 'unit_price');
  assert.equal(opportunities[0].date, '2026-06-03');

  const staleModel = buildHistoryModel({
    products: [products[0]],
    runs: [...payloads, run('2026-06-04', {
      results: [{ product_id: 'coffee', title: 'Cafe Especial', price: 90, unit_price: 3, status: 'carried_forward' }],
    })],
  });
  assert.deepEqual(buildOpportunities(staleModel), []);
});

test('qualidade rejeita acessório e incompatibilidade explícita, mas preserva o registro para auditoria', () => {
  const speaker = {
    ...products[1],
    excluded_terms: ['branco'],
    required_attributes: { color: 'preto', is_accessory: false },
  };
  const payload = run('2026-07-01', {
    results: [
      { product_id: 'speaker', title: 'Suporte para Caixa Inteligente branco', price: 20, attributes: { color: 'branco', is_accessory: true }, status: 'ok' },
    ],
  });
  const model = buildHistoryModel({ products: [products[0], speaker], runs: [payload] });
  const point = model.histories.get('speaker').points[0];
  assert.equal(point.suspicious, true);
  assert.ok(point.quality_reasons.includes('possivel_acessorio'));
  assert.ok(point.quality_reasons.includes('termo_excluido_presente'));
  assert.ok(point.quality_reasons.includes('atributo_color_incompativel'));
  assert.equal(model.runs.at(-1).results[0].suspicious, true);
  assert.deepEqual(buildOpportunities(model), []);
  assert.equal(buildHistorySeries(model, { scope: 'single-product', productId: 'speaker' })[0].points[0].value, null);
  assert.equal(buildHistorySeries(model, { scope: 'single-product', productId: 'speaker', includeSuspicious: true })[0].points[0].value, 20);
});

test('heurística contextual não trata suporte de cabeça como acessório', () => {
  const payload = run('2026-07-01', {
    results: [{
      product_id: 'speaker',
      title: 'Caixa Inteligente preta com suporte de cabeça ajustável',
      price: 200,
      attributes: { color: 'preto' },
      status: 'ok',
    }],
  });
  const model = buildHistoryModel({ products, runs: [payload] });
  assert.equal(model.histories.get('speaker').points[0].suspicious, false);
});

test('atributo booleano serializado como texto preserva equivalência', () => {
  const product = {
    id: 'echo', name: 'Echo Pop', required_terms: ['echo', 'pop'],
    required_attributes: { is_accessory: false }, is_active: true,
  };
  const model = buildHistoryModel({
    products: [product],
    runs: [run('2026-07-01', {
      results: [{
        product_id: 'echo', title: 'Echo Pop com Alexa', price: 350,
        attributes: { is_accessory: 'false' }, status: 'ok',
      }],
    })],
  });
  const point = model.histories.get('echo').points[0];
  assert.equal(point.suspicious, false);
  assert.equal(point.unverified, false);
});

test('séries legadas são derivadas e filtros de categoria, busca, loja e status são aplicados', () => {
  const payloads = [
    run('2026-07-02', {
      results: [
        { product_id: 'coffee', name: 'Café Especial', title: 'Cafe Especial', price: 30, store: 'Loja A', status: 'ok' },
        { product_id: 'legacy-id', name: 'Produto Antigo', category: 'Legado', price: 80, store: 'Loja B', status: 'ok' },
      ],
    }),
    run('2026-07-03', {
      results: [{ product_id: 'coffee', name: 'Café Especial', title: 'Cafe Especial', price: 29, store: 'Loja A', status: 'carried_forward' }],
    }),
  ];
  const model = buildHistoryModel({ products: [products[0]], runs: payloads });
  assert.equal(model.productsById.get('legacy-id').legacy, true);
  assert.equal(model.productsById.get('legacy-id').category, 'Legado');
  assert.equal(buildHistorySeries(model, { scope: 'all-products', hideLegacy: true }).length, 1);
  assert.equal(buildHistorySeries(model, { scope: 'all-products', hideLegacy: false }).length, 2);
  assert.equal(buildHistorySeries(model, { scope: 'all-products', query: 'antigo', hideLegacy: false }).length, 1);
  assert.equal(buildHistorySeries(model, { scope: 'all-products', query: 'inexistente', hideLegacy: false }).length, 0);
  assert.equal(buildHistorySeries(model, { scope: 'all-products', category: 'mercado' }).length, 1);
  assert.equal(buildHistorySeries(model, { scope: 'all-products', category: 'audio' }).length, 0);
  assert.equal(buildHistorySeries(model, { scope: 'all-products', site: 'Loja B', hideLegacy: false }).length, 1);
  assert.equal(buildHistorySeries(model, { scope: 'all-products', status: 'carried_forward' }).length, 1);
  assert.equal(buildHistorySeries(model, { scope: 'all-products', status: 'fresh_success' }).length, 0);
  assert.equal(buildHistorySeries(model, { scope: 'all-products', status: 'hard_failure' }).length, 0);
});

test('falha definitiva preserva o histórico anterior e filtra pelo estado operacional atual', () => {
  const model = buildHistoryModel({
    products: [products[0]],
    runs: [
      run('2026-07-01', {
        results: [{ product_id: 'coffee', title: 'Cafe Especial', price: 30, unit_price: 3, store: 'Loja A', status: 'ok' }],
      }),
      run('2026-07-02', {
        failures: [{ product_id: 'coffee', store: 'Loja A', error_code: 'blocked' }],
      }),
    ],
  });
  const failed = buildHistorySeries(model, { scope: 'all-products', status: 'hard_failure' });
  assert.equal(failed.length, 1);
  assert.deepEqual(failed[0].points.map((point) => point.value), [100, null]);
  assert.equal(model.histories.get('coffee').points.at(-1).status, 'hard_failure');
  assert.equal(buildHistorySeries(model, { scope: 'all-products', status: 'fresh_success' }).length, 0);
});

test('comparação equivalente recoloca suspeitos apenas no modo de auditoria', () => {
  const model = buildHistoryModel({
    products: [products[0]],
    runs: [run('2026-07-03', {
      offers: [{
        product_id: 'coffee',
        title: 'Cafe Especial',
        store: 'Loja Auditoria',
        price: 20,
        unit_price: 2,
        rejected: false,
        suspicious: true,
      }],
    })],
  });
  assert.deepEqual(buildHistorySeries(model, { scope: 'comparison-group', productId: 'coffee' }), []);
  const audit = buildHistorySeries(model, {
    scope: 'comparison-group', productId: 'coffee', includeSuspicious: true,
  });
  assert.equal(audit.length, 1);
  assert.equal(audit[0].label, 'Loja Auditoria');
  assert.equal(audit[0].points[0].suspicious, true);
});

test('produto inativo do catálogo não reaparece como série corrente', () => {
  const inactive = { ...products[0], id: 'inactive', is_active: false };
  const model = buildHistoryModel({
    products: [inactive],
    runs: [run('2026-07-04', {
      results: [{ product_id: 'inactive', title: 'Cafe Especial', price: 30, unit_price: 3, status: 'ok' }],
    })],
  });
  assert.deepEqual(buildHistorySeries(model, { scope: 'all-products', hideLegacy: false }), []);
});

test('diagnósticos puros cobrem engines, falhas, categorias e os três estados de loja', () => {
  const latest = run('2026-07-04', {
    results: [
      { product_id: 'coffee', price: 30, store: 'Loja A', status: 'ok' },
      { product_id: 'speaker', price: 100, store: 'Loja A', status: 'carried_forward' },
    ],
    failures: [
      { product_id: 'speaker', store: 'Loja A', error_code: 'blocked' },
      { product_id: 'missing', store: 'Loja B', last_error_code: 'timeout' },
      { product_id: 'unknown', store: 'Loja C' },
    ],
    engines: {
      chromium: { attempted: 3, success: 2, failed: 1 },
      lightpanda: {},
    },
  });
  const health = buildStoreHealth(latest, [...products, { id: 'missing', is_active: true }, { id: 'unknown', is_active: true }]);
  assert.deepEqual(health.find((row) => row.store === 'Loja A'), {
    store: 'Loja A', fresh_success: 1, carried_forward: 1, hard_failure: 0, total: 2,
  });
  assert.equal(health.find((row) => row.store === 'Loja B').hard_failure, 1);
  assert.equal(health.find((row) => row.store === 'Loja C').hard_failure, 1);
  assert.deepEqual(buildEngineHealth(latest), [
    { name: 'chromium', attempted: 3, success: 2, failed: 1 },
    { name: 'lightpanda', attempted: 0, success: 0, failed: 0 },
  ]);
  assert.deepEqual(buildEngineHealth({}), []);
  assert.deepEqual(buildFailureBreakdown(latest), [
    { code: 'blocked', count: 1 },
    { code: 'falha_nao_classificada', count: 1 },
    { code: 'timeout', count: 1 },
  ]);
  assert.deepEqual(buildCategoryCounts([
    ...products,
    { id: 'inactive', category: 'mercado', is_active: false },
    { id: 'uncategorized', is_active: true },
  ]), [
    { category: 'eletronicos', count: 1 },
    { category: 'mercado', count: 1 },
    { category: 'sem-categoria', count: 1 },
  ]);
});

test('saúde por loja preserva sucesso parcial e expande store_errors de falhas definitivas', () => {
  const latest = run('2026-07-04', {
    results: [{
      product_id: 'coffee',
      price: 30,
      store_id: 'amazon',
      store: 'Amazon',
      status: 'ok',
      store_outcomes: [
        { store_id: 'amazon', store: 'Amazon', status: 'fresh_success', accepted_offer_count: 1 },
        { store_id: 'kabum', store: 'KaBuM', status: 'hard_failure', error_code: 'captcha_or_block' },
      ],
    }],
    failures: [{
      product_id: 'missing',
      error_code: 'no_search_offers',
      store_errors: [
        { store_id: 'amazon', store: 'Amazon', error_code: 'navigation_timeout' },
        { store_id: 'kabum', store: 'KaBuM', error_code: 'captcha_or_block' },
      ],
    }],
  });

  const health = buildStoreHealth(latest, [products[0], { id: 'missing', is_active: true }]);
  assert.deepEqual(health, [
    { store: 'Amazon', fresh_success: 1, carried_forward: 0, hard_failure: 1, total: 2 },
    { store: 'KaBuM', fresh_success: 0, carried_forward: 0, hard_failure: 2, total: 2 },
  ]);
});

test('saúde por loja deriva produtos do run e usa outcomes da última tentativa como fallback', () => {
  const latest = run('2026-07-04', {
    results: [
      {
        product_id: 'carried', price: 50, store: 'Amazon', status: 'carried_forward', store_outcomes: [],
      },
      {
        product_id: 'fresh', price: 80, store: 'Magalu', status: 'ok',
        store_outcomes: [{ store: 'Magalu', status: 'success' }],
      },
    ],
    failures: [
      {
        product_id: 'carried',
        attempts: [{ store_outcomes: [{ store: 'Amazon', status: 'hard_failure' }] }],
      },
      {
        product_id: 'failed',
        attempts: [{ store_outcomes: [] }, {
          store_outcomes: [{ store_id: 'kabum', store: 'KaBuM', status: 'hard_failure' }],
        }],
      },
    ],
  });

  assert.deepEqual(buildStoreHealth(latest), [
    { store: 'Amazon', fresh_success: 0, carried_forward: 1, hard_failure: 0, total: 1 },
    { store: 'KaBuM', fresh_success: 0, carried_forward: 0, hard_failure: 1, total: 1 },
    { store: 'Magalu', fresh_success: 1, carried_forward: 0, hard_failure: 0, total: 1 },
  ]);
});

test('riscos distinguem falha definitiva de carry-forward com e sem falha associada', () => {
  const latest = run('2026-07-05', {
    results: [
      { product_id: 'coffee', name: 'Café Especial', price: 30, status: 'carried_forward', carried_forward_reason: 'blocked' },
      { product_id: 'speaker', name: 'Caixa Inteligente', price: 100, status: 'carried_forward' },
    ],
    failures: [
      { product_id: 'coffee', error_code: 'blocked' },
      { product_id: 'missing', error_detail: 'sem oferta' },
    ],
  });
  const model = buildHistoryModel({ products, runs: [latest] });
  const risks = buildRiskRows(model, latest, { limit: 10 });
  assert.equal(risks.find((row) => row.product_id === 'coffee').status, 'carried_forward');
  assert.equal(risks.find((row) => row.product_id === 'missing').status, 'hard_failure');
  assert.equal(risks.find((row) => row.product_id === 'speaker').detail, 'Preço reaproveitado de outra execução');
  assert.equal(buildRiskRows(model, latest, { limit: 1 }).length, 1);
});

test('riscos incluem observações suspeitas e não verificadas da execução atual', () => {
  const latest = run('2026-07-06', {
    results: [
      { product_id: 'speaker', title: 'Caixa Inteligente', price: 100, status: 'ok' },
      { product_id: 'coffee', title: 'Cafe Especial', price: 30, unit_price: 3, status: 'ok', suspicious: true },
    ],
  });
  const model = buildHistoryModel({ products, runs: [latest] });
  const risks = buildRiskRows(model, model.runs[0], { limit: 10 });
  assert.equal(risks.find((row) => row.product_id === 'speaker').status, 'unverified');
  assert.equal(risks.find((row) => row.product_id === 'coffee').status, 'suspicious');
});

test('normalizadores toleram entradas inválidas, deduplicam runs e resolvem rótulos', () => {
  assert.equal(normalizeRunPayload(null), null);
  assert.equal(normalizeRunPayload({}, ''), null);
  assert.equal(positiveNumber(''), null);
  assert.equal(positiveNumber('abc'), null);
  assert.equal(positiveNumber('12.5'), 12.5);
  assert.equal(normalizeText('Áudio & Vídeo'), 'audio video');
  assert.equal(normalizeCategory('Áudio & Vídeo'), 'audio-video');
  assert.equal(storeLabel('', 'https://www.minha-loja.com.br/item'), 'Minha Loja');
  assert.equal(storeLabel('', 'url-invalida'), 'Sem loja');
  const same = run('2026-07-06');
  assert.equal(normalizeRuns([same, { file: 'duplicate.json', payload: same }, null]).length, 1);
});

test('seleciona exatamente os 30 runs mais recentes com desempate determinístico', () => {
  const entries = [];
  for (let offset = 0; offset < 35; offset += 1) {
    const date = new Date(Date.UTC(2026, 6, 1 + offset)).toISOString().slice(0, 10);
    entries.push({ run_id: `${date}T10`, run_date: date, generated_at: `${date}T10:00:00Z`, run_file: `${date}-a.json` });
    if (offset === 34) entries.push({ run_id: `${date}T12`, run_date: date, generated_at: `${date}T12:00:00Z`, run_file: `${date}-b.json` });
  }
  const selected = selectRecentRunFiles({ runs: entries }, 30);
  assert.equal(selected.length, 30);
  assert.deepEqual(selected.slice(0, 2), ['2026-08-04-b.json', '2026-08-04-a.json']);
  assert.ok(!selected.includes('2026-07-06-a.json'));
  assert.deepEqual(selectRecentRunFiles({ runs: [
    { run_id: 'run-a', generated_at: '2026-08-04T12:00:00Z', run_file: 'a.json' },
    { run_id: 'run-b', generated_at: '2026-08-04T12:00:00Z', run_file: 'b.json' },
  ] }, 2), ['b.json', 'a.json']);
  assert.deepEqual(selectRecentRunFiles({ files: ['c.json', 'b.json', 'a.json'] }, 2), ['c.json', 'b.json']);
  assert.deepEqual(selectRecentRunFiles({}, 30), []);
});

test('normalização mantém múltiplos runs carregados do mesmo dia e usa o mais recente no ponto diário', () => {
  const first = run('2026-08-04', {
    results: [{ product_id: 'coffee', title: 'Cafe Especial', price: 30, unit_price: 3, status: 'ok' }],
  });
  const second = {
    ...run('2026-08-04', {
      results: [{ product_id: 'coffee', title: 'Cafe Especial', price: 25, unit_price: 2.5, status: 'ok' }],
    }),
    run_id: '2026-08-04T12-00-00-000Z',
    generated_at: '2026-08-04T12:00:00.000Z',
  };
  const model = buildHistoryModel({ products, runs: [second, first] });

  assert.deepEqual(model.runs.map((entry) => entry.run_id), [first.run_id, second.run_id]);
  assert.equal(model.histories.get('coffee').points[0].value, 25);
});

test('manifesto fatal mais recente governa o estado operacional sem apagar o histórico anterior', () => {
  const prior = run('2026-08-01', {
    results: [
      {
        product_id: 'coffee', title: 'Cafe Especial', price: 30, unit_price: 3,
        store: 'Loja A', status: 'ok',
      },
      {
        product_id: 'speaker', title: 'Caixa Inteligente preta', price: 100,
        attributes: { color: 'preto' }, store: 'Loja B', status: 'ok',
      },
    ],
  });
  const fatal = {
    run_id: '2026-08-02T11-00-00-000Z',
    run_date: '2026-08-02',
    generated_at: '2026-08-02T11:00:00.000Z',
    summary: { total_products: 0, success_count: 0, failure_count: 0, engines: {} },
    results: [], offers: [], failures: [],
  };
  const manifest = {
    runs: [
      {
        run_id: prior.run_id, run_date: prior.run_date, generated_at: prior.generated_at,
        run_file: `${prior.run_id}.json`, status: 'success',
      },
      {
        run_id: fatal.run_id, run_date: fatal.run_date, generated_at: fatal.generated_at,
        run_file: `${fatal.run_id}.json`, error_file: `${fatal.run_id}.json`, status: 'fatal',
      },
    ],
  };
  const fatalErrors = new Map([[fatal.run_id, {
    fatal: true,
    error_code: 'catalog_unavailable',
    error_detail: 'Catálogo indisponível',
    engine_summary: {},
  }]]);
  const model = buildHistoryModel({ products, runs: [prior, fatal], manifest, fatalErrors });
  const operational = resolveOperationalState({
    manifest, runs: model.runs, latest: prior, products, fatalErrors,
  });

  assert.equal(selectLatestManifestRun(manifest).run_id, fatal.run_id);
  assert.equal(operational.status, 'fatal');
  assert.equal(operational.is_fatal, true);
  assert.equal(operational.latest_is_stale, true);
  assert.equal(operational.run.run_id, fatal.run_id);
  assert.equal(operational.run.failures.length, 2);
  assert.ok(operational.run.failures.every((failure) => (
    failure.observation_status === 'hard_failure'
      && failure.error_code === 'catalog_unavailable'
      && failure.synthetic_operational_failure
  )));
  const coffeePoints = model.histories.get('coffee').points;
  assert.deepEqual(coffeePoints.map((point) => [point.value, point.status]), [
    [30, 'fresh_success'],
    [null, 'hard_failure'],
  ]);
  assert.deepEqual(buildOpportunities(model), []);
  assert.match(buildRiskRows(model, operational.run, { limit: 10 })[0].detail, /Catálogo indisponível/);
});

test('payload operacional ausente produz erro de dados em vez de promover latest antigo', () => {
  const prior = run('2026-08-01', {
    results: [{ product_id: 'coffee', title: 'Cafe Especial', price: 30, unit_price: 3, status: 'ok' }],
  });
  const manifest = {
    runs: [{
      run_id: '2026-08-03T11-00-00-000Z',
      run_date: '2026-08-03',
      generated_at: '2026-08-03T11:00:00.000Z',
      run_file: '2026-08-03T11-00-00-000Z.json',
      status: 'success',
    }],
  };
  const operational = resolveOperationalState({ manifest, runs: [prior], latest: prior, products });
  assert.equal(operational.status, 'data_error');
  assert.equal(operational.available, false);
  assert.equal(operational.latest_is_stale, true);
  assert.equal(operational.run.run_id, manifest.runs[0].run_id);
  assert.equal(operational.run.results.length, 0);
  assert.equal(operational.run.failures.length, 2);
});

test('estado operacional cobre manifestos legados, payload parcial e metadados fatais em objeto', () => {
  assert.equal(selectLatestManifestRun(null), null);
  const successful = run('2026-09-01', {
    results: [{ product_id: 'coffee', title: 'Cafe Especial', price: 20, unit_price: 2, status: 'ok' }],
  });
  const fromLatest = resolveOperationalState({ latest: successful });
  assert.equal(fromLatest.status, 'success');
  assert.equal(fromLatest.available, true);
  assert.equal(fromLatest.latest_is_stale, false);

  const partial = normalizeRunPayload(run('2026-09-02', {
    failures: [{ product_id: 'coffee', error_code: 'blocked' }],
  }));
  const fromRunList = resolveOperationalState({ runs: [partial] });
  assert.equal(fromRunList.status, 'partial');
  assert.equal(resolveOperationalState().status, 'data_error');

  const missingRunId = '2026-09-03T10-00-00-000Z';
  const errors = {
    [missingRunId]: {
      message: 'Falha global sem detalhe específico',
      engine_summary: { chromium_search: { attempted: 1, success: 0, failed: 1 } },
    },
  };
  const missing = resolveOperationalState({
    manifest: {
      runs: [{
        run_id: missingRunId,
        run_date: '2026-09-03',
        generated_at: null,
        status: 'fatal',
      }],
    },
    products: [...products, { id: 'inactive', name: 'Inativo', is_active: false }],
    fatalErrors: errors,
  });
  assert.equal(missing.status, 'data_error');
  assert.equal(missing.run.generated_at, '2026-09-03T00:00:00.000Z');
  assert.equal(missing.run.summary.engines.chromium_search.failed, 1);
  assert.equal(missing.run.failures.length, 2);
  assert.match(missing.run.failures[0].error_detail, /Falha global/);
  assert.equal(missing.run.failures[0].error_code, 'run_payload_unavailable');
});
