const RUNS_LIMIT = 30;
const ALL = '__all__';

const CATEGORY_PALETTE = [
  '#0f7a62',
  '#b54708',
  '#7a3ea1',
  '#0f6cc0',
  '#b42318',
  '#1f7a1f',
  '#8a5a00',
  '#005f73',
  '#8b1e3f',
];

const els = {
  generatedAt: document.getElementById('generated-at'),
  summaryGrid: document.getElementById('summary-grid'),
  tbody: document.getElementById('products-tbody'),
  tableCategoryFilter: document.getElementById('table-category-filter'),
  historyCategoryFilter: document.getElementById('history-category-filter'),
  chartScope: document.getElementById('chart-scope'),
  productSelect: document.getElementById('product-select'),
  historyCanvas: document.getElementById('history-chart'),
  pieCanvas: document.getElementById('category-pie-chart'),
  detail: document.getElementById('history-detail'),
  categoryLegend: document.getElementById('category-legend'),
  openModal: document.getElementById('open-add-modal'),
  closeModal: document.getElementById('close-add-modal'),
  modal: document.getElementById('add-modal'),
  addForm: document.getElementById('add-product-form'),
};

const state = {
  latest: null,
  runs: [],
  products: [],
  productsById: new Map(),
  categories: [],
  colorsByCategory: new Map(),
  historyByProduct: new Map(),
  historyByCategory: new Map(),
  allDates: [],
  chart: null,
  pieChart: null,
};

function normalizeCategory(value) {
  const category = String(value || '').trim();
  return category || 'sem-categoria';
}

function formatCategoryLabel(value) {
  return normalizeCategory(value)
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDateTime(iso) {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function formatMoney(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return Number(value).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function splitLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Falha ao carregar ${path}: HTTP ${response.status}`);
  }
  return response.json();
}

function colorForCategory(category) {
  return state.colorsByCategory.get(normalizeCategory(category)) || '#0f7a62';
}

function setFilterOptions(select, categories) {
  select.innerHTML = [
    `<option value="${ALL}">Todas</option>`,
    ...categories.map((category) => `<option value="${category}">${formatCategoryLabel(category)}</option>`),
  ].join('');
}

function buildCategoryColors(categories) {
  state.colorsByCategory = new Map();
  categories.forEach((category, index) => {
    state.colorsByCategory.set(category, CATEGORY_PALETTE[index % CATEGORY_PALETTE.length]);
  });
}

function renderSummary() {
  const summary = state.latest?.summary || {};
  const engines = summary.engines || {};

  const rows = [
    ['Total ativos', summary.total_products ?? 0],
    ['Sucesso', summary.success_count ?? 0],
    ['Falhas', summary.failure_count ?? 0],
    ['Duracao (ms)', summary.run_duration_ms ?? 0],
    ['E1 ok/fail', `${engines.engine1_http?.success ?? 0}/${engines.engine1_http?.failed ?? 0}`],
    ['E2 ok/fail', `${engines.engine2_browser?.success ?? 0}/${engines.engine2_browser?.failed ?? 0}`],
    ['E3 ok/fail', `${engines.engine3_hardmode?.success ?? 0}/${engines.engine3_hardmode?.failed ?? 0}`],
  ];

  els.summaryGrid.innerHTML = rows
    .map(([key, value]) => `<div class="summary-item"><span class="k">${key}</span><span class="v">${value}</span></div>`)
    .join('');

  els.generatedAt.textContent = state.latest?.generated_at
    ? `Atualizado: ${formatDateTime(state.latest.generated_at)}`
    : 'Sem execucao registrada';
}

function renderCategoryLegend(categories) {
  const html = categories.map((category) => `
    <span class="category-chip">
      <span class="category-chip-dot" style="background:${colorForCategory(category)}"></span>
      ${formatCategoryLabel(category)}
    </span>
  `).join('');
  els.categoryLegend.innerHTML = html || '<span class="category-chip">Sem categorias</span>';
}

function renderPieChart() {
  if (state.pieChart) {
    state.pieChart.destroy();
    state.pieChart = null;
  }

  const counts = new Map();
  state.products.forEach((product) => {
    if (!product.is_active) return;
    const category = normalizeCategory(product.category);
    counts.set(category, (counts.get(category) || 0) + 1);
  });

  const labels = [...counts.keys()].sort();
  const values = labels.map((label) => counts.get(label));
  const colors = labels.map((label) => colorForCategory(label));

  state.pieChart = new window.Chart(els.pieCanvas, {
    type: 'pie',
    data: {
      labels: labels.map(formatCategoryLabel),
      datasets: [
        {
          label: 'Produtos por categoria',
          data: values,
          backgroundColor: colors,
        },
      ],
    },
    options: {
      responsive: true,
    },
  });
}

function buildRows() {
  const successes = Array.isArray(state.latest?.items) ? state.latest.items : [];
  const failures = Array.isArray(state.latest?.failures) ? state.latest.failures : [];
  const rows = [];

  successes.forEach((item) => {
    const product = state.productsById.get(item.product_id);
    rows.push({
      category: normalizeCategory(product?.category),
      name: item.name,
      price: item.price,
      unit_price: item.unit_price,
      engine: item.engine_used,
      fetched_at: item.fetched_at,
      status: 'ok',
    });
  });

  failures.forEach((item) => {
    const product = state.productsById.get(item.product_id);
    rows.push({
      category: normalizeCategory(product?.category),
      name: item.name,
      price: null,
      unit_price: null,
      engine: item.attempts?.[item.attempts.length - 1]?.engine || '-',
      fetched_at: item.fetched_at,
      status: 'failed',
    });
  });

  return rows.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.name.localeCompare(b.name);
  });
}

function renderTable() {
  const selectedCategory = els.tableCategoryFilter.value || ALL;
  const filteredRows = buildRows().filter((row) => selectedCategory === ALL || row.category === selectedCategory);

  if (filteredRows.length === 0) {
    els.tbody.innerHTML = '<tr><td colspan="6">Nenhum dado disponivel para o filtro atual.</td></tr>';
    return;
  }

  let lastCategory = '';
  const html = [];
  filteredRows.forEach((row) => {
    if (row.category !== lastCategory) {
      html.push(`<tr class="category-group-row"><td colspan="6">${formatCategoryLabel(row.category)}</td></tr>`);
      lastCategory = row.category;
    }

    html.push(`
      <tr>
        <td>${row.name}</td>
        <td>${formatMoney(row.price)}</td>
        <td>${formatMoney(row.unit_price)}</td>
        <td>${row.engine || '-'}</td>
        <td>${formatDateTime(row.fetched_at)}</td>
        <td><span class="status-pill ${row.status === 'ok' ? 'status-ok' : 'status-failed'}">${row.status}</span></td>
      </tr>
    `);
  });

  els.tbody.innerHTML = html.join('');
}

function buildHistories() {
  const productMap = new Map();
  const categoryAggregation = new Map();
  const datesSet = new Set();

  state.runs.forEach((run) => {
    const dateLabel = run.run_date || (run.generated_at ? run.generated_at.slice(0, 10) : '-');
    datesSet.add(dateLabel);

    (run.results || []).forEach((result) => {
      const product = state.productsById.get(result.product_id);
      const category = normalizeCategory(product?.category);

      if (!productMap.has(result.product_id)) {
        productMap.set(result.product_id, {
          product_id: result.product_id,
          name: result.name,
          category,
          points: [],
        });
      }
      productMap.get(result.product_id).points.push({
        date: dateLabel,
        price: Number(result.price),
      });

      const key = `${category}::${dateLabel}`;
      const prev = categoryAggregation.get(key) || { sum: 0, count: 0 };
      prev.sum += Number(result.price);
      prev.count += 1;
      categoryAggregation.set(key, prev);
    });
  });

  const allDates = [...datesSet].sort((a, b) => a.localeCompare(b));

  productMap.forEach((entry) => {
    entry.points.sort((a, b) => a.date.localeCompare(b.date));
  });

  const categoryMap = new Map();
  state.categories.forEach((category) => {
    const points = allDates.map((date) => {
      const agg = categoryAggregation.get(`${category}::${date}`);
      if (!agg || agg.count === 0) return { date, price: null };
      return { date, price: Math.round((agg.sum / agg.count) * 100) / 100 };
    });

    categoryMap.set(category, {
      category,
      label: formatCategoryLabel(category),
      points,
    });
  });

  state.historyByProduct = productMap;
  state.historyByCategory = categoryMap;
  state.allDates = allDates;
}

function productOptionsForFilter() {
  const selectedCategory = els.historyCategoryFilter.value || ALL;
  const list = [...state.historyByProduct.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (selectedCategory === ALL) return list;
  return list.filter((item) => item.category === selectedCategory);
}

function renderProductSelect() {
  const options = productOptionsForFilter();
  if (options.length === 0) {
    els.productSelect.innerHTML = '<option value="">Sem historico</option>';
    return;
  }

  els.productSelect.innerHTML = options
    .map((item, index) => `<option value="${item.product_id}" ${index === 0 ? 'selected' : ''}>${item.name}</option>`)
    .join('');
}

function valueMap(points) {
  const map = new Map();
  (points || []).forEach((point) => map.set(point.date, Number(point.price)));
  return map;
}

function datasetFromProduct(entry) {
  const pointMap = valueMap(entry.points);
  return {
    label: entry.name,
    data: state.allDates.map((date) => (pointMap.has(date) ? pointMap.get(date) : null)),
    borderColor: colorForCategory(entry.category),
    backgroundColor: colorForCategory(entry.category),
  };
}

function datasetFromCategory(entry) {
  const pointMap = valueMap(entry.points);
  return {
    label: entry.label,
    data: state.allDates.map((date) => (pointMap.has(date) ? pointMap.get(date) : null)),
    borderColor: colorForCategory(entry.category),
    backgroundColor: colorForCategory(entry.category),
  };
}

function chartDatasets() {
  const scope = els.chartScope.value;
  const category = els.historyCategoryFilter.value || ALL;

  if (scope === 'single-product') {
    const product = state.historyByProduct.get(els.productSelect.value);
    if (!product) return [];
    return [datasetFromProduct(product)];
  }

  if (scope === 'by-category') {
    const categories = category === ALL ? state.categories : state.categories.filter((item) => item === category);
    return categories
      .map((cat) => state.historyByCategory.get(cat))
      .filter(Boolean)
      .map(datasetFromCategory);
  }

  const products = productOptionsForFilter();
  return products.map(datasetFromProduct);
}

function renderDetailPanel(datasets) {
  const scope = els.chartScope.value;
  const category = els.historyCategoryFilter.value || ALL;

  if (datasets.length === 0) {
    els.detail.innerHTML = 'Sem dados para o filtro atual.';
    return;
  }

  if (scope === 'single-product') {
    const ds = datasets[0];
    const validValues = ds.data.filter((value) => Number.isFinite(Number(value)));
    const last = validValues[validValues.length - 1] ?? null;
    const min = validValues.length ? Math.min(...validValues) : null;
    const max = validValues.length ? Math.max(...validValues) : null;

    els.detail.innerHTML = `
      <div class="detail-list">
        <div class="detail-item"><span>Produto</span><strong>${ds.label}</strong></div>
        <div class="detail-item"><span>Ultimo preco</span><strong>${formatMoney(last)}</strong></div>
        <div class="detail-item"><span>Minimo no periodo</span><strong>${formatMoney(min)}</strong></div>
        <div class="detail-item"><span>Maximo no periodo</span><strong>${formatMoney(max)}</strong></div>
      </div>
    `;
    return;
  }

  const scopeLabel = scope === 'by-category' ? 'Categorias' : 'Produtos';
  const categoryLabel = category === ALL ? 'Todas' : formatCategoryLabel(category);
  els.detail.innerHTML = `
    <div class="detail-list">
      <div class="detail-item"><span>Modo</span><strong>${scopeLabel}</strong></div>
      <div class="detail-item"><span>Filtro de categoria</span><strong>${categoryLabel}</strong></div>
      <div class="detail-item"><span>Series ativas</span><strong>${datasets.length}</strong></div>
      <div class="detail-item"><span>Periodo</span><strong>${state.allDates.length} snapshots</strong></div>
    </div>
  `;
}

function renderHistoryChart() {
  if (state.chart) {
    state.chart.destroy();
    state.chart = null;
  }

  const datasets = chartDatasets();
  state.chart = new window.Chart(els.historyCanvas, {
    type: 'line',
    data: {
      labels: state.allDates,
      datasets,
    },
    options: {
      responsive: true,
    },
  });

  renderDetailPanel(datasets);
}

function detectDefaultRepo() {
  const host = window.location.hostname;
  const pathParts = window.location.pathname.split('/').filter(Boolean);

  if (host.endsWith('.github.io')) {
    const owner = host.split('.')[0];
    const repo = pathParts[0] || '';
    if (owner && repo) return `${owner}/${repo}`;
  }
  if (pathParts.length >= 2) return `${pathParts[0]}/${pathParts[1]}`;
  return '';
}

function openModal() {
  els.modal.setAttribute('aria-hidden', 'false');
  const repoInput = document.getElementById('ap-repo');
  if (!repoInput.value.trim()) {
    repoInput.value = detectDefaultRepo();
  }
}

function closeModal() {
  els.modal.setAttribute('aria-hidden', 'true');
}

function buildIssueBody(payload) {
  return [
    '## Add Product Request',
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '',
    'Criado via dashboard estatico.',
  ].join('\n');
}

function parseRepoInput(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/^\/+|\/+$/g, '');
  const parts = cleaned.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[0]}/${parts[1]}`;
}

function onSubmitAddProduct(event) {
  event.preventDefault();

  const name = document.getElementById('ap-name').value.trim();
  const url = document.getElementById('ap-url').value.trim();
  const category = document.getElementById('ap-category').value.trim();
  const unitsRaw = document.getElementById('ap-units').value.trim();
  const isActive = document.getElementById('ap-active').value === 'true';
  const repoValue = parseRepoInput(document.getElementById('ap-repo').value);

  if (!name || !url || !repoValue) {
    alert('Preencha nome, URL e repositorio GitHub no formato owner/repo.');
    return;
  }

  const units = unitsRaw ? Number(unitsRaw) : null;
  const payload = {
    action: 'add',
    name,
    url,
    ...(category ? { category } : {}),
    ...(Number.isFinite(units) && units > 0 ? { units_per_package: units } : {}),
    is_active: isActive,
    selectors: {
      price_css: splitLines(document.getElementById('ap-price-css').value),
      jsonld_paths: splitLines(document.getElementById('ap-jsonld').value),
      regex_hints: splitLines(document.getElementById('ap-regex').value),
    },
    ...(document.getElementById('ap-notes').value.trim()
      ? { notes: document.getElementById('ap-notes').value.trim() }
      : {}),
  };

  if (payload.selectors.price_css.length === 0) delete payload.selectors.price_css;
  if (payload.selectors.jsonld_paths.length === 0) delete payload.selectors.jsonld_paths;
  if (payload.selectors.regex_hints.length === 0) delete payload.selectors.regex_hints;
  if (Object.keys(payload.selectors).length === 0) delete payload.selectors;

  const title = `[MANAGE PRODUCT] ADD ${name}`;
  const body = buildIssueBody(payload);
  const issueUrl = `https://github.com/${repoValue}/issues/new?labels=manage-product&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;

  window.open(issueUrl, '_blank', 'noopener,noreferrer');
  closeModal();
}

function onChartScopeChange() {
  const scope = els.chartScope.value;
  els.productSelect.disabled = scope !== 'single-product';
  renderHistoryChart();
}

async function init() {
  try {
    const [latest, runsIndex, products] = await Promise.all([
      fetchJson('../data/latest.json'),
      fetchJson('../data/runs/index.json').catch(() => ({ files: [] })),
      fetchJson('../data/products.json').catch(() => []),
    ]);

    const runFiles = (runsIndex.files || []).slice(0, RUNS_LIMIT);
    const runPayloads = await Promise.all(
      runFiles.map((file) => fetchJson(`../data/runs/${file}`).catch(() => null)),
    );

    state.latest = latest;
    state.runs = runPayloads.filter(Boolean);
    state.products = Array.isArray(products) ? products : [];
    state.productsById = new Map(state.products.map((product) => [product.id, product]));
    state.categories = [...new Set(state.products.map((product) => normalizeCategory(product.category)))].sort();

    buildCategoryColors(state.categories);
    buildHistories();
    setFilterOptions(els.tableCategoryFilter, state.categories);
    setFilterOptions(els.historyCategoryFilter, state.categories);
    renderProductSelect();
    els.chartScope.value = 'all-products';
    els.productSelect.disabled = true;

    renderSummary();
    renderCategoryLegend(state.categories);
    renderPieChart();
    renderHistoryChart();
    renderTable();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    els.summaryGrid.innerHTML = `<div class="summary-item"><span class="k">Erro</span><span class="v">${message}</span></div>`;
    els.tbody.innerHTML = '<tr><td colspan="6">Falha ao carregar dados.</td></tr>';
    els.detail.textContent = `Erro: ${message}`;
  }
}

els.tableCategoryFilter.addEventListener('change', () => renderTable());
els.historyCategoryFilter.addEventListener('change', () => {
  renderProductSelect();
  renderHistoryChart();
});
els.chartScope.addEventListener('change', onChartScopeChange);
els.productSelect.addEventListener('change', () => renderHistoryChart());

els.openModal.addEventListener('click', openModal);
els.closeModal.addEventListener('click', closeModal);
els.modal.addEventListener('click', (event) => {
  if (event.target.dataset.closeModal === 'true') {
    closeModal();
  }
});
els.addForm.addEventListener('submit', onSubmitAddProduct);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && els.modal.getAttribute('aria-hidden') === 'false') {
    closeModal();
  }
});

init();
