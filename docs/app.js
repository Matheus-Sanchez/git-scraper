const RUNS_LIMIT = 30;
const ALL = '__all__';

let resolvedDataRoot = null;
let draftCounter = 1;

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
  historyCategoryFilter: document.getElementById('history-category-filter'),
  chartScope: document.getElementById('chart-scope'),
  productSelect: document.getElementById('product-select'),
  historyMain: document.getElementById('history-main'),
  historyScroll: document.getElementById('history-scroll'),
  historyStage: document.getElementById('history-stage'),
  historyCanvas: document.getElementById('history-chart'),
  historyHoverTooltip: document.getElementById('history-hover-tooltip'),
  pieCanvas: document.getElementById('category-pie-chart'),
  detail: document.getElementById('history-detail'),
  categoryLegend: document.getElementById('category-legend'),
  tableFilterSummary: document.getElementById('table-filter-summary'),
  zoomIn: document.getElementById('zoom-in'),
  zoomOut: document.getElementById('zoom-out'),
  zoomReset: document.getElementById('zoom-reset'),
  openModal: document.getElementById('open-add-modal'),
  closeModal: document.getElementById('close-add-modal'),
  modal: document.getElementById('add-modal'),
  addForm: document.getElementById('add-product-form'),
  addItems: document.getElementById('ap-items'),
  addItemButton: document.getElementById('ap-add-item'),
  addCategoryList: document.getElementById('ap-category-list'),
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
  latestItemsById: new Map(),
  latestFailuresById: new Map(),
  comparisonGroups: new Map(),
  allDates: [],
  chart: null,
  pieChart: null,
  viewport: {
    startIndex: 0,
    endIndex: 0,
  },
  isSyncingHistoryScroll: false,
  pendingHistoryScrollFrame: null,
  addDrafts: [],
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugifyLoose(value, fallback = '') {
  const normalized = String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
}

function normalizeCategory(value) {
  return slugifyLoose(value, 'sem-categoria');
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

function normalizeComparisonKey(value) {
  return slugifyLoose(value);
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

function containsHtmlSnippet(lines) {
  return lines.some((line) => /<[^>]+>/.test(String(line || '')));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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
    };
  }

  return null;
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
  if (!select) return;

  select.innerHTML = [
    `<option value="${ALL}">Todas</option>`,
    ...categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(formatCategoryLabel(category))}</option>`),
  ].join('');
}

function buildCategoryColors(categories) {
  state.colorsByCategory = new Map();
  categories.forEach((category, index) => {
    state.colorsByCategory.set(category, CATEGORY_PALETTE[index % CATEGORY_PALETTE.length]);
  });
}

function siteLabelFromUrl(value) {
  try {
    const hostname = new URL(value).hostname.replace(/^www\./i, '').toLowerCase();
    const parts = hostname.split('.').filter(Boolean);
    const core = parts.length > 1 ? parts[0] : hostname;
    return core.replace(/[-_]+/g, ' ').trim();
  } catch {
    return '';
  }
}

function formatSiteLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Site';
  return raw.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildProductLabel(name, url) {
  const trimmedName = String(name || 'Produto').trim() || 'Produto';
  const site = formatSiteLabel(siteLabelFromUrl(url));
  return site ? `${trimmedName} / ${site}` : trimmedName;
}

function currentScope() {
  return els.chartScope?.value || 'all-products';
}

function selectedCategory() {
  return els.historyCategoryFilter?.value || ALL;
}

function selectedProductId() {
  return els.productSelect?.value || '';
}

function scopeUsesProductSelect(scope = currentScope()) {
  return scope === 'single-product' || scope === 'comparison-group';
}

function syncControlAvailability() {
  if (!els.productSelect) return;
  const disabled = !scopeUsesProductSelect() || els.productSelect.options.length === 0 || !els.productSelect.value;
  els.productSelect.disabled = disabled;
}

function buildLatestIndexes() {
  const items = Array.isArray(state.latest?.items) ? state.latest.items : [];
  const failures = Array.isArray(state.latest?.failures) ? state.latest.failures : [];

  state.latestItemsById = new Map(items.map((item) => [item.product_id, item]));
  state.latestFailuresById = new Map(failures.map((item) => [item.product_id, item]));
}

function buildComparisonGroups() {
  const groups = new Map();

  state.products.forEach((product) => {
    const key = normalizeComparisonKey(product.comparison_key);
    if (!key) return;

    const list = groups.get(key) || [];
    list.push(product.id);
    groups.set(key, list);
  });

  state.comparisonGroups = groups;
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
    .map(([key, value]) => `<div class="summary-item"><span class="k">${escapeHtml(key)}</span><span class="v">${escapeHtml(value)}</span></div>`)
    .join('');

  els.generatedAt.textContent = state.latest?.generated_at
    ? `Atualizado: ${formatDateTime(state.latest.generated_at)}`
    : 'Sem execucao registrada';
}

function renderCategoryLegend(categories) {
  const html = categories.map((category) => `
    <span class="category-chip">
      <span class="category-chip-dot" style="background:${colorForCategory(category)}"></span>
      ${escapeHtml(formatCategoryLabel(category))}
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

  const labels = [...counts.keys()].sort((a, b) => a.localeCompare(b));
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
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: 'right',
        },
        tooltip: {
          callbacks: {
            label(context) {
              const label = context.label || '';
              const value = context.parsed || 0;
              return `${label}: ${value}`;
            },
          },
        },
      },
    },
  });
}

function valueMap(points) {
  const map = new Map();
  (points || []).forEach((point) => {
    if (point.price === null || point.price === undefined) {
      map.set(point.date, null);
      return;
    }
    map.set(point.date, Number(point.price));
  });
  return map;
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
      const comparisonKey = normalizeComparisonKey(product?.comparison_key);
      const url = product?.url || result.url;
      const label = buildProductLabel(product?.name || result.name, url);

      if (!productMap.has(result.product_id)) {
        productMap.set(result.product_id, {
          product_id: result.product_id,
          name: product?.name || result.name,
          label,
          category,
          comparison_key: comparisonKey,
          site_label: formatSiteLabel(siteLabelFromUrl(url)),
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
      return {
        date,
        price: Math.round((agg.sum / agg.count) * 100) / 100,
      };
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
  resetViewport();
}

function productOptionsForFilter() {
  const category = selectedCategory();
  const options = [...state.historyByProduct.values()].sort((a, b) => a.label.localeCompare(b.label));
  if (category === ALL) return options;
  return options.filter((item) => item.category === category);
}

function renderProductSelect() {
  const options = productOptionsForFilter();
  const previous = els.productSelect.value;

  if (options.length === 0) {
    els.productSelect.innerHTML = '<option value="">Sem historico</option>';
    syncControlAvailability();
    return;
  }

  els.productSelect.innerHTML = options
    .map((item) => `<option value="${escapeHtml(item.product_id)}">${escapeHtml(item.label)}</option>`)
    .join('');

  const nextValue = options.some((item) => item.product_id === previous)
    ? previous
    : options[0].product_id;

  els.productSelect.value = nextValue;
  syncControlAvailability();
}

function currentComparisonGroupIds() {
  const productId = selectedProductId();
  if (!productId) return [];

  const product = state.productsById.get(productId);
  const comparisonKey = normalizeComparisonKey(product?.comparison_key);
  if (!comparisonKey) return [productId];

  return state.comparisonGroups.get(comparisonKey) || [productId];
}

function currentVisibleProductEntries() {
  const category = selectedCategory();
  let entries = [...state.historyByProduct.values()];

  if (category !== ALL) {
    entries = entries.filter((entry) => entry.category === category);
  }

  const scope = currentScope();
  if (scope === 'single-product') {
    return entries.filter((entry) => entry.product_id === selectedProductId());
  }

  if (scope === 'comparison-group') {
    const allowedIds = new Set(currentComparisonGroupIds());
    return entries.filter((entry) => allowedIds.has(entry.product_id));
  }

  return entries.sort((a, b) => a.label.localeCompare(b.label));
}

function datasetFromProduct(entry) {
  const pointMap = valueMap(entry.points);
  const color = colorForCategory(entry.category);

  return {
    kind: 'product',
    productId: entry.product_id,
    categoryKey: entry.category,
    comparisonKey: entry.comparison_key,
    siteLabel: entry.site_label,
    label: entry.label,
    data: state.allDates.map((date) => {
      if (!pointMap.has(date)) return null;
      const value = pointMap.get(date);
      return Number.isFinite(value) ? value : null;
    }),
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    pointRadius: 2,
    pointHoverRadius: 6,
    pointHitRadius: 18,
    spanGaps: true,
    tension: 0.18,
  };
}

function datasetFromCategory(entry) {
  const pointMap = valueMap(entry.points);
  const color = colorForCategory(entry.category);

  return {
    kind: 'category',
    categoryKey: entry.category,
    label: entry.label,
    data: state.allDates.map((date) => {
      if (!pointMap.has(date)) return null;
      const value = pointMap.get(date);
      return Number.isFinite(value) ? value : null;
    }),
    borderColor: color,
    backgroundColor: color,
    borderWidth: 3,
    pointRadius: 2,
    pointHoverRadius: 6,
    pointHitRadius: 18,
    spanGaps: true,
    tension: 0.18,
  };
}

function chartDatasets() {
  const scope = currentScope();
  const category = selectedCategory();

  if (scope === 'single-product') {
    const product = state.historyByProduct.get(selectedProductId());
    if (!product) return [];
    return [datasetFromProduct(product)];
  }

  if (scope === 'comparison-group') {
    return currentVisibleProductEntries().map(datasetFromProduct);
  }

  if (scope === 'by-category') {
    const categories = category === ALL ? state.categories : state.categories.filter((item) => item === category);
    return categories
      .map((item) => state.historyByCategory.get(item))
      .filter(Boolean)
      .map(datasetFromCategory);
  }

  return currentVisibleProductEntries().map(datasetFromProduct);
}

function resetViewport() {
  const lastIndex = Math.max(state.allDates.length - 1, 0);
  state.viewport = {
    startIndex: 0,
    endIndex: lastIndex,
  };
}

function clampViewport() {
  const total = state.allDates.length;
  if (total === 0) {
    state.viewport = { startIndex: 0, endIndex: 0 };
    return;
  }

  let startIndex = Number.isInteger(state.viewport.startIndex) ? state.viewport.startIndex : 0;
  let endIndex = Number.isInteger(state.viewport.endIndex) ? state.viewport.endIndex : total - 1;

  startIndex = clamp(startIndex, 0, total - 1);
  endIndex = clamp(endIndex, startIndex, total - 1);

  state.viewport = { startIndex, endIndex };
}

function visibleRange() {
  clampViewport();
  const { startIndex, endIndex } = state.viewport;

  return {
    startIndex,
    endIndex,
    labels: state.allDates.slice(startIndex, endIndex + 1),
  };
}

function zoomChart(direction) {
  const total = state.allDates.length;
  if (total <= 1) return;

  clampViewport();

  const currentSize = state.viewport.endIndex - state.viewport.startIndex + 1;
  const targetSize = direction === 'in'
    ? Math.max(2, Math.floor(currentSize * 0.72))
    : Math.min(total, Math.ceil(currentSize * 1.35));

  if (targetSize === currentSize) return;

  const center = Math.round((state.viewport.startIndex + state.viewport.endIndex) / 2);
  let startIndex = center - Math.floor(targetSize / 2);
  let endIndex = startIndex + targetSize - 1;

  if (startIndex < 0) {
    endIndex += Math.abs(startIndex);
    startIndex = 0;
  }

  if (endIndex >= total) {
    const overflow = endIndex - total + 1;
    startIndex = Math.max(0, startIndex - overflow);
    endIndex = total - 1;
  }

  state.viewport = { startIndex, endIndex };
  renderLinkedViews({ preserveZoom: true, preserveProductSelect: true });
}

function updateZoomButtons() {
  const total = state.allDates.length;
  const currentSize = total > 0 ? state.viewport.endIndex - state.viewport.startIndex + 1 : 0;

  if (els.zoomIn) {
    els.zoomIn.disabled = total <= 1 || currentSize <= 2;
  }
  if (els.zoomOut) {
    els.zoomOut.disabled = total <= 1 || currentSize >= total;
  }
  if (els.zoomReset) {
    els.zoomReset.disabled = total <= 1 || currentSize >= total;
  }
}

function updateHistoryStageWidth() {
  if (!els.historyScroll || !els.historyStage) return;

  const total = state.allDates.length;
  const visibleCount = total > 0 ? state.viewport.endIndex - state.viewport.startIndex + 1 : 0;
  const containerWidth = els.historyScroll.clientWidth || els.historyScroll.offsetWidth || 0;

  if (!containerWidth || total <= 1 || visibleCount >= total) {
    els.historyStage.style.width = '100%';
    return;
  }

  const zoomFactor = total / visibleCount;
  const stageWidth = Math.max(containerWidth, Math.round(containerWidth * zoomFactor));
  els.historyStage.style.width = `${stageWidth}px`;
}

function syncHistoryScrollPosition() {
  if (!els.historyScroll) return;

  const total = state.allDates.length;
  const visibleCount = total > 0 ? state.viewport.endIndex - state.viewport.startIndex + 1 : 0;
  if (total <= 1 || visibleCount >= total) {
    state.isSyncingHistoryScroll = true;
    els.historyScroll.scrollLeft = 0;
    state.isSyncingHistoryScroll = false;
    return;
  }

  const maxOffset = total - visibleCount;
  const maxScrollLeft = Math.max(els.historyScroll.scrollWidth - els.historyScroll.clientWidth, 0);
  const progress = maxOffset > 0 ? state.viewport.startIndex / maxOffset : 0;

  state.isSyncingHistoryScroll = true;
  els.historyScroll.scrollLeft = progress * maxScrollLeft;
  state.isSyncingHistoryScroll = false;
}

function onHistoryScroll() {
  if (state.isSyncingHistoryScroll || !els.historyScroll) return;
  hideHistoryHoverTooltip();

  if (state.pendingHistoryScrollFrame) {
    window.cancelAnimationFrame(state.pendingHistoryScrollFrame);
  }

  state.pendingHistoryScrollFrame = window.requestAnimationFrame(() => {
    state.pendingHistoryScrollFrame = null;

    const total = state.allDates.length;
    const visibleCount = total > 0 ? state.viewport.endIndex - state.viewport.startIndex + 1 : 0;
    if (total <= 1 || visibleCount >= total) return;

    const maxOffset = total - visibleCount;
    const maxScrollLeft = Math.max(els.historyScroll.scrollWidth - els.historyScroll.clientWidth, 0);
    if (maxOffset <= 0 || maxScrollLeft <= 0) return;

    const progress = els.historyScroll.scrollLeft / maxScrollLeft;
    const startIndex = clamp(Math.round(progress * maxOffset), 0, maxOffset);
    const endIndex = startIndex + visibleCount - 1;

    if (startIndex === state.viewport.startIndex && endIndex === state.viewport.endIndex) {
      return;
    }

    state.viewport = { startIndex, endIndex };
    renderLinkedViews({ preserveZoom: true, preserveProductSelect: true });
  });
}

function projectPointOnSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = (dx * dx) + (dy * dy);

  if (lengthSquared === 0) {
    const distance = Math.hypot(point.x - start.x, point.y - start.y);
    return {
      x: start.x,
      y: start.y,
      t: 0,
      distance,
    };
  }

  const rawT = (((point.x - start.x) * dx) + ((point.y - start.y) * dy)) / lengthSquared;
  const t = clamp(rawT, 0, 1);
  const x = start.x + (dx * t);
  const y = start.y + (dy * t);

  return {
    x,
    y,
    t,
    distance: Math.hypot(point.x - x, point.y - y),
  };
}

function findNearestHistoryLineHit(chart, position) {
  const chartArea = chart?.chartArea;
  if (!chartArea) return null;

  const { x, y } = position;
  if (x < chartArea.left || x > chartArea.right || y < chartArea.top || y > chartArea.bottom) {
    return null;
  }

  const threshold = 14;
  let best = null;

  chart.data.datasets.forEach((dataset, datasetIndex) => {
    const meta = chart.getDatasetMeta(datasetIndex);
    if (!meta || meta.hidden) return;

    const points = meta.data || [];
    const values = dataset.data || [];
    const labels = chart.data.labels || [];

    for (let index = 0; index < points.length; index += 1) {
      const pointValue = Number(values[index]);
      if (!Number.isFinite(pointValue)) continue;

      const point = points[index];
      const distance = Math.hypot(x - point.x, y - point.y);
      if (distance > threshold) continue;

      if (!best || distance < best.distance) {
        best = {
          dataset,
          distance,
          price: pointValue,
          label: labels[index],
          anchorX: point.x,
          anchorY: point.y,
        };
      }
    }

    for (let index = 0; index < points.length - 1; index += 1) {
      const startValue = Number(values[index]);
      const endValue = Number(values[index + 1]);
      if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) continue;

      const startPoint = points[index];
      const endPoint = points[index + 1];
      const projection = projectPointOnSegment({ x, y }, startPoint, endPoint);
      if (projection.distance > threshold) continue;

      if (!best || projection.distance < best.distance) {
        const price = startValue + ((endValue - startValue) * projection.t);
        const labelIndex = projection.t < 0.5 ? index : index + 1;

        best = {
          dataset,
          distance: projection.distance,
          price,
          label: labels[labelIndex],
          anchorX: projection.x,
          anchorY: projection.y,
        };
      }
    }
  });

  return best;
}

function hideHistoryHoverTooltip() {
  if (!els.historyHoverTooltip) return;
  els.historyHoverTooltip.hidden = true;
  if (els.historyCanvas) {
    els.historyCanvas.style.cursor = 'default';
  }
}

function showHistoryHoverTooltip(hit, mouseEvent) {
  if (!els.historyHoverTooltip || !els.historyMain) return;

  els.historyHoverTooltip.innerHTML = `
    <strong>${escapeHtml(hit.dataset.label)}</strong>
    <span class="tooltip-price">${formatMoney(hit.price)}</span>
    <small>${escapeHtml(hit.label || '')}</small>
  `;

  const mainRect = els.historyMain.getBoundingClientRect();
  els.historyHoverTooltip.hidden = false;

  const desiredLeft = mouseEvent.clientX - mainRect.left;
  const desiredTop = mouseEvent.clientY - mainRect.top;
  const tooltipWidth = els.historyHoverTooltip.offsetWidth;
  const tooltipHeight = els.historyHoverTooltip.offsetHeight;
  const left = clamp(desiredLeft, 8, Math.max(8, mainRect.width - tooltipWidth - 8));
  const top = clamp(desiredTop, 8, Math.max(8, mainRect.height - tooltipHeight - 8));

  els.historyHoverTooltip.style.left = `${left}px`;
  els.historyHoverTooltip.style.top = `${top}px`;
}

function handleHistoryHover(event) {
  if (!state.chart) {
    hideHistoryHoverTooltip();
    return;
  }

  const hit = findNearestHistoryLineHit(state.chart, {
    x: event.offsetX,
    y: event.offsetY,
  });

  if (!hit) {
    els.historyCanvas.style.cursor = 'default';
    hideHistoryHoverTooltip();
    return;
  }

  els.historyCanvas.style.cursor = 'pointer';
  showHistoryHoverTooltip(hit, event);
}

function last30DayMinimum(productId) {
  const points = state.historyByProduct.get(productId)?.points || [];
  const values = points
    .slice(-30)
    .map((point) => Number(point.price))
    .filter((value) => Number.isFinite(value));

  return values.length > 0 ? Math.min(...values) : null;
}

function buildCurrentRows() {
  const ids = new Set([
    ...state.latestItemsById.keys(),
    ...state.latestFailuresById.keys(),
  ]);

  const rows = [];
  ids.forEach((productId) => {
    const product = state.productsById.get(productId);
    const success = state.latestItemsById.get(productId);
    const failure = state.latestFailuresById.get(productId);
    const base = success || failure || product || {};
    const units = Number(product?.units_per_package);

    rows.push({
      product_id: productId,
      category: normalizeCategory(product?.category),
      name: product?.name || base.name || productId,
      site_label: formatSiteLabel(siteLabelFromUrl(base.url || product?.url)),
      current_price: success ? Number(success.price) : null,
      lowest_30d: last30DayMinimum(productId),
      unit_price: success && Number.isFinite(units) && units > 1 ? Number(success.unit_price) : null,
      comparison_key: String(product?.comparison_key || '').trim(),
      updated_at: success?.fetched_at || failure?.fetched_at || null,
      status: success ? 'ok' : 'failed',
    });
  });

  return rows.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    if (a.name !== b.name) return a.name.localeCompare(b.name);
    return a.site_label.localeCompare(b.site_label);
  });
}

function rowMatchesSharedFilters(row) {
  const category = selectedCategory();
  if (category !== ALL && row.category !== category) {
    return false;
  }

  const scope = currentScope();
  if (scope === 'single-product') {
    return row.product_id === selectedProductId();
  }

  if (scope === 'comparison-group') {
    const selected = state.productsById.get(selectedProductId());
    if (!selected) return false;

    const selectedComparisonKey = normalizeComparisonKey(selected.comparison_key);
    if (!selectedComparisonKey) {
      return row.product_id === selected.id;
    }

    return normalizeComparisonKey(row.comparison_key) === selectedComparisonKey;
  }

  return true;
}

function tableSummaryText(rowCount) {
  const category = selectedCategory();
  const scope = currentScope();
  const categoryLabel = category === ALL ? 'todas as categorias' : formatCategoryLabel(category);

  if (scope === 'single-product') {
    const product = state.historyByProduct.get(selectedProductId());
    return `${rowCount} linha(s) para ${product?.label || 'o produto selecionado'}, em ${categoryLabel}.`;
  }

  if (scope === 'comparison-group') {
    const product = state.productsById.get(selectedProductId());
    const comparisonKey = String(product?.comparison_key || '').trim() || 'sem grupo';
    return `${rowCount} linha(s) do grupo de comparacao "${comparisonKey}" em ${categoryLabel}.`;
  }

  if (scope === 'by-category') {
    return `${rowCount} linha(s) sincronizadas com a visao por categoria em ${categoryLabel}.`;
  }

  return `${rowCount} linha(s) sincronizadas com o historico em ${categoryLabel}.`;
}

function renderTable() {
  const rows = buildCurrentRows().filter(rowMatchesSharedFilters);
  els.tableFilterSummary.textContent = tableSummaryText(rows.length);

  if (rows.length === 0) {
    els.tbody.innerHTML = '<tr><td colspan="6">Nenhum dado disponivel para o filtro atual.</td></tr>';
    return;
  }

  let lastCategory = '';
  const html = [];

  rows.forEach((row) => {
    if (row.category !== lastCategory) {
      html.push(`
        <tr class="category-group-row" style="--category-color:${colorForCategory(row.category)}">
          <td colspan="6">
            <span class="category-row-dot"></span>
            ${escapeHtml(formatCategoryLabel(row.category))}
          </td>
        </tr>
      `);
      lastCategory = row.category;
    }

    html.push(`
      <tr class="table-product-row" data-product-id="${escapeHtml(row.product_id)}">
        <td>
          <div class="product-name-cell">
            <strong>${escapeHtml(row.name)}</strong>
            ${row.comparison_key ? `<span class="product-meta">Grupo: ${escapeHtml(row.comparison_key)}</span>` : ''}
          </div>
        </td>
        <td><span class="site-pill">${escapeHtml(row.site_label)}</span></td>
        <td>${formatMoney(row.current_price)}</td>
        <td>${formatMoney(row.lowest_30d)}</td>
        <td>${formatMoney(row.unit_price)}</td>
        <td>
          <span class="status-pill ${row.status === 'ok' ? 'status-ok' : 'status-failed'}">
            ${row.status === 'ok' ? 'ok' : 'falhou'}
          </span>
        </td>
      </tr>
    `);
  });

  els.tbody.innerHTML = html.join('');
}

function renderDetailPanel(datasets) {
  const scope = currentScope();
  const range = visibleRange();
  const visibleSpan = range.labels.length > 0
    ? `${range.labels[0]} ate ${range.labels[range.labels.length - 1]}`
    : 'sem dados';

  if (datasets.length === 0) {
    els.detail.innerHTML = 'Sem dados para o filtro atual.';
    return;
  }

  if (scope === 'single-product') {
    const productId = selectedProductId();
    const entry = state.historyByProduct.get(productId);
    const latest = state.latestItemsById.get(productId);
    const min30d = last30DayMinimum(productId);

    els.detail.innerHTML = `
      <div class="detail-list">
        <div class="detail-item"><span>Produto</span><strong>${escapeHtml(entry?.label || 'Produto')}</strong></div>
        <div class="detail-item"><span>Preco atual</span><strong>${formatMoney(latest?.price)}</strong></div>
        <div class="detail-item"><span>Menor preco 30d</span><strong>${formatMoney(min30d)}</strong></div>
        <div class="detail-item"><span>Atualizado</span><strong>${escapeHtml(formatDateTime(latest?.fetched_at))}</strong></div>
        <div class="detail-item"><span>Janela visivel</span><strong>${escapeHtml(visibleSpan)}</strong></div>
      </div>
    `;
    return;
  }

  if (scope === 'comparison-group') {
    const rows = buildCurrentRows().filter(rowMatchesSharedFilters);
    const best = rows
      .filter((row) => Number.isFinite(row.current_price))
      .sort((a, b) => a.current_price - b.current_price)[0];
    const selected = state.productsById.get(selectedProductId());

    els.detail.innerHTML = `
      <div class="detail-list">
        <div class="detail-item"><span>Grupo</span><strong>${escapeHtml(String(selected?.comparison_key || 'Sem grupo'))}</strong></div>
        <div class="detail-item"><span>Lojas visiveis</span><strong>${rows.length}</strong></div>
        <div class="detail-item"><span>Melhor preco atual</span><strong>${best ? `${formatMoney(best.current_price)} (${escapeHtml(best.site_label)})` : '-'}</strong></div>
        <div class="detail-item"><span>Janela visivel</span><strong>${escapeHtml(visibleSpan)}</strong></div>
      </div>
    `;
    return;
  }

  const scopeLabel = scope === 'by-category' ? 'Categorias' : 'Produtos';
  const categoryLabel = selectedCategory() === ALL ? 'Todas' : formatCategoryLabel(selectedCategory());

  els.detail.innerHTML = `
    <div class="detail-list">
      <div class="detail-item"><span>Modo</span><strong>${escapeHtml(scopeLabel)}</strong></div>
      <div class="detail-item"><span>Filtro de categoria</span><strong>${escapeHtml(categoryLabel)}</strong></div>
      <div class="detail-item"><span>Series ativas</span><strong>${datasets.length}</strong></div>
      <div class="detail-item"><span>Janela visivel</span><strong>${escapeHtml(visibleSpan)}</strong></div>
      <div class="detail-item"><span>Snapshots</span><strong>${range.labels.length}/${state.allDates.length}</strong></div>
    </div>
  `;
}

function focusProduct(productId) {
  const historyEntry = state.historyByProduct.get(productId);
  const product = state.productsById.get(productId);
  if (!historyEntry && !product) return;

  const category = normalizeCategory(historyEntry?.category || product?.category);
  els.historyCategoryFilter.value = category || ALL;
  els.chartScope.value = 'single-product';
  renderProductSelect();
  if ([...els.productSelect.options].some((option) => option.value === productId)) {
    els.productSelect.value = productId;
  }

  syncControlAvailability();
  resetViewport();
  renderLinkedViews({ preserveZoom: true, preserveProductSelect: true });
}

function historyChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'nearest',
      intersect: false,
    },
    animation: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        enabled: false,
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
      },
      y: {
        beginAtZero: true,
        ticks: {
          callback(value) {
            return formatMoney(value);
          },
        },
      },
    },
    onClick(event, elements, chart) {
      const hit = findNearestHistoryLineHit(chart, { x: event.x, y: event.y });
      if (!hit) return;

      const dataset = hit.dataset;
      if (!dataset) return;

      if (dataset.kind === 'product' && dataset.productId) {
        focusProduct(dataset.productId);
        return;
      }

      if (dataset.kind === 'category' && dataset.categoryKey) {
        els.historyCategoryFilter.value = dataset.categoryKey;
        resetViewport();
        renderLinkedViews({ preserveZoom: true });
      }
    },
  };
}

function renderHistoryChart() {
  if (state.chart) {
    state.chart.destroy();
    state.chart = null;
  }

  hideHistoryHoverTooltip();

  const range = visibleRange();
  const datasets = chartDatasets().map((dataset) => ({
    ...dataset,
    data: dataset.data.slice(range.startIndex, range.endIndex + 1),
  }));

  if (datasets.length === 0 || range.labels.length === 0) {
    els.detail.textContent = 'Sem dados para o grafico.';
    updateHistoryStageWidth();
    syncHistoryScrollPosition();
    updateZoomButtons();
    return;
  }

  updateHistoryStageWidth();

  state.chart = new window.Chart(els.historyCanvas, {
    type: 'line',
    data: {
      labels: range.labels,
      datasets,
    },
    options: historyChartOptions(),
  });

  renderDetailPanel(datasets);
  window.requestAnimationFrame(() => syncHistoryScrollPosition());
  updateZoomButtons();
}

function buildFilterSummaryFromDraftValue(rawValue) {
  const typed = String(rawValue || '').trim();
  if (!typed) {
    return {
      text: '',
      state: '',
      value: '',
    };
  }

  const match = findCategoryMatch(typed);
  if (!match) {
    return {
      text: `Nova categoria: "${typed}".`,
      state: 'new',
      value: typed,
    };
  }

  return {
    text: match.kind === 'exact'
      ? `Categoria existente: "${match.category}".`
      : `Categoria parecida encontrada: "${match.category}".`,
    state: 'ok',
    value: match.category,
  };
}

function updateCategoryHintForInput(input, { applyMatch = false } = {}) {
  const card = input.closest('[data-draft-id]');
  const hint = card?.querySelector('[data-role="category-hint"]');
  const summary = buildFilterSummaryFromDraftValue(input.value);

  if (applyMatch && summary.state === 'ok' && summary.value) {
    input.value = summary.value;
  }

  if (hint) {
    hint.textContent = summary.text;
    hint.dataset.state = summary.state;
  }

  return applyMatch ? input.value.trim() : summary.value || input.value.trim();
}

function renderAddCategorySuggestions() {
  if (!els.addCategoryList) return;
  els.addCategoryList.innerHTML = state.categories
    .map((category) => `<option value="${escapeHtml(category)}"></option>`)
    .join('');
}

function createEmptyAddDraft(seed = {}) {
  return {
    draftId: `draft-${draftCounter += 1}`,
    name: '',
    url: '',
    category: '',
    comparison_key: '',
    units: '',
    active: 'true',
    price_css: '',
    jsonld: '',
    regex: '',
    notes: '',
    ...seed,
  };
}

function syncAddDraftsFromDom() {
  const cards = [...els.addItems.querySelectorAll('[data-draft-id]')];
  if (cards.length === 0) return;

  state.addDrafts = cards.map((card) => ({
    draftId: card.dataset.draftId,
    name: card.querySelector('[data-field="name"]')?.value || '',
    url: card.querySelector('[data-field="url"]')?.value || '',
    category: card.querySelector('[data-field="category"]')?.value || '',
    comparison_key: card.querySelector('[data-field="comparison_key"]')?.value || '',
    units: card.querySelector('[data-field="units"]')?.value || '',
    active: card.querySelector('[data-field="active"]')?.value || 'true',
    price_css: card.querySelector('[data-field="price_css"]')?.value || '',
    jsonld: card.querySelector('[data-field="jsonld"]')?.value || '',
    regex: card.querySelector('[data-field="regex"]')?.value || '',
    notes: card.querySelector('[data-field="notes"]')?.value || '',
  }));
}

function renderAddDrafts() {
  if (!state.addDrafts.length) {
    state.addDrafts = [createEmptyAddDraft()];
  }

  els.addItems.innerHTML = state.addDrafts.map((draft, index) => `
    <section class="batch-item-card" data-draft-id="${escapeHtml(draft.draftId)}">
      <div class="batch-item-header">
        <div>
          <h3>Produto ${index + 1}</h3>
          <p class="section-note">Cadastre produtos equivalentes em lojas diferentes dentro do mesmo envio.</p>
        </div>
        <button
          type="button"
          class="btn btn-ghost"
          data-action="remove-draft"
          data-draft-id="${escapeHtml(draft.draftId)}"
          ${state.addDrafts.length === 1 ? 'disabled' : ''}
        >Remover</button>
      </div>

      <div class="form-grid compact-form-grid">
        <label>
          Nome
          <input type="text" data-field="name" value="${escapeHtml(draft.name)}" required>
        </label>

        <label>
          URL
          <input type="url" data-field="url" value="${escapeHtml(draft.url)}" required>
        </label>

        <label>
          Categoria
          <input
            type="text"
            list="ap-category-list"
            autocomplete="off"
            data-field="category"
            value="${escapeHtml(draft.category)}"
          >
          <small class="field-hint" data-role="category-hint"></small>
        </label>

        <label>
          Grupo de comparacao
          <input
            type="text"
            data-field="comparison_key"
            value="${escapeHtml(draft.comparison_key)}"
            placeholder="mouse-g203"
          >
        </label>

        <label>
          Unidades por pacote
          <input type="number" data-field="units" min="1" step="1" value="${escapeHtml(draft.units)}">
        </label>

        <label>
          Ativo
          <select data-field="active">
            <option value="true" ${draft.active === 'true' ? 'selected' : ''}>true</option>
            <option value="false" ${draft.active === 'false' ? 'selected' : ''}>false</option>
          </select>
        </label>

        <details class="batch-item-advanced full-width">
          <summary>Seletores e observacoes</summary>

          <div class="form-grid compact-form-grid">
            <label class="full-width">
              Seletores CSS (um por linha)
              <textarea data-field="price_css" rows="3" placeholder=".price&#10;[itemprop='price']">${escapeHtml(draft.price_css)}</textarea>
              <small class="field-hint">Use apenas seletores CSS, nao HTML completo.</small>
            </label>

            <label class="full-width">
              JSON-LD paths (um por linha)
              <textarea data-field="jsonld" rows="3" placeholder="offers.price&#10;offers[0].price">${escapeHtml(draft.jsonld)}</textarea>
            </label>

            <label class="full-width">
              Regex hints (um por linha)
              <textarea data-field="regex" rows="2" placeholder="R\\$\\s*\\d{1,4},\\d{2}">${escapeHtml(draft.regex)}</textarea>
            </label>

            <label class="full-width">
              Observacoes
              <textarea data-field="notes" rows="2">${escapeHtml(draft.notes)}</textarea>
            </label>
          </div>
        </details>
      </div>
    </section>
  `).join('');

  renderAddCategorySuggestions();
  els.addItems.querySelectorAll('[data-field="category"]').forEach((input) => {
    updateCategoryHintForInput(input, { applyMatch: false });
  });
}

function resetAddModal() {
  state.addDrafts = [createEmptyAddDraft()];
  els.addForm.reset();
  renderAddDrafts();
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
  const currentRepo = document.getElementById('ap-repo').value.trim();
  els.modal.setAttribute('aria-hidden', 'false');
  resetAddModal();
  const repoInput = document.getElementById('ap-repo');
  if (!repoInput.value.trim()) {
    repoInput.value = currentRepo || detectDefaultRepo();
  }
}

function closeModal() {
  els.modal.setAttribute('aria-hidden', 'true');
}

function buildIssueBody(payload) {
  return [
    '## Manage Product Request',
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

function buildAddOperation(draft, index) {
  const name = draft.name.trim();
  const url = draft.url.trim();
  const categoryRaw = String(draft.category || '').trim();
  const category = categoryRaw ? normalizeCategory(categoryRaw) : '';
  const comparisonKey = normalizeComparisonKey(draft.comparison_key);
  const unitsRaw = String(draft.units || '').trim();
  const priceCss = splitLines(draft.price_css);
  const jsonldPaths = splitLines(draft.jsonld);
  const regexHints = splitLines(draft.regex);
  const isBlank = [
    name,
    url,
    category,
    comparisonKey,
    unitsRaw,
    draft.price_css,
    draft.jsonld,
    draft.regex,
    draft.notes,
  ].every((value) => !String(value || '').trim());

  if (isBlank) return null;

  if (!name || !url) {
    throw new Error(`Produto ${index + 1}: preencha nome e URL.`);
  }

  if (containsHtmlSnippet(priceCss)) {
    throw new Error(`Produto ${index + 1}: informe apenas seletores CSS, nao HTML completo.`);
  }

  let units;
  if (unitsRaw) {
    units = Number(unitsRaw);
    if (!Number.isFinite(units) || units <= 0) {
      throw new Error(`Produto ${index + 1}: "Unidades por pacote" deve ser maior que zero.`);
    }
  }

  const payload = {
    action: 'add',
    name,
    url,
    ...(category ? { category } : {}),
    ...(comparisonKey ? { comparison_key: comparisonKey } : {}),
    ...(Number.isFinite(units) ? { units_per_package: units } : {}),
    is_active: draft.active !== 'false',
    selectors: {
      price_css: priceCss,
      jsonld_paths: jsonldPaths,
      regex_hints: regexHints,
    },
    ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
  };

  if (payload.selectors.price_css.length === 0) delete payload.selectors.price_css;
  if (payload.selectors.jsonld_paths.length === 0) delete payload.selectors.jsonld_paths;
  if (payload.selectors.regex_hints.length === 0) delete payload.selectors.regex_hints;
  if (Object.keys(payload.selectors).length === 0) delete payload.selectors;

  return payload;
}

function onSubmitAddProduct(event) {
  event.preventDefault();
  syncAddDraftsFromDom();

  const repo = parseRepoInput(document.getElementById('ap-repo').value);
  if (!repo) {
    alert('Informe o repositorio GitHub no formato owner/repo.');
    return;
  }

  let operations;
  try {
    operations = state.addDrafts
      .map((draft, index) => buildAddOperation(draft, index))
      .filter(Boolean);
  } catch (error) {
    alert(error instanceof Error ? error.message : String(error));
    return;
  }

  if (operations.length === 0) {
    alert('Adicione pelo menos um produto antes de abrir a issue.');
    return;
  }

  const payload = operations.length === 1
    ? operations[0]
    : {
      action: 'batch',
      operations,
    };

  const title = operations.length === 1
    ? `[MANAGE PRODUCT] ADD ${operations[0].name}`
    : `[MANAGE PRODUCT] BATCH ADD ${operations.length} PRODUTOS`;

  const issueUrl = `https://github.com/${repo}/issues/new?labels=manage-product&title=${encodeURIComponent(title)}&body=${encodeURIComponent(buildIssueBody(payload))}`;

  window.open(issueUrl, '_blank', 'noopener,noreferrer');
  closeModal();
  resetAddModal();
}

function onChartScopeChange() {
  syncControlAvailability();
  resetViewport();
  renderLinkedViews({ preserveZoom: true });
}

function renderLinkedViews({ preserveZoom = false, preserveProductSelect = false } = {}) {
  if (!preserveProductSelect) {
    renderProductSelect();
  }

  syncControlAvailability();
  if (!preserveZoom) {
    resetViewport();
  } else {
    clampViewport();
  }

  renderHistoryChart();
  renderTable();
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
    buildLatestIndexes();
    buildComparisonGroups();
    buildHistories();
    setFilterOptions(els.historyCategoryFilter, state.categories);
    renderProductSelect();
    els.chartScope.value = 'all-products';

    renderSummary();
    renderCategoryLegend(state.categories);
    renderPieChart();
    renderLinkedViews();
    resetAddModal();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    els.summaryGrid.innerHTML = `<div class="summary-item"><span class="k">Erro</span><span class="v">${escapeHtml(message)}</span></div>`;
    els.tbody.innerHTML = '<tr><td colspan="6">Falha ao carregar dados.</td></tr>';
    els.detail.textContent = `Erro: ${message}`;
  }
}

els.historyCategoryFilter.addEventListener('change', () => {
  resetViewport();
  renderLinkedViews({ preserveZoom: true });
});
els.chartScope.addEventListener('change', onChartScopeChange);
els.productSelect.addEventListener('change', () => {
  resetViewport();
  renderLinkedViews({ preserveZoom: true, preserveProductSelect: true });
});

els.zoomIn.addEventListener('click', () => zoomChart('in'));
els.zoomOut.addEventListener('click', () => zoomChart('out'));
els.zoomReset.addEventListener('click', () => {
  resetViewport();
  renderLinkedViews({ preserveZoom: true, preserveProductSelect: true });
});

els.historyCanvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  zoomChart(event.deltaY > 0 ? 'out' : 'in');
}, { passive: false });
els.historyCanvas.addEventListener('mousemove', handleHistoryHover);
els.historyCanvas.addEventListener('mouseleave', hideHistoryHoverTooltip);
els.historyScroll.addEventListener('scroll', onHistoryScroll);

window.addEventListener('resize', () => {
  updateHistoryStageWidth();
  syncHistoryScrollPosition();
});

els.tbody.addEventListener('click', (event) => {
  const row = event.target.closest('tr[data-product-id]');
  if (!row) return;
  focusProduct(row.dataset.productId);
});

els.openModal.addEventListener('click', openModal);
els.closeModal.addEventListener('click', closeModal);
els.modal.addEventListener('click', (event) => {
  if (event.target.dataset.closeModal === 'true') {
    closeModal();
  }
});

els.addItemButton.addEventListener('click', () => {
  syncAddDraftsFromDom();
  const lastDraft = state.addDrafts[state.addDrafts.length - 1] || createEmptyAddDraft();
  state.addDrafts.push(createEmptyAddDraft({
    category: lastDraft.category,
    comparison_key: lastDraft.comparison_key,
    active: lastDraft.active,
  }));
  renderAddDrafts();
});

els.addItems.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action="remove-draft"][data-draft-id]');
  if (!button) return;

  syncAddDraftsFromDom();
  state.addDrafts = state.addDrafts.filter((draft) => draft.draftId !== button.dataset.draftId);
  renderAddDrafts();
});

els.addItems.addEventListener('input', (event) => {
  const input = event.target.closest('[data-field="category"]');
  if (!input) return;
  updateCategoryHintForInput(input);
});

els.addItems.addEventListener('focusout', (event) => {
  const input = event.target.closest('[data-field="category"]');
  if (!input) return;
  updateCategoryHintForInput(input, { applyMatch: true });
});

els.addForm.addEventListener('submit', onSubmitAddProduct);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && els.modal.getAttribute('aria-hidden') === 'false') {
    closeModal();
  }
});

init();
