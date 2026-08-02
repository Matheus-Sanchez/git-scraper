import {
  ALL,
  buildCategoryCounts,
  buildEngineHealth,
  buildFailureBreakdown,
  buildHistoryModel,
  buildHistorySeries,
  buildOpportunities,
  buildRiskRows,
  buildStoreHealth,
  normalizeCategory,
  normalizeText,
  positiveNumber,
  resolveOperationalState,
  selectLatestManifestRun,
  selectRecentRunFiles,
} from './dashboard-model.js?v=20260801a';

const HISTORY_LIMIT = 30;
const CATEGORY_LABELS = Object.freeze({
  armazenamento: 'Armazenamento',
  audio: 'Áudio',
  'casa-inteligente': 'Casa inteligente',
  hardware: 'Hardware',
  higiene: 'Higiene',
  mercado: 'Mercado',
  perifericos: 'Periféricos',
});
let resolvedDataRoot = null;
let draftCounter = 0;

const els = {
  generatedAt: document.getElementById('generated-at'),
  overviewStatus: document.getElementById('overview-status'),
  overallNarrative: document.getElementById('overall-narrative'),
  runHealthStrip: document.getElementById('run-health-strip'),
  storeHealthList: document.getElementById('store-health-list'),
  storeHealthCanvas: document.getElementById('store-health-chart'),
  engineHealthCanvas: document.getElementById('engine-health-chart'),
  failureBreakdownCanvas: document.getElementById('failure-breakdown-chart'),
  pieCanvas: document.getElementById('category-pie-chart'),
  historyCanvas: document.getElementById('history-chart'),
  priceOpportunities: document.getElementById('price-opportunities'),
  riskList: document.getElementById('risk-list'),
  heroMetrics: document.getElementById('hero-metrics'),
  summaryGrid: document.getElementById('summary-grid'),
  focusMetrics: document.getElementById('focus-metrics'),
  tbody: document.getElementById('products-tbody'),
  dashboardSearch: document.getElementById('dashboard-search'),
  globalDashboardSearch: document.getElementById('global-dashboard-search'),
  siteFilter: document.getElementById('site-filter'),
  statusFilter: document.getElementById('status-filter'),
  historyCategoryFilter: document.getElementById('history-category-filter'),
  chartScope: document.getElementById('chart-scope'),
  productSelect: document.getElementById('product-select'),
  productFilterCard: document.getElementById('product-filter-card'),
  hideLegacySeries: document.getElementById('hide-legacy-series'),
  includeSuspiciousSeries: document.getElementById('include-suspicious-series'),
  dashboardResetFilters: document.getElementById('dashboard-reset-filters'),
  activeFilterPills: document.getElementById('active-filter-pills'),
  toolbarInsights: document.getElementById('toolbar-insights'),
  toolbarFooter: document.querySelector('.history-toolbar-footer'),
  detail: document.getElementById('history-detail'),
  runDrilldown: document.getElementById('history-run-drilldown'),
  categoryLegend: document.getElementById('category-legend'),
  historyHoverTooltip: document.getElementById('history-hover-tooltip'),
  tableFilterSummary: document.getElementById('table-filter-summary'),
  zoomIn: document.getElementById('zoom-in'),
  zoomOut: document.getElementById('zoom-out'),
  zoomReset: document.getElementById('zoom-reset'),
  latestJsonLink: document.getElementById('latest-json-link'),
  openModal: document.getElementById('open-add-modal'),
  closeModal: document.getElementById('close-add-modal'),
  modal: document.getElementById('add-modal'),
  addForm: document.getElementById('add-product-form'),
  addItems: document.getElementById('ap-items'),
  addItemButton: document.getElementById('ap-add-item'),
  addCategoryList: document.getElementById('ap-category-list'),
};

const state = {
  latest: null,
  latestSnapshot: null,
  latestRun: null,
  operational: null,
  manifest: null,
  runs: [],
  model: null,
  products: [],
  productsById: new Map(),
  charts: new Map(),
  drafts: [],
  viewportSize: HISTORY_LIMIT,
  selectedRunDate: '',
  runLoadFailures: [],
  lastFocusedElement: null,
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function splitLines(text) {
  return String(text || '')
    .split(/\r?\n|,/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeSearchText(value) {
  return normalizeText(value);
}

function slugifyLoose(value, fallback = '') {
  const normalized = normalizeSearchText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function formatCategoryLabel(value) {
  const category = normalizeCategory(value);
  return CATEGORY_LABELS[category] || category
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatMoney(value) {
  const numeric = positiveNumber(value);
  if (numeric === null) return '-';
  return numeric.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
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

function safeHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

function addUniquePath(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

function dataRootCandidates() {
  const candidates = [];
  addUniquePath(candidates, './data');
  addUniquePath(candidates, '../data');
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  if (pathParts.length > 0) addUniquePath(candidates, `/${pathParts[0]}/data`);
  addUniquePath(candidates, '/data');
  return candidates;
}

async function detectDataRoot() {
  if (resolvedDataRoot) return resolvedDataRoot;
  for (const candidate of dataRootCandidates()) {
    try {
      const response = await fetch(`${candidate}/products.json`, { cache: 'no-store' });
      if (response.ok) {
        resolvedDataRoot = candidate;
        if (els.latestJsonLink) els.latestJsonLink.href = `${candidate}/latest.json`;
        return candidate;
      }
    } catch {
      // Try next candidate.
    }
  }
  throw new Error('Não foi possível localizar os arquivos de dados.');
}

async function fetchDataJson(path, fallback = null) {
  const dataRoot = await detectDataRoot();
  try {
    const response = await fetch(`${dataRoot}/${path}`, { cache: 'no-store' });
    if (!response.ok) {
      if (fallback !== null) return fallback;
      throw new Error(`${path}: HTTP ${response.status}`);
    }
    return response.json();
  } catch (error) {
    if (fallback !== null) return fallback;
    throw error;
  }
}

function themeValue(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function chartTheme() {
  return {
    text: themeValue('--chart-text', '#f0f6fc'),
    axis: themeValue('--chart-axis', '#8b949e'),
    grid: themeValue('--chart-grid', 'rgba(139, 148, 158, .24)'),
    surface: themeValue('--chart-bg', '#060f16'),
    border: themeValue('--chart-border', '#30363d'),
    tooltip: themeValue('--chart-tooltip', '#21262d'),
    badgeBackground: themeValue('--chart-badge-bg', '#0d1117'),
    canvasBackground: themeValue('--chart-bg', '#060f16'),
    centerText: themeValue('--chart-center', '#c0c7d4'),
    chartAreaBackground: themeValue('--chart-area-bg', '#0b141c'),
    chartAreaBorder: themeValue('--chart-border', '#30363d'),
    emptyText: themeValue('--chart-empty', '#8b949e'),
    hoverLine: themeValue('--chart-hover', '#8b949e'),
    legendText: themeValue('--chart-legend', '#c0c7d4'),
    pointFill: themeValue('--chart-point', '#060f16'),
    accent: themeValue('--accent', '#58a6ff'),
    ok: themeValue('--ok', '#238636'),
    warn: themeValue('--warn', '#9e6a03'),
    danger: themeValue('--danger', '#da3633'),
  };
}

function palette() {
  return Array.from({ length: 9 }, (_, index) => (
    themeValue(`--category-${index + 1}`, ['#58a6ff', '#9e6a03', '#238636', '#afc6ff', '#da3633'][index % 5])
  ));
}

function colorFor(value) {
  const colors = palette();
  let hash = 0;
  for (const character of String(value || '')) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length];
}

function chartAvailable() {
  return typeof window.Chart === 'function';
}

function setCanvasState(canvas, kind, message = '') {
  if (!canvas) return;
  const shell = canvas.closest('.chart-shell') || canvas.parentElement;
  let status = shell?.querySelector(':scope > .chart-runtime-state');
  if (!status && shell) {
    status = document.createElement('div');
    status.className = 'chart-runtime-state';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    shell.appendChild(status);
  }
  canvas.hidden = kind !== 'ready';
  canvas.setAttribute('aria-hidden', String(kind !== 'ready'));
  canvas.dataset.chartState = kind;
  if (kind !== 'ready') delete canvas.dataset.dashboardRendered;
  if (status) {
    status.hidden = kind === 'ready';
    status.dataset.state = kind;
    status.textContent = message;
  }
}

function markCharts(kind, message) {
  [els.storeHealthCanvas, els.engineHealthCanvas, els.failureBreakdownCanvas, els.pieCanvas, els.historyCanvas]
    .forEach((canvas) => setCanvasState(canvas, kind, message));
}

function destroyChart(key) {
  const chart = state.charts.get(key);
  if (chart) {
    if (chart.canvas) delete chart.canvas.__dashboardChart;
    chart.destroy();
  }
  state.charts.delete(key);
}

function createChart(key, canvas, config, emptyMessage = 'Sem dados para este gráfico.') {
  destroyChart(key);
  if (!chartAvailable()) {
    setCanvasState(canvas, 'unavailable', 'O runtime de gráficos não foi carregado. Recarregue a página; se persistir, libere os assets do GitHub Pages no bloqueador de conteúdo.');
    return null;
  }
  const hasData = config.data?.datasets?.some((dataset) => dataset.data?.some((value) => {
    const candidate = typeof value === 'object' ? value?.y : value;
    return candidate !== null && candidate !== undefined && Number.isFinite(Number(candidate));
  }));
  if (!hasData) {
    setCanvasState(canvas, 'empty', emptyMessage);
    return null;
  }
  setCanvasState(canvas, 'ready');
  const chart = new window.Chart(canvas, config);
  state.charts.set(key, chart);
  canvas.__dashboardChart = chart;
  canvas.dataset.dashboardRendered = 'true';
  return chart;
}

function selectedSite() {
  return els.siteFilter?.value || ALL;
}

function selectedStatus() {
  return els.statusFilter?.value || ALL;
}

function selectedCategory() {
  return els.historyCategoryFilter?.value || ALL;
}

function selectedProductId() {
  return els.productSelect?.value || '';
}

function currentScope() {
  return els.chartScope?.value || 'all-products';
}

function currentQuery() {
  return normalizeSearchText(els.dashboardSearch?.value || '');
}

function historyOptions() {
  return {
    scope: currentScope(),
    productId: selectedProductId(),
    query: currentQuery(),
    site: selectedSite(),
    status: selectedStatus(),
    category: selectedCategory(),
    hideLegacy: els.hideLegacySeries?.checked !== false,
    includeSuspicious: Boolean(els.includeSuspiciousSeries?.checked),
  };
}

function currentRows() {
  const results = state.latestRun?.results || [];
  const failures = state.latestRun?.failures || [];
  const offers = state.latestRun?.offers || [];
  return state.products.filter((product) => product.is_active !== false).map((product) => {
    const item = results.find((entry) => entry.product_id === product.id) || null;
    const failure = failures.find((entry) => entry.product_id === product.id) || null;
    const status = item?.observation_status || (failure ? 'hard_failure' : 'hard_failure');
    return {
      product,
      item,
      failure,
      status,
      site: item?.store_label || failure?.store_label || 'Sem loja',
      offers: offers.filter((offer) => offer.product_id === product.id),
    };
  });
}

function rowMatchesFilters(row) {
  const query = currentQuery();
  const haystack = normalizeSearchText([
    row.product.name,
    row.product.characteristics,
    row.product.category,
    row.item?.title,
    row.site,
    row.product.required_terms?.join(' '),
  ].join(' '));
  if (query && !haystack.includes(query)) return false;
  if (selectedSite() !== ALL && row.site !== selectedSite()) return false;
  if (selectedStatus() !== ALL && row.status !== selectedStatus()) return false;
  if (selectedCategory() !== ALL && normalizeCategory(row.product.category) !== selectedCategory()) return false;
  if (currentScope() === 'single-product' || currentScope() === 'comparison-group') {
    if (selectedProductId() && row.product.id !== selectedProductId()) return false;
  }
  return true;
}

function renderFilterOptions() {
  const previousSite = selectedSite();
  const sites = [...new Set(state.runs.flatMap((run) => [
    ...run.results.map((result) => result.store_label),
    ...run.offers.map((offer) => offer.store_label),
  ]).filter(Boolean))].sort();
  if (els.siteFilter) {
    els.siteFilter.innerHTML = [`<option value="${ALL}">Todas</option>`, ...sites.map((site) => (
      `<option value="${escapeHtml(site)}">${escapeHtml(site)}</option>`
    ))].join('');
    els.siteFilter.value = sites.includes(previousSite) ? previousSite : ALL;
  }

  const previousCategory = selectedCategory();
  const categories = [...new Set(state.products.map((product) => normalizeCategory(product.category)))].sort();
  if (els.historyCategoryFilter) {
    els.historyCategoryFilter.innerHTML = [`<option value="${ALL}">Todas</option>`, ...categories.map((category) => (
      `<option value="${escapeHtml(category)}">${escapeHtml(formatCategoryLabel(category))}</option>`
    ))].join('');
    els.historyCategoryFilter.value = categories.includes(previousCategory) ? previousCategory : ALL;
  }
  if (els.addCategoryList) {
    els.addCategoryList.innerHTML = categories.map((category) => `<option value="${escapeHtml(category)}"></option>`).join('');
  }
}

function productCandidates() {
  const query = currentQuery();
  return [...state.model.histories.values()].filter((entry) => {
    if (els.hideLegacySeries?.checked !== false && entry.legacy) return false;
    if (selectedCategory() !== ALL && entry.category !== selectedCategory()) return false;
    return !query || normalizeSearchText(`${entry.name} ${entry.category}`).includes(query);
  }).sort((left, right) => left.name.localeCompare(right.name));
}

function renderProductSelect() {
  if (!els.productSelect) return;
  const previous = selectedProductId();
  const candidates = productCandidates();
  els.productSelect.innerHTML = candidates.length
    ? candidates.map((entry) => `<option value="${escapeHtml(entry.product_id)}">${escapeHtml(entry.name)}</option>`).join('')
    : '<option value="">Sem produto no recorte</option>';
  els.productSelect.value = candidates.some((entry) => entry.product_id === previous)
    ? previous
    : (candidates[0]?.product_id || '');
  const usesProduct = ['single-product', 'comparison-group'].includes(currentScope());
  if (els.productFilterCard) els.productFilterCard.hidden = !usesProduct;
  els.productSelect.disabled = !usesProduct || candidates.length === 0;
}

function renderSummary() {
  const summary = state.latest?.summary || {};
  const health = buildStoreHealth(state.latestRun, state.products);
  const totals = health.reduce((acc, row) => ({
    fresh: acc.fresh + row.fresh_success,
    carried: acc.carried + row.carried_forward,
    failed: acc.failed + row.hard_failure,
  }), { fresh: 0, carried: 0, failed: 0 });
  const total = totals.fresh + totals.carried + totals.failed;
  const rows = currentRows();
  const excluded = rows.filter((row) => row.item?.suspicious || row.item?.unverified).length;
  const trusted = rows.filter((row) => row.item && !row.item.suspicious && !row.item.unverified).length;
  const rawCoverage = total ? Math.round(((totals.fresh + totals.carried) / total) * 100) : 0;
  const trustedCoverage = total ? Math.round((trusted / total) * 100) : 0;
  const fatal = state.operational?.is_fatal;
  const dataError = state.operational?.status === 'data_error';
  const operationalDetail = state.operational?.operational_error?.error_detail
    || state.operational?.operational_error?.message
    || state.operational?.operational_error?.error_code
    || '';
  if (els.generatedAt) els.generatedAt.textContent = state.latest?.generated_at ? `Execução: ${formatDateTime(state.latest.generated_at)}` : 'Sem execução';
  if (els.overviewStatus) {
    els.overviewStatus.textContent = fatal ? 'Falha fatal' : dataError ? 'Erro de dados' : totals.failed || excluded ? 'Atenção' : totals.carried ? 'Monitorado' : 'Saudável';
    els.overviewStatus.dataset.state = fatal || dataError || totals.failed || excluded ? 'danger' : totals.carried ? 'warn' : 'ok';
  }
  if (els.overallNarrative) {
    const prefix = fatal
      ? `A execução mais recente terminou com falha fatal${operationalDetail ? `: ${operationalDetail}` : '.'} O snapshot anterior permanece somente como histórico; não é apresentado como estado atual. `
      : dataError
        ? 'O manifesto aponta uma execução mais recente, mas seu payload não pôde ser carregado. O histórico disponível foi preservado sem promover um snapshot antigo a estado atual. '
        : '';
    els.overallNarrative.textContent = `${prefix}${totals.fresh} coleta(s) nova(s), ${totals.carried} preço(s) reaproveitado(s), ${totals.failed} falha(s) definitiva(s) e ${excluded} observação(ões) excluída(s) por qualidade. Valores reaproveitados ou não verificados não entram em oportunidades.`;
  }
  const metrics = [
    ['Intenções', fatal || dataError ? total : (summary.total_products ?? total)],
    ['Coletas novas', totals.fresh],
    ['Reaproveitados', totals.carried],
    ['Falhas', totals.failed],
    ['Excluídos da análise', excluded],
    ['Ofertas auditadas', state.latestRun?.offers.length || 0],
    ['Runs carregados', state.runs.length],
  ];
  const html = metrics.map(([label, value]) => `<div class="summary-item"><span class="k">${escapeHtml(label)}</span><span class="v">${escapeHtml(value)}</span></div>`).join('');
  if (els.summaryGrid) els.summaryGrid.innerHTML = html;
  if (els.heroMetrics) {
    els.heroMetrics.innerHTML = [
      ['Estado operacional', fatal ? 'Fatal' : dataError ? 'Erro de dados' : 'Disponível', state.operational?.latest_is_stale ? 'latest.json é anterior ao manifesto' : 'alinhado ao manifesto'],
      ['Cobertura confiável', `${trustedCoverage}%`, `${trusted}/${total} observações verificadas`],
      ['Coleta real', totals.fresh, `${totals.carried} reaproveitado(s)`],
      ['Janela', state.model.dates.length, `${state.model.dates[0] || '-'} até ${state.model.dates.at(-1) || '-'}`],
      ['Cobertura bruta', `${rawCoverage}%`, state.runLoadFailures.length ? `${state.runLoadFailures.length} run(s) indisponível(is)` : 'manifesto carregado'],
    ].map(([label, value, note]) => `<article class="hero-metric-card"><span class="metric-label">${escapeHtml(label)}</span><strong class="metric-value">${escapeHtml(value)}</strong><small class="metric-note">${escapeHtml(note)}</small></article>`).join('');
  }
  if (els.runHealthStrip) {
    els.runHealthStrip.innerHTML = [
      ...(fatal || dataError ? [[fatal ? 'Falha fatal' : 'Erro de dados', totals.failed, 'danger']] : []),
      ['Coleta nova', totals.fresh, 'ok'],
      ['Reaproveitado', totals.carried, 'warn'],
      ['Falha definitiva', totals.failed, 'danger'],
      ['Cobertura confiável', `${trustedCoverage}%`, totals.failed || excluded ? 'warn' : 'ok'],
    ].map(([label, value, status]) => `<article class="health-tile" data-state="${status}"><span class="metric-label">${escapeHtml(label)}</span><strong class="metric-value">${escapeHtml(value)}</strong></article>`).join('');
  }
}

function compactChartOptions({ stacked = false, indexAxis = 'x' } = {}) {
  const theme = chartTheme();
  return {
    theme,
    responsive: true,
    maintainAspectRatio: false,
    indexAxis,
    animation: { duration: 220 },
    plugins: {
      legend: { position: 'bottom', labels: { color: theme.axis, boxWidth: 10, boxHeight: 10 } },
      tooltip: { backgroundColor: theme.tooltip, titleColor: theme.text, bodyColor: theme.text },
    },
    scales: {
      x: { stacked, grid: { color: theme.grid }, ticks: { color: theme.axis }, border: { color: theme.border } },
      y: { stacked, grid: { color: theme.grid }, ticks: { color: theme.axis, precision: 0 }, border: { color: theme.border } },
    },
  };
}

function renderDiagnosticCharts() {
  const theme = chartTheme();
  const stores = buildStoreHealth(state.latest, state.products);
  if (els.storeHealthList) {
    els.storeHealthList.innerHTML = stores.map((row) => `<article class="store-health-row"><div class="store-health-topline"><strong>${escapeHtml(row.store)}</strong><span>${row.total} intenção(ões)</span></div><div class="store-health-meta"><span>${row.fresh_success} nova(s)</span><span>${row.carried_forward} reaproveitada(s)</span><span>${row.hard_failure} falha(s)</span></div></article>`).join('') || '<div class="empty-state">Sem dados por loja.</div>';
  }
  createChart('store', els.storeHealthCanvas, {
    type: 'bar',
    data: {
      labels: stores.map((row) => row.store),
      datasets: [
        { label: 'Coleta nova', data: stores.map((row) => row.fresh_success), backgroundColor: theme.ok, borderRadius: 5 },
        { label: 'Reaproveitado', data: stores.map((row) => row.carried_forward), backgroundColor: theme.warn, borderRadius: 5 },
        { label: 'Falha definitiva', data: stores.map((row) => row.hard_failure), backgroundColor: theme.danger, borderRadius: 5 },
      ],
    },
    options: compactChartOptions({ stacked: true, indexAxis: 'y' }),
  }, 'Nenhum resultado de loja na última execução.');

  const engines = buildEngineHealth(state.latest);
  createChart('engine', els.engineHealthCanvas, {
    type: 'bar',
    data: {
      labels: engines.map((row) => row.name.replace(/_/g, ' ')),
      datasets: [
        { label: 'Tentativas', data: engines.map((row) => row.attempted), backgroundColor: theme.accent, borderRadius: 5 },
        { label: 'Sucessos', data: engines.map((row) => row.success), backgroundColor: theme.ok, borderRadius: 5 },
        { label: 'Falhas', data: engines.map((row) => row.failed), backgroundColor: theme.danger, borderRadius: 5 },
      ],
    },
    options: compactChartOptions(),
  }, 'A execução não informou métricas por engine.');

  const failures = buildFailureBreakdown(state.latest);
  createChart('failure', els.failureBreakdownCanvas, {
    type: 'doughnut',
    data: {
      labels: failures.map((row) => row.code.replace(/_/g, ' ')),
      datasets: [{ data: failures.map((row) => row.count), backgroundColor: failures.map((row) => colorFor(row.code)), borderColor: theme.surface, borderWidth: 2 }],
    },
    options: { theme, responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { color: theme.axis } } } },
  }, 'Nenhuma falha classificada na última execução.');

  const categories = buildCategoryCounts(state.products);
  createChart('category', els.pieCanvas, {
    type: 'doughnut',
    data: {
      labels: categories.map((row) => formatCategoryLabel(row.category)),
      datasets: [{ data: categories.map((row) => row.count), backgroundColor: categories.map((row) => colorFor(row.category)), borderColor: theme.surface, borderWidth: 2 }],
    },
    options: { theme, responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right', labels: { color: theme.axis } } } },
  }, 'Nenhum produto ativo no catálogo.');
}

function visibleDates() {
  return state.model.dates.slice(-Math.min(state.viewportSize, state.model.dates.length));
}

function historyDatasets(series, dates) {
  const dateSet = new Set(dates);
  return series.map((entry) => {
    const points = entry.points.filter((point) => dateSet.has(point.date));
    const color = colorFor(entry.id);
    return {
      label: entry.label,
      data: points.map((point) => point.value),
      borderColor: color,
      backgroundColor: color,
      borderWidth: series.length === 1 ? 3 : 2,
      tension: 0.2,
      spanGaps: false,
      pointRadius(context) {
        const point = points[context.dataIndex];
        if (point?.suspicious || point?.unverified) return 5;
        return point?.status === 'carried_forward' ? 4 : (series.length === 1 ? 3 : 1);
      },
      pointStyle(context) {
        const point = points[context.dataIndex];
        if (point?.suspicious) return 'triangle';
        if (point?.unverified) return 'rectRounded';
        return point?.status === 'carried_forward' ? 'rectRot' : 'circle';
      },
      pointBackgroundColor(context) {
        const point = points[context.dataIndex];
        if (point?.suspicious) return chartTheme().danger;
        if (point?.unverified) return chartTheme().surface;
        return ['carried_forward', 'mixed'].includes(point?.status) ? chartTheme().warn : color;
      },
      pointBorderColor(context) {
        const point = points[context.dataIndex];
        return point?.unverified ? chartTheme().warn : color;
      },
      segment: {
        borderDash(context) {
          const current = points[context.p1DataIndex];
          const previous = points[context.p0DataIndex];
          return ['carried_forward', 'mixed'].includes(current?.status)
            || ['carried_forward', 'mixed'].includes(previous?.status) ? [7, 5] : undefined;
        },
      },
      _series: entry,
      _points: points,
    };
  });
}

function renderHistoryChart() {
  const series = buildHistorySeries(state.model, historyOptions());
  const dates = visibleDates();
  const datasets = historyDatasets(series, dates);
  const theme = chartTheme();
  const indexed = ['all-products', 'by-category'].includes(currentScope());
  createChart('history', els.historyCanvas, {
    type: 'line',
    data: { labels: dates, datasets },
    options: {
      theme,
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      animation: { duration: 220 },
      plugins: {
        legend: { display: series.length <= 12, position: 'bottom', labels: { color: theme.axis, boxWidth: 10, boxHeight: 10 } },
        tooltip: {
          backgroundColor: theme.tooltip,
          titleColor: theme.text,
          bodyColor: theme.text,
          callbacks: {
            label(context) {
              const point = context.dataset._points?.[context.dataIndex];
              const value = indexed ? `índice ${Number(context.parsed.y).toLocaleString('pt-BR')}` : formatMoney(context.parsed.y);
              const stale = point?.suspicious
                ? ' · suspeito (auditoria)'
                : point?.unverified
                  ? ' · não verificado (auditoria)'
                  : (point?.status === 'carried_forward' ? ' · reaproveitado' : point?.status === 'mixed' ? ' · inclui reaproveitados' : ' · coleta nova');
              const store = point?.store ? ` · ${point.store}` : '';
              return `${context.dataset.label}: ${value}${store}${stale}`;
            },
            afterLabel(context) {
              const point = context.dataset._points?.[context.dataIndex];
              if (point?.suspicious || point?.unverified) {
                return `Qualidade: ${[
                  ...(point.quality_reasons || []),
                  ...(point.quality_unknown_reasons || []),
                ].join(', ')}`;
              }
              if (indexed && positiveNumber(point?.original_value)) return `Preço: ${formatMoney(point.original_value)}`;
              return point?.source ? `Fonte: ${point.source}` : '';
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: theme.axis, maxTicksLimit: 8 }, border: { color: theme.border } },
        y: {
          beginAtZero: false,
          grid: { color: theme.grid },
          ticks: { color: theme.axis, callback: (value) => indexed ? Number(value).toLocaleString('pt-BR') : formatMoney(value) },
          title: { display: true, color: theme.axis, text: indexed ? 'Índice (base 100)' : (series[0]?.unit || 'BRL') },
          border: { color: theme.border },
        },
      },
      onClick(_event, elements) {
        const hit = elements?.[0];
        if (!hit) return;
        state.selectedRunDate = dates[hit.index] || state.selectedRunDate;
        const selectedSeries = series[hit.datasetIndex];
        if (selectedSeries?.product_id && currentScope() === 'all-products') focusProduct(selectedSeries.product_id);
        else renderRunDrilldown();
      },
    },
  }, 'Sem observações confiáveis para este recorte. Ajuste os filtros ou aguarde uma nova coleta.');
  if (els.historyCanvas) {
    els.historyCanvas.setAttribute('aria-label', `Histórico de preços: ${els.chartScope?.selectedOptions[0]?.textContent || 'recorte atual'}`);
    els.historyCanvas.dataset.visiblePointCount = String(datasets.reduce((count, dataset) => (
      count + dataset.data.filter((value) => value !== null).length
    ), 0));
  }
  renderHistoryDetails(series, dates);
  renderFocusMetrics(series);
  updateZoomButtons();
  return series;
}

function hideHistoryHover() {
  if (els.historyHoverTooltip) els.historyHoverTooltip.hidden = true;
  state.charts.get('history')?.setActiveHover?.(null);
}

function renderHistoryHover(event) {
  const chart = state.charts.get('history');
  if (!chart || !els.historyCanvas || !els.historyHoverTooltip) return;
  const rect = els.historyCanvas.getBoundingClientRect();
  const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  let nearest = null;
  (chart.config?.data?.datasets || []).forEach((dataset, datasetIndex) => {
    const meta = chart.getDatasetMeta?.(datasetIndex);
    (meta?.data || []).forEach((element, dataIndex) => {
      if (!element) return;
      const distance = Math.hypot(element.x - pointer.x, element.y - pointer.y);
      if (!nearest || distance < nearest.distance) {
        nearest = { dataset, datasetIndex, dataIndex, element, distance };
      }
    });
  });
  if (!nearest || nearest.distance > 28) {
    hideHistoryHover();
    return;
  }

  const point = nearest.dataset._points?.[nearest.dataIndex];
  const indexed = ['all-products', 'by-category'].includes(currentScope());
  const displayedValue = nearest.dataset.data[nearest.dataIndex];
  const value = indexed ? `Índice ${Number(displayedValue).toLocaleString('pt-BR')}` : formatMoney(displayedValue);
  const qualityReasons = [
    ...(point?.quality_reasons || []),
    ...(point?.quality_unknown_reasons || []),
  ];
  const status = point?.suspicious
    ? 'Suspeito — somente auditoria'
    : point?.unverified
      ? 'Não verificado — somente auditoria'
      : point?.status === 'carried_forward'
        ? 'Preço reaproveitado'
        : point?.status === 'mixed'
          ? 'Agregado com preços reaproveitados'
          : 'Coleta nova';
  els.historyHoverTooltip.innerHTML = `<strong>${escapeHtml(nearest.dataset.label)}</strong><span>${escapeHtml(point?.date || '')}${point?.store ? ` · ${escapeHtml(point.store)}` : ''}</span><span class="tooltip-price">${escapeHtml(value)}</span><small>${escapeHtml(status)}</small>${indexed && positiveNumber(point?.original_value) ? `<small>Preço original: ${formatMoney(point.original_value)}</small>` : ''}${point?.source ? `<small>Fonte: ${escapeHtml(point.source)}</small>` : ''}${qualityReasons.length ? `<small>Qualidade: ${escapeHtml(qualityReasons.join(', '))}</small>` : ''}`;
  const containerRect = els.historyCanvas.closest('#history-main')?.getBoundingClientRect() || rect;
  els.historyHoverTooltip.style.left = `${event.clientX - containerRect.left}px`;
  els.historyHoverTooltip.style.top = `${event.clientY - containerRect.top}px`;
  els.historyHoverTooltip.hidden = false;
  chart.setActiveHover?.({
    datasetIndex: nearest.datasetIndex,
    x: nearest.element.x,
    y: nearest.element.y,
  });
}

function renderHistoryDetails(series, dates) {
  if (els.detail) {
    const pointCount = series.reduce((count, entry) => count + entry.points.filter((point) => dates.includes(point.date) && point.value !== null).length, 0);
    const unit = ['all-products', 'by-category'].includes(currentScope()) ? 'Índice base 100' : (series[0]?.unit || 'BRL');
    els.detail.innerHTML = `<div class="detail-list"><div class="detail-item"><span>Modo</span><strong>${escapeHtml(els.chartScope?.selectedOptions[0]?.textContent || '')}</strong></div><div class="detail-item"><span>Séries</span><strong>${series.length}</strong></div><div class="detail-item"><span>Pontos válidos</span><strong>${pointCount}</strong></div><div class="detail-item"><span>Escala</span><strong>${escapeHtml(unit)}</strong></div><div class="detail-item"><span>Janela</span><strong>${escapeHtml(dates.length ? `${dates[0]} até ${dates.at(-1)}` : 'sem dados')}</strong></div></div>`;
  }
  if (els.categoryLegend) {
    els.categoryLegend.innerHTML = series.map((entry) => `<span class="category-chip"><span class="category-chip-dot" style="background:${colorFor(entry.id)}"></span>${escapeHtml(entry.label)}</span>`).join('') || '<span class="category-chip">Sem séries</span>';
  }
  if (!state.selectedRunDate || !dates.includes(state.selectedRunDate)) state.selectedRunDate = dates.at(-1) || '';
  renderRunDrilldown();
}

function renderRunDrilldown() {
  if (!els.runDrilldown) return;
  const runs = state.runs.filter((run) => run.run_date === state.selectedRunDate);
  if (!runs.length) {
    els.runDrilldown.innerHTML = '<div class="empty-state">Nenhum run carregado para esta data.</div>';
    return;
  }
  els.runDrilldown.innerHTML = `<div class="run-drilldown-header"><strong>Runs de ${escapeHtml(state.selectedRunDate)}</strong><small>${runs.length} execução(ões)</small></div><div class="run-drilldown-list">${runs.map((run) => {
    const summary = run.summary || {};
    const status = run.manifest_status === 'fatal'
      ? 'fatal'
      : (Number(summary.failure_count || run.failures.length) > 0 ? 'partial' : 'success');
    return `<article class="run-drilldown-item is-${status}"><div class="run-drilldown-topline"><strong>${escapeHtml(formatDateTime(run.generated_at))}</strong><span class="run-status-chip status-${status}">${status}</span></div><div class="run-drilldown-meta"><span>${summary.success_count ?? run.results.length} ok / ${summary.failure_count ?? run.failures.length} falhas</span><span>${escapeHtml(run.run_id)}</span></div></article>`;
  }).join('')}</div>`;
}

function renderInsights() {
  const opportunities = buildOpportunities(state.model);
  if (els.priceOpportunities) {
    els.priceOpportunities.innerHTML = opportunities.map((row) => {
      const unitSuffix = row.metric === 'unit_price' ? ` / ${escapeHtml(row.unit || 'unidade')}` : '';
      const totalNote = row.metric === 'unit_price' ? ` · pacote ${formatMoney(row.total_price)}` : '';
      return `<article class="opportunity-row ${row.change_pct <= 0 ? 'is-good' : 'is-neutral'}"><div><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.store || 'Sem loja')} · referência mediana ${formatMoney(row.baseline)}${unitSuffix} · observação ${escapeHtml(row.date)}</small></div><div class="opportunity-value"><strong>${formatMoney(row.price)}${unitSuffix}</strong><small>${row.change_pct > 0 ? '+' : ''}${row.change_pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% vs histórico${totalNote}</small></div></article>`;
    }).join('') || '<div class="empty-state">Ainda não há observações novas e confiáveis suficientes para comparar com o histórico.</div>';
  }
  const risks = buildRiskRows(state.model, state.latestRun);
  if (els.riskList) {
    const labels = {
      hard_failure: 'Falha',
      carried_forward: 'Reaproveitado',
      suspicious: 'Suspeito',
      unverified: 'Não verificado',
    };
    els.riskList.innerHTML = risks.map((row) => `<article class="opportunity-row ${['hard_failure', 'suspicious'].includes(row.status) ? 'is-risk' : 'is-warn'}"><div><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.detail)}</small></div><div class="opportunity-value"><strong>${escapeHtml(labels[row.status] || 'Revisar')}</strong></div></article>`).join('') || '<div class="empty-state">Nenhuma falha, reaproveitamento ou risco de qualidade exige revisão.</div>';
  }
}

function renderOfferList(row) {
  if (!row.offers.length) return '';
  const accepted = row.offers.filter((offer) => !offer.rejected && !offer.suspicious && !offer.unverified);
  const rejected = row.offers.filter((offer) => offer.rejected || offer.suspicious || offer.unverified);
  const render = (offer, audit = false) => {
    const url = safeHttpUrl(offer.url);
    const qualityReasons = [
      ...(offer.rejected_reasons || []),
      ...(offer.quality_reasons || []),
      ...(offer.quality_unknown_reasons || []),
    ];
    return `<article class="opportunity-item ${audit ? 'is-audit-rejected' : ''}"><strong>${escapeHtml(offer.store_label)}: ${escapeHtml(offer.title)}</strong><span>${formatMoney(offer.price)}${offer.unit_price ? ` · ${formatMoney(offer.unit_price)} por ${escapeHtml(offer.unit_basis || 'unidade')}` : ''}</span><small>${audit ? `Não usada: ${escapeHtml(qualityReasons.join(', ') || 'falha de qualidade')}` : `score ${escapeHtml(offer.match_score ?? '-')}`}</small>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Abrir oferta</a>` : ''}</article>`;
  };
  return `<details class="offer-details"><summary>${accepted.length} aceita(s) · ${rejected.length} rejeitada(s)</summary><div class="opportunity-list">${accepted.map((offer) => render(offer)).join('')}${rejected.length ? `<details class="offer-audit"><summary>Ver rejeitadas para auditoria</summary>${rejected.map((offer) => render(offer, true)).join('')}</details>` : ''}</div></details>`;
}

function carriedForwardSource(item) {
  const source = item?.carried_forward_from || {};
  const sourceDate = String(source.run_date || source.run_id || '').match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return sourceDate
    ? `última observação de ${sourceDate}`
    : 'observação anterior';
}

function failureReason(failure, fallback = 'Não houve oferta aceita nesta execução.') {
  return String(
    failure?.error_detail
    || failure?.last_error
    || failure?.error_code
    || fallback,
  );
}

function renderTableValue(row) {
  if (!row.item) {
    return '<div class="table-value-stack"><strong>—</strong><small>Sem valor atual publicável</small></div>';
  }
  const itemUrl = safeHttpUrl(row.item.url);
  const value = formatMoney(row.item.price);
  const link = itemUrl
    ? `<a href="${escapeHtml(itemUrl)}" target="_blank" rel="noopener noreferrer"><strong>${value}</strong></a>`
    : `<strong>${value}</strong>`;
  const note = row.status === 'carried_forward'
    ? `Valor histórico reaproveitado · ${carriedForwardSource(row.item)}`
    : 'Preço encontrado na coleta atual';
  return `<div class="table-value-stack">${link}<small>${escapeHtml(note)}</small></div>`;
}

function renderTableOrigin(row) {
  if (!row.item) {
    return `<div class="table-value-stack"><strong>Falha de coleta</strong><small>${escapeHtml(failureReason(row.failure))}</small></div>`;
  }
  const sourceLabel = row.status === 'carried_forward'
    ? `Histórico · ${carriedForwardSource(row.item)}`
    : `Coleta atual · ${row.item.store_label || 'Sem loja'}`;
  return `<div class="table-value-stack"><strong>${escapeHtml(row.item.title || row.item.name || 'Oferta sem título')}</strong><small>${escapeHtml(sourceLabel)}</small></div>`;
}

function renderTableStatus(row) {
  const qualityReasons = [
    ...(row.item?.quality_reasons || []),
    ...(row.item?.quality_unknown_reasons || []),
  ];
  const qualityWarning = row.item?.suspicious || row.item?.unverified
    ? `<small class="quality-warning">Excluído das análises: ${escapeHtml(qualityReasons.join(', ') || 'observação não verificada')}</small>`
    : '';
  if (row.status === 'fresh_success') {
    const partialDetail = row.failure ? ` · ${failureReason(row.failure)}` : '';
    return `<div class="status-stack"><span class="status-pill status-ok">Coleta nova</span><small>${escapeHtml(`Valor da execução atual${partialDetail}`)}</small>${qualityWarning}</div>`;
  }
  if (row.status === 'carried_forward') {
    const carryReason = row.failure
      ? failureReason(row.failure)
      : String(row.item?.carried_forward_reason || '');
    const detail = carryReason
      ? `Tentativa atual falhou: ${carryReason}`
      : `Preço reaproveitado de ${carriedForwardSource(row.item)}`;
    const label = carryReason ? 'Reaproveitado após falha' : 'Valor reaproveitado';
    return `<div class="status-stack"><span class="status-pill status-fallback">${label}</span><small>${escapeHtml(detail)}</small>${qualityWarning}</div>`;
  }
  return `<div class="status-stack"><span class="status-pill status-failed">Falha definitiva</span><small>${escapeHtml(failureReason(row.failure))}</small></div>`;
}

function renderTable() {
  const rows = currentRows().filter(rowMatchesFilters);
  if (els.tableFilterSummary) {
    els.tableFilterSummary.textContent = `${rows.length} intenção(ões) no recorte. Valores reaproveitados são históricos e exibem a origem; ofertas rejeitadas aparecem apenas na auditoria.`;
  }
  if (!els.tbody) return;
  if (!rows.length) {
    els.tbody.innerHTML = '<tr><td colspan="6">Nenhuma intenção encontrada para o filtro atual.</td></tr>';
    return;
  }
  els.tbody.innerHTML = rows.map((row) => {
    const stateClass = row.status === 'carried_forward'
      ? 'is-carried-forward'
      : (row.status === 'hard_failure' ? 'is-failed' : '');
    return `<tr class="table-product-row ${stateClass}" data-product-id="${escapeHtml(row.product.id)}" tabindex="0" aria-label="Analisar histórico de ${escapeHtml(row.product.name)}"><td class="product-name-cell"><strong>${escapeHtml(row.product.name)}</strong><span class="product-meta">${escapeHtml(row.product.characteristics || '')}</span>${renderOfferList(row)}</td><td>${escapeHtml(row.site)}</td><td>${renderTableValue(row)}</td><td>${renderTableOrigin(row)}</td><td>${row.item?.unit_price ? `<div class="table-value-stack"><strong>${formatMoney(row.item.unit_price)}</strong><small>por ${escapeHtml(row.item.unit_basis || 'unidade')}</small></div>` : '-'}</td><td>${renderTableStatus(row)}</td></tr>`;
  }).join('');
}

function renderFocusMetrics(series) {
  if (!els.focusMetrics) return;
  const rows = currentRows().filter(rowMatchesFilters);
  const fresh = rows.filter((row) => row.status === 'fresh_success').length;
  const carried = rows.filter((row) => row.status === 'carried_forward').length;
  const failed = rows.filter((row) => row.status === 'hard_failure').length;
  const suspicious = rows.filter((row) => row.item?.suspicious || row.item?.unverified).length;
  els.focusMetrics.innerHTML = [
    ['Séries visíveis', series.length, `${visibleDates().length}/${state.model.dates.length} dias`],
    ['Coleta nova', fresh, 'observações da execução atual'],
    ['Reaproveitados', carried, 'identificados por linha tracejada'],
    ['Excluídos', suspicious + failed, `${suspicious} suspeito(s)/não verificado(s), ${failed} falha(s)`],
  ].map(([label, value, note]) => `<article class="focus-card-item"><span class="metric-label">${escapeHtml(label)}</span><strong class="metric-value">${escapeHtml(value)}</strong><small class="metric-note">${escapeHtml(note)}</small></article>`).join('');
}

function renderActiveFilters(series) {
  if (!els.activeFilterPills) return;
  const pills = [];
  if (currentQuery()) pills.push(`Busca: ${els.dashboardSearch.value}`);
  if (selectedSite() !== ALL) pills.push(`Loja: ${selectedSite()}`);
  if (selectedStatus() !== ALL) pills.push(`Status: ${els.statusFilter.selectedOptions[0]?.textContent}`);
  if (selectedCategory() !== ALL) pills.push(`Categoria: ${formatCategoryLabel(selectedCategory())}`);
  if (currentScope() !== 'all-products') pills.push(`Modo: ${els.chartScope.selectedOptions[0]?.textContent}`);
  if (els.hideLegacySeries?.checked === false) pills.push('Legado visível');
  if (els.includeSuspiciousSeries?.checked) pills.push('Suspeitos/não verificados visíveis para auditoria');
  if (els.toolbarFooter) els.toolbarFooter.hidden = !pills.length && !series.length;
  els.activeFilterPills.innerHTML = pills.map((pill) => `<span class="filter-pill">${escapeHtml(pill)}</span>`).join('');
  if (els.toolbarInsights) els.toolbarInsights.innerHTML = `<span class="insight-chip"><strong>${series.length}</strong><small>séries</small></span><span class="insight-chip"><strong>${visibleDates().length}</strong><small>dias visíveis</small></span>`;
}

function updateZoomButtons() {
  const total = state.model?.dates.length || 0;
  if (els.zoomIn) els.zoomIn.disabled = total <= 3 || state.viewportSize <= 3;
  if (els.zoomOut) els.zoomOut.disabled = state.viewportSize >= total;
  if (els.zoomReset) els.zoomReset.disabled = state.viewportSize >= total;
}

function zoomHistory(direction) {
  const total = state.model?.dates.length || 0;
  if (!total) return;
  state.viewportSize = direction === 'in'
    ? Math.max(3, Math.floor(state.viewportSize * 0.7))
    : Math.min(total, Math.ceil(state.viewportSize * 1.4));
  renderLinkedViews({ filters: false, diagnostics: false });
}

function focusProduct(productId) {
  if (!state.model.histories.has(productId)) return;
  els.chartScope.value = 'single-product';
  const entry = state.model.histories.get(productId);
  if (els.historyCategoryFilter) els.historyCategoryFilter.value = entry.category;
  renderProductSelect();
  els.productSelect.value = productId;
  renderLinkedViews({ filters: false, diagnostics: false });
  document.getElementById('history-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderLinkedViews({ filters = false, diagnostics = true } = {}) {
  if (!state.model) return;
  if (filters) renderFilterOptions();
  renderProductSelect();
  renderSummary();
  if (diagnostics) renderDiagnosticCharts();
  const series = renderHistoryChart();
  renderActiveFilters(series);
  renderInsights();
  renderTable();
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

function parseRepoInput(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/^\/+|\/+$/g, '');
  const parts = cleaned.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[0]}/${parts[1]}`;
}

function createEmptyDraft(seed = {}) {
  draftCounter += 1;
  return {
    draftId: `draft-${draftCounter}`,
    name: '',
    characteristics: '',
    category: '',
    stores: '',
    required_terms: '',
    preferred_terms: '',
    excluded_terms: '',
    required_attributes: '',
    preferred_attributes: '',
    unit_basis: '',
    active: 'true',
    notes: '',
    ...seed,
  };
}

function syncDraftsFromDom() {
  if (!els.addItems) return;
  const cards = [...els.addItems.querySelectorAll('[data-draft-id]')];
  state.drafts = cards.map((card) => ({
    draftId: card.dataset.draftId,
    name: card.querySelector('[data-field="name"]')?.value || '',
    characteristics: card.querySelector('[data-field="characteristics"]')?.value || '',
    category: card.querySelector('[data-field="category"]')?.value || '',
    stores: card.querySelector('[data-field="stores"]')?.value || '',
    required_terms: card.querySelector('[data-field="required_terms"]')?.value || '',
    preferred_terms: card.querySelector('[data-field="preferred_terms"]')?.value || '',
    excluded_terms: card.querySelector('[data-field="excluded_terms"]')?.value || '',
    required_attributes: card.querySelector('[data-field="required_attributes"]')?.value || '',
    preferred_attributes: card.querySelector('[data-field="preferred_attributes"]')?.value || '',
    unit_basis: card.querySelector('[data-field="unit_basis"]')?.value || '',
    active: card.querySelector('[data-field="active"]')?.value || 'true',
    notes: card.querySelector('[data-field="notes"]')?.value || '',
  }));
}

function renderDrafts() {
  if (!els.addItems) return;
  if (!state.drafts.length) state.drafts = [createEmptyDraft()];
  els.addItems.innerHTML = state.drafts.map((draft, index) => `
    <section class="batch-item-card" data-draft-id="${escapeHtml(draft.draftId)}">
      <div class="batch-item-header">
        <div>
          <h3>Intenção ${index + 1}</h3>
          <p class="section-note">Cadastre o que procurar. URLs serão descobertas pelas lojas.</p>
        </div>
        <button type="button" class="btn btn-ghost" data-action="remove-draft" ${state.drafts.length === 1 ? 'disabled' : ''}>Remover</button>
      </div>
      <div class="form-grid compact-form-grid">
        <label>Nome do produto<input type="text" data-field="name" value="${escapeHtml(draft.name)}" required></label>
        <label>Características<input type="text" data-field="characteristics" value="${escapeHtml(draft.characteristics)}" placeholder="DDR4 16GB, tamanho G, 1kg..."></label>
        <label>Categoria<input type="text" data-field="category" list="ap-category-list" value="${escapeHtml(draft.category)}" required aria-required="true" placeholder="ex.: periféricos"></label>
        <label>Lojas<input type="text" data-field="stores" value="${escapeHtml(draft.stores)}" placeholder="vazio = todas; ou amazon,kabum"></label>
        <label>Unidade-base<select data-field="unit_basis">
          <option value="">Sem unitário</option>
          <option value="unit" ${draft.unit_basis === 'unit' ? 'selected' : ''}>Unidade</option>
          <option value="gb" ${draft.unit_basis === 'gb' ? 'selected' : ''}>GB</option>
          <option value="kg" ${draft.unit_basis === 'kg' ? 'selected' : ''}>kg</option>
          <option value="g" ${draft.unit_basis === 'g' ? 'selected' : ''}>g</option>
          <option value="l" ${draft.unit_basis === 'l' ? 'selected' : ''}>l</option>
          <option value="ml" ${draft.unit_basis === 'ml' ? 'selected' : ''}>ml</option>
        </select></label>
        <label>Ativo<select data-field="active"><option value="true" ${draft.active !== 'false' ? 'selected' : ''}>Sim</option><option value="false" ${draft.active === 'false' ? 'selected' : ''}>Não</option></select></label>
        <details class="batch-item-advanced full-width">
          <summary>Prioridades e restrições</summary>
          <div class="form-grid compact-form-grid">
            <label class="full-width">Termos obrigatórios<textarea data-field="required_terms" rows="2" placeholder="ddr4&#10;fralda">${escapeHtml(draft.required_terms)}</textarea></label>
            <label class="full-width">Termos preferenciais<textarea data-field="preferred_terms" rows="2" placeholder="16gb&#10;bluetooth">${escapeHtml(draft.preferred_terms)}</textarea></label>
            <label class="full-width">Termos banidos<textarea data-field="excluded_terms" rows="2" placeholder="usado&#10;reembalado">${escapeHtml(draft.excluded_terms)}</textarea></label>
            <label class="full-width">Atributos obrigatórios JSON<textarea data-field="required_attributes" rows="2" placeholder='{"memory_type":"ddr4"} ou {"size":"G"}'>${escapeHtml(draft.required_attributes)}</textarea></label>
            <label class="full-width">Atributos preferenciais JSON<textarea data-field="preferred_attributes" rows="2" placeholder='{"capacity_total_gb":16}'>${escapeHtml(draft.preferred_attributes)}</textarea></label>
            <label class="full-width">Observações<textarea data-field="notes" rows="2">${escapeHtml(draft.notes)}</textarea></label>
          </div>
        </details>
      </div>
    </section>
  `).join('');
}

function resetAddModal() {
  state.drafts = [createEmptyDraft()];
  renderDrafts();
}

function modalIsOpen() {
  return els.modal?.getAttribute('aria-hidden') === 'false';
}

function modalFocusableElements() {
  if (!els.modal) return [];
  return [...els.modal.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length > 0);
}

function setModalBackgroundInert(value) {
  const shell = document.querySelector('.app-shell');
  if (shell) shell.inert = value;
  document.body.classList.toggle('modal-open', value);
}

function openModal(event) {
  const repoInput = document.getElementById('ap-repo');
  const previousRepo = repoInput?.value || '';
  state.lastFocusedElement = event?.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : document.activeElement;
  if (els.modal) els.modal.setAttribute('aria-hidden', 'false');
  setModalBackgroundInert(true);
  resetAddModal();
  if (repoInput && !repoInput.value.trim()) repoInput.value = previousRepo || detectDefaultRepo();
  requestAnimationFrame(() => els.closeModal?.focus());
}

function closeModal() {
  if (!modalIsOpen()) return;
  if (els.modal) els.modal.setAttribute('aria-hidden', 'true');
  setModalBackgroundInert(false);
  if (state.lastFocusedElement instanceof HTMLElement && state.lastFocusedElement.isConnected) {
    state.lastFocusedElement.focus();
  }
  state.lastFocusedElement = null;
}

function trapModalFocus(event) {
  if (event.key !== 'Tab' || !modalIsOpen()) return;
  const focusable = modalFocusableElements();
  if (!focusable.length) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && (document.activeElement === first || !els.modal.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !els.modal.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
}

function parseJsonField(value, label) {
  const text = String(value || '').trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}: JSON inválido.`);
  }
}

function buildOperation(draft, index) {
  const name = draft.name.trim();
  const characteristics = draft.characteristics.trim();
  const category = slugifyLoose(draft.category);
  if (!name) throw new Error(`Intenção ${index + 1}: preencha o nome.`);
  if (!category) throw new Error(`Intenção ${index + 1}: informe uma categoria.`);

  return {
    action: 'add',
    name,
    ...(characteristics ? { characteristics } : {}),
    category,
    ...(splitLines(draft.stores).length ? { stores: splitLines(draft.stores) } : {}),
    ...(splitLines(draft.required_terms).length ? { required_terms: splitLines(draft.required_terms) } : {}),
    ...(splitLines(draft.preferred_terms).length ? { preferred_terms: splitLines(draft.preferred_terms) } : {}),
    ...(splitLines(draft.excluded_terms).length ? { excluded_terms: splitLines(draft.excluded_terms) } : {}),
    ...(parseJsonField(draft.required_attributes, `Intenção ${index + 1} atributos obrigatórios`) ? { required_attributes: parseJsonField(draft.required_attributes, `Intenção ${index + 1} atributos obrigatórios`) } : {}),
    ...(parseJsonField(draft.preferred_attributes, `Intenção ${index + 1} atributos preferenciais`) ? { preferred_attributes: parseJsonField(draft.preferred_attributes, `Intenção ${index + 1} atributos preferenciais`) } : {}),
    ...(draft.unit_basis ? { unit_rule: { basis: draft.unit_basis } } : {}),
    is_active: draft.active !== 'false',
    ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
  };
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

function onSubmitAddProduct(event) {
  event.preventDefault();
  syncDraftsFromDom();
  const repo = parseRepoInput(document.getElementById('ap-repo')?.value);
  if (!repo) {
    alert('Informe o repositorio GitHub no formato owner/repo.');
    return;
  }

  let operations;
  try {
    operations = state.drafts.map((draft, index) => buildOperation(draft, index));
  } catch (error) {
    alert(error instanceof Error ? error.message : String(error));
    return;
  }

  const payload = operations.length === 1 ? operations[0] : { action: 'batch', operations };
  const title = operations.length === 1
    ? `[MANAGE PRODUCT] ADD ${operations[0].name}`
    : `[MANAGE PRODUCT] BATCH ADD ${operations.length} INTENCOES`;
  const issueUrl = `https://github.com/${repo}/issues/new?labels=manage-product&title=${encodeURIComponent(title)}&body=${encodeURIComponent(buildIssueBody(payload))}`;

  window.open(issueUrl, '_blank', 'noopener,noreferrer');
  closeModal();
}

async function init() {
  markCharts('loading', 'Carregando dados históricos...');
  try {
    const [products, latest, manifest] = await Promise.all([
      fetchDataJson('products.json'),
      fetchDataJson('latest.json'),
      fetchDataJson('runs/index.json'),
    ]);

    state.products = Array.isArray(products) ? products : [];
    state.productsById = new Map(state.products.map((product) => [product.id, product]));
    state.latestSnapshot = latest;
    state.manifest = manifest;
    const files = selectRecentRunFiles(manifest, HISTORY_LIMIT);
    const latestManifestEntry = selectLatestManifestRun(manifest);
    const fatalErrors = new Map();
    const loaded = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(8, Math.max(files.length, 1)) }, async () => {
      while (cursor < files.length) {
        const index = cursor;
        cursor += 1;
        const file = files[index];
        try {
          const payload = await fetchDataJson(`runs/${file}`);
          loaded.push({ file, payload });
        } catch (error) {
          state.runLoadFailures.push({ file, message: error instanceof Error ? error.message : String(error) });
        }
      }
    });
    await Promise.all(workers);
    if (latestManifestEntry?.status === 'fatal' && latestManifestEntry.error_file) {
      try {
        const fatalError = await fetchDataJson(`errors/${latestManifestEntry.error_file}`);
        fatalErrors.set(latestManifestEntry.run_id, fatalError);
      } catch (error) {
        state.runLoadFailures.push({
          file: `errors/${latestManifestEntry.error_file}`,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    loaded.push({ file: `${latest.run_id || 'latest'}.json`, payload: latest });
    state.model = buildHistoryModel({
      products: state.products,
      runs: loaded,
      limit: HISTORY_LIMIT,
      manifest,
      fatalErrors,
    });
    state.runs = state.model.runs;
    state.operational = resolveOperationalState({
      manifest,
      runs: state.model.runs,
      latest,
      products: state.products,
      fatalErrors,
    });
    state.latestRun = state.operational.run;
    state.latest = state.latestRun;
    if (els.latestJsonLink && state.operational.latest_is_stale) {
      els.latestJsonLink.title = 'latest.json contém o último snapshot publicável, anterior à execução operacional indicada pelo manifesto.';
      els.latestJsonLink.dataset.state = 'stale-snapshot';
    }
    state.viewportSize = state.model.dates.length;
    state.selectedRunDate = state.operational.entry?.run_date || state.model.dates.at(-1) || '';
    renderDrafts();
    renderLinkedViews({ filters: true });
    document.documentElement.dataset.dashboardReady = 'true';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    markCharts('error', `Falha ao carregar o dashboard: ${message}`);
    if (els.summaryGrid) els.summaryGrid.innerHTML = `<div class="summary-item"><span class="k">Erro</span><span class="v">${escapeHtml(message)}</span></div>`;
    if (els.tbody) els.tbody.innerHTML = '<tr><td colspan="6">Falha ao carregar dados.</td></tr>';
    document.documentElement.dataset.dashboardReady = 'error';
  }
}

function onSearchInput(event) {
  const value = event.currentTarget.value;
  if (els.dashboardSearch && event.currentTarget !== els.dashboardSearch) els.dashboardSearch.value = value;
  if (els.globalDashboardSearch && event.currentTarget !== els.globalDashboardSearch) els.globalDashboardSearch.value = value;
  renderLinkedViews({ filters: false, diagnostics: false });
}

[els.dashboardSearch, els.globalDashboardSearch].forEach((input) => input?.addEventListener('input', onSearchInput));
[els.siteFilter, els.statusFilter, els.historyCategoryFilter, els.hideLegacySeries, els.includeSuspiciousSeries]
  .forEach((input) => input?.addEventListener('change', () => renderLinkedViews({ filters: false, diagnostics: false })));
els.chartScope?.addEventListener('change', () => {
  renderProductSelect();
  renderLinkedViews({ filters: false, diagnostics: false });
});
els.productSelect?.addEventListener('change', () => renderLinkedViews({ filters: false, diagnostics: false }));
els.dashboardResetFilters?.addEventListener('click', () => {
  if (els.dashboardSearch) els.dashboardSearch.value = '';
  if (els.globalDashboardSearch) els.globalDashboardSearch.value = '';
  if (els.siteFilter) els.siteFilter.value = ALL;
  if (els.statusFilter) els.statusFilter.value = ALL;
  if (els.historyCategoryFilter) els.historyCategoryFilter.value = ALL;
  if (els.chartScope) els.chartScope.value = 'all-products';
  if (els.hideLegacySeries) els.hideLegacySeries.checked = true;
  if (els.includeSuspiciousSeries) els.includeSuspiciousSeries.checked = false;
  state.viewportSize = state.model?.dates.length || HISTORY_LIMIT;
  renderLinkedViews({ filters: false, diagnostics: false });
});
els.zoomIn?.addEventListener('click', () => zoomHistory('in'));
els.zoomOut?.addEventListener('click', () => zoomHistory('out'));
els.zoomReset?.addEventListener('click', () => {
  state.viewportSize = state.model?.dates.length || HISTORY_LIMIT;
  renderLinkedViews({ filters: false, diagnostics: false });
});
document.getElementById('history-scroll')?.addEventListener('wheel', (event) => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  zoomHistory(event.deltaY > 0 ? 'out' : 'in');
}, { passive: false });
els.historyCanvas?.addEventListener('mousemove', renderHistoryHover);
els.historyCanvas?.addEventListener('mouseleave', hideHistoryHover);
els.tbody?.addEventListener('click', (event) => {
  if (event.target.closest('a, button, summary, details')) return;
  const row = event.target.closest('tr[data-product-id]');
  if (row?.dataset.productId) focusProduct(row.dataset.productId);
});
els.tbody?.addEventListener('keydown', (event) => {
  if (!['Enter', ' '].includes(event.key)) return;
  const row = event.target.closest('tr[data-product-id]');
  if (!row || event.target !== row) return;
  event.preventDefault();
  focusProduct(row.dataset.productId);
});
window.addEventListener('git-scraper-theme-change', () => {
  if (state.model) renderLinkedViews({ filters: false, diagnostics: true });
});
els.openModal?.addEventListener('click', openModal);
document.querySelectorAll('[data-open-add-modal]').forEach((button) => button.addEventListener('click', openModal));
els.closeModal?.addEventListener('click', closeModal);
els.modal?.addEventListener('click', (event) => {
  if (event.target.dataset.closeModal === 'true') closeModal();
});
els.addItemButton?.addEventListener('click', () => {
  syncDraftsFromDom();
  state.drafts.push(createEmptyDraft());
  renderDrafts();
});
els.addItems?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action="remove-draft"]');
  if (!button) return;
  const card = button.closest('[data-draft-id]');
  syncDraftsFromDom();
  state.drafts = state.drafts.filter((draft) => draft.draftId !== card?.dataset.draftId);
  renderDrafts();
});
els.addForm?.addEventListener('submit', onSubmitAddProduct);
document.addEventListener('keydown', (event) => {
  trapModalFocus(event);
  if (event.key === 'Escape' && modalIsOpen()) closeModal();
});

init();
