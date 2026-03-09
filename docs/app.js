const RUNS_LIMIT = 30;
const ALL = '__all__';
let resolvedDataRoot = null;

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
  addCategory: document.getElementById('ap-category'),
  addCategoryHint: document.getElementById('ap-category-hint'),
  addCategoryList: document.getElementById('ap-category-list'),
  addPriceCss: document.getElementById('ap-price-css'),
  latestJsonLink: document.getElementById('latest-json-link'),
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

function normalizeCategoryKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function levenshteinDistance(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (!left) return right.length;
  if (!right) return left.length;

  const matrix = Array.from({ length: left.length + 1 }, () => []);
  for (let i = 0; i <= left.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[left.length][right.length];
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

function findCategoryMatch(rawValue) {
  const typed = String(rawValue || '').trim();
  if (!typed) return null;

  const typedKey = normalizeCategoryKey(typed);
  if (!typedKey) return null;

  const exact = state.categories.find((category) => normalizeCategoryKey(category) === typedKey);
  if (exact) {
    return {
      category: exact,
      kind: 'exact',
    };
  }

  let best = null;
  for (const category of state.categories) {
    const key = normalizeCategoryKey(category);
    if (!key) continue;

    const distance = levenshteinDistance(typedKey, key);
    const maxLen = Math.max(typedKey.length, key.length);
    const similarity = maxLen ? 1 - (distance / maxLen) : 0;

    if (!best || similarity > best.similarity || (similarity === best.similarity && distance < best.distance)) {
      best = {
        category,
        distance,
        similarity,
      };
    }
  }

  if (best && best.distance <= 2 && best.similarity >= 0.82 && typedKey.length >= 4) {
    return {
      category: best.category,
      kind: 'fuzzy',
      distance: best.distance,
      similarity: best.similarity,
    };
  }

  return null;
}

function renderAddCategorySuggestions() {
  if (!els.addCategoryList) return;
  els.addCategoryList.innerHTML = state.categories
    .map((category) => `<option value="${category}"></option>`)
    .join('');
}

function updateAddCategoryHint({ applyMatch = false } = {}) {
  if (!els.addCategory) return '';

  const typed = els.addCategory.value.trim();
  if (!typed) {
    if (els.addCategoryHint) {
      els.addCategoryHint.textContent = '';
      els.addCategoryHint.dataset.state = '';
    }
    return '';
  }

  const match = findCategoryMatch(typed);
  if (!match) {
    if (els.addCategoryHint) {
      els.addCategoryHint.textContent = `Nova categoria: "${typed}".`;
      els.addCategoryHint.dataset.state = 'new';
    }
    return typed;
  }

  if (applyMatch) {
    els.addCategory.value = match.category;
  }

  if (els.addCategoryHint) {
    if (match.kind === 'exact') {
      els.addCategoryHint.textContent = `Categoria existente: "${match.category}".`;
    } else {
      els.addCategoryHint.textContent = `Categoria parecida encontrada: "${match.category}".`;
    }
    els.addCategoryHint.dataset.state = 'ok';
  }

  return applyMatch ? els.addCategory.value.trim() : typed;
}

function containsHtmlSnippet(lines) {
  return lines.some((line) => /<[^>]+>/.test(String(line || '')));
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Falha ao carregar ${path}: HTTP ${response.status}`);
  }
  return response.json();
}

function addUniquePath(list, value) {
  if (value && !list.includes(value)) {
    list.push(value);
  }
}

function dataRootCandidates() {
  const candidates = [];
  addUniquePath(candidates, './data');
  addUniquePath(candidates, '../data');

  const pathParts = window.location.pathname.split('/').filter(Boolean);
  if (pathParts.length > 0) {
    addUniquePath(candidates, `/${pathParts[0]}/data`);
  }

  addUniquePath(candidates, '/data');
  return candidates;
}

function setLatestJsonLink(dataRoot) {
  if (els.latestJsonLink) {
    els.latestJsonLink.href = `${dataRoot}/latest.json`;
  }
}

async function detectDataRoot() {
  if (resolvedDataRoot) return resolvedDataRoot;

  for (const candidate of dataRootCandidates()) {
    try {
      const response = await fetch(`${candidate}/latest.json`, { cache: 'no-store' });
      if (response.ok) {
        resolvedDataRoot = candidate;
        setLatestJsonLink(candidate);
        return candidate;
      }
    } catch {
      // Try next candidate.
    }
  }

  throw new Error('Nao foi possivel localizar os arquivos de dados em ./data ou ../data.');
}

async function fetchDataJson(path) {
  const dataRoot = await detectDataRoot();
  return fetchJson(`${dataRoot}/${path}`);
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
  renderAddCategorySuggestions();
  updateAddCategoryHint();
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
  const category = updateAddCategoryHint({ applyMatch: true });
  const unitsRaw = document.getElementById('ap-units').value.trim();
  const isActive = document.getElementById('ap-active').value === 'true';
  const repoValue = parseRepoInput(document.getElementById('ap-repo').value);
  const priceCss = splitLines(els.addPriceCss?.value || '');
  const jsonldPaths = splitLines(document.getElementById('ap-jsonld').value);
  const regexHints = splitLines(document.getElementById('ap-regex').value);

  if (!name || !url || !repoValue) {
    alert('Preencha nome, URL e repositorio GitHub no formato owner/repo.');
    return;
  }

  if (containsHtmlSnippet(priceCss)) {
    alert('No campo Seletores CSS, informe apenas seletores (ex: .a-price .a-offscreen), nao HTML copiado.');
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
      price_css: priceCss,
      jsonld_paths: jsonldPaths,
      regex_hints: regexHints,
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
      fetchDataJson('latest.json'),
      fetchDataJson('runs/index.json').catch(() => ({ files: [] })),
      fetchDataJson('products.json').catch(() => []),
    ]);

    const runFiles = (runsIndex.files || []).slice(0, RUNS_LIMIT);
    const runPayloads = await Promise.all(
      runFiles.map((file) => fetchDataJson(`runs/${file}`).catch(() => null)),
    );

    state.latest = latest;
    state.runs = runPayloads.filter(Boolean);
    state.products = Array.isArray(products) ? products : [];
    state.productsById = new Map(state.products.map((product) => [product.id, product]));
    state.categories = [...new Set(state.products.map((product) => normalizeCategory(product.category)))].sort();

    buildCategoryColors(state.categories);
    buildHistories();
    renderAddCategorySuggestions();
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
if (els.addCategory) {
  els.addCategory.addEventListener('input', () => updateAddCategoryHint());
  els.addCategory.addEventListener('blur', () => updateAddCategoryHint({ applyMatch: true }));
}
els.addForm.addEventListener('submit', onSubmitAddProduct);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && els.modal.getAttribute('aria-hidden') === 'false') {
    closeModal();
  }
});

init();
