const ALL = '__all__';
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
  detail: document.getElementById('history-detail'),
  runDrilldown: document.getElementById('history-run-drilldown'),
  categoryLegend: document.getElementById('category-legend'),
  tableFilterSummary: document.getElementById('table-filter-summary'),
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
  products: [],
  productsById: new Map(),
  drafts: [],
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
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function slugifyLoose(value, fallback = '') {
  const normalized = normalizeSearchText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function formatCategoryLabel(value) {
  return slugifyLoose(value, 'sem-categoria')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatMoney(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '-';
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
    if (!response.ok) return fallback;
    return response.json();
  } catch {
    return fallback;
  }
}

function currentQuery() {
  return normalizeSearchText(els.dashboardSearch?.value || '');
}

function selectedSite() {
  return els.siteFilter?.value || ALL;
}

function selectedStatus() {
  return els.statusFilter?.value || ALL;
}

function itemForProduct(product) {
  return (state.latest?.items || []).find((item) => item.product_id === product.id);
}

function failureForProduct(product) {
  return (state.latest?.failures || []).find((item) => item.product_id === product.id);
}

function offersForProduct(product) {
  return (state.latest?.offers || []).filter((offer) => offer.intent_id === product.id || offer.product_id === product.id);
}

function buildCurrentRows() {
  return state.products.map((product) => {
    const item = itemForProduct(product);
    const failure = failureForProduct(product);
    return {
      product,
      item,
      failure,
      offers: offersForProduct(product),
      site: item?.store || item?.store_id || '',
      status: failure ? 'failed' : item?.status || '',
    };
  }).filter((row) => {
    const query = currentQuery();
    if (query) {
      const haystack = normalizeSearchText([
        row.product.name,
        row.product.characteristics,
        row.product.category,
        row.item?.title,
        row.item?.store,
        row.product.required_terms?.join(' '),
        row.product.preferred_terms?.join(' '),
      ].join(' '));
      if (!haystack.includes(query)) return false;
    }
    if (selectedSite() !== ALL && row.site !== selectedSite()) return false;
    if (selectedStatus() !== ALL && row.status !== selectedStatus()) return false;
    return true;
  });
}

function renderSummary() {
  const summary = state.latest?.summary || {};
  const generatedAt = state.latest?.generated_at;
  if (els.generatedAt) els.generatedAt.textContent = generatedAt ? formatDateTime(generatedAt) : 'Sem execução';
  if (els.overviewStatus) els.overviewStatus.textContent = `${summary.success_count || 0}/${summary.total_products || 0} com oferta`;
  if (els.overallNarrative) {
    els.overallNarrative.textContent = state.latest
      ? `Última busca encontrou ${summary.success_count || 0} intenção(ões) com oferta e ${summary.failure_count || 0} falha(s).`
      : 'Ainda não há snapshot de busca.';
  }

  const metrics = [
    ['Intenções', summary.total_products ?? state.products.length],
    ['Com oferta', summary.success_count ?? 0],
    ['Falhas', summary.failure_count ?? 0],
    ['Ofertas auditadas', (state.latest?.offers || []).length],
  ];
  const html = metrics.map(([label, value]) => `
    <div class="summary-item"><span class="k">${escapeHtml(label)}</span><span class="v">${escapeHtml(value)}</span></div>
  `).join('');
  if (els.summaryGrid) els.summaryGrid.innerHTML = html;
  if (els.heroMetrics) els.heroMetrics.innerHTML = html;

  const engines = Object.entries(summary.engines || {});
  if (els.runHealthStrip) {
    els.runHealthStrip.innerHTML = engines.map(([name, entry]) => `
      <span class="stat-pill"><strong>${escapeHtml(entry.success || 0)}/${escapeHtml(entry.attempted || 0)}</strong> ${escapeHtml(name)}</span>
    `).join('') || '<span class="stat-pill"><strong>0</strong> execuções</span>';
  }
}

function renderStoreHealth() {
  const rows = buildCurrentRows();
  const grouped = new Map();
  for (const row of rows) {
    if (!row.site) continue;
    const entry = grouped.get(row.site) || { ok: 0, failed: 0 };
    if (row.failure) entry.failed += 1;
    else if (row.item) entry.ok += 1;
    grouped.set(row.site, entry);
  }

  if (els.storeHealthList) {
    els.storeHealthList.innerHTML = [...grouped.entries()].sort().map(([store, entry]) => `
      <div class="store-health-row">
        <strong>${escapeHtml(store)}</strong>
        <span>${entry.ok} ok / ${entry.failed} falha(s)</span>
      </div>
    `).join('') || '<p class="section-note">Sem ofertas por loja ainda.</p>';
  }
}

function renderFilters() {
  const previousSite = selectedSite();
  const sites = [...new Set((state.latest?.items || []).map((item) => item.store || item.store_id).filter(Boolean))].sort();
  if (els.siteFilter) {
    els.siteFilter.innerHTML = [
      `<option value="${ALL}">Todas</option>`,
      ...sites.map((site) => `<option value="${escapeHtml(site)}">${escapeHtml(site)}</option>`),
    ].join('');
    els.siteFilter.value = sites.includes(previousSite) ? previousSite : ALL;
  }

  const categories = [...new Set(state.products.map((product) => slugifyLoose(product.category, 'sem-categoria')))].sort();
  if (els.historyCategoryFilter) {
    els.historyCategoryFilter.innerHTML = [
      `<option value="${ALL}">Todas</option>`,
      ...categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(formatCategoryLabel(category))}</option>`),
    ].join('');
  }
  if (els.addCategoryList) {
    els.addCategoryList.innerHTML = categories.map((category) => `<option value="${escapeHtml(category)}"></option>`).join('');
  }
}

function renderOfferList(row) {
  if (!row.offers.length) return '';
  return `
    <details class="offer-details">
      <summary>${row.offers.length} oferta(s) auditada(s)</summary>
      <div class="opportunity-list">
        ${row.offers.map((offer) => `
          <article class="opportunity-item">
            <strong>${escapeHtml(offer.store || offer.store_id)}: ${escapeHtml(offer.title)}</strong>
            <span>${formatMoney(offer.price)}${offer.unit_price ? ` / ${formatMoney(offer.unit_price)} por ${escapeHtml(offer.unit_basis || 'unidade')}` : ''}</span>
            <small>score ${escapeHtml(offer.match_score ?? '-')} | prioridade ${escapeHtml(offer.priority_score ?? 0)}</small>
            <a href="${escapeHtml(offer.url)}" target="_blank" rel="noopener noreferrer">Abrir oferta</a>
          </article>
        `).join('')}
      </div>
    </details>
  `;
}

function renderTable() {
  const rows = buildCurrentRows();
  if (els.tableFilterSummary) {
    els.tableFilterSummary.textContent = `${rows.length} intenção(ões) no recorte atual.`;
  }
  if (!els.tbody) return;

  if (rows.length === 0) {
    els.tbody.innerHTML = '<tr><td colspan="6">Nenhuma intenção encontrada para o filtro atual.</td></tr>';
    return;
  }

  els.tbody.innerHTML = rows.map((row) => {
    const item = row.item;
    const failure = row.failure;
    const unitText = item?.unit_price
      ? `${formatMoney(item.unit_price)} / ${escapeHtml(item.unit_basis || 'unidade')}`
      : '-';
    const status = failure
      ? `Falha: ${escapeHtml(failure.error_code || 'erro')}`
      : item
        ? 'ok'
        : 'sem execução';
    return `
      <tr data-product-id="${escapeHtml(row.product.id)}">
        <td>
          <strong>${escapeHtml(row.product.name)}</strong>
          <span class="product-meta">${escapeHtml(row.product.characteristics || '')}</span>
          ${renderOfferList(row)}
        </td>
        <td>${escapeHtml(item?.store || item?.store_id || '-')}</td>
        <td>${item?.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${formatMoney(item.price)}</a>` : '-'}</td>
        <td>${escapeHtml(item?.title || '-')}</td>
        <td>${unitText}</td>
        <td><span class="status-pill ${failure ? 'status-fallback' : 'status-ok'}">${status}</span></td>
      </tr>
    `;
  }).join('');
}

function renderInsights() {
  const rows = buildCurrentRows();
  const priced = rows.filter((row) => row.item).sort((a, b) => Number(a.item.price) - Number(b.item.price));
  if (els.priceOpportunities) {
    els.priceOpportunities.innerHTML = priced.slice(0, 6).map((row) => `
      <article class="opportunity-item">
        <strong>${escapeHtml(row.product.name)}</strong>
        <span>${formatMoney(row.item.price)} em ${escapeHtml(row.item.store || row.item.store_id)}</span>
        <small>${escapeHtml(row.item.title || '')}</small>
      </article>
    `).join('') || '<p class="section-note">Sem ofertas no último snapshot.</p>';
  }
  if (els.riskList) {
    const failures = rows.filter((row) => row.failure);
    els.riskList.innerHTML = failures.map((row) => `
      <article class="opportunity-item">
        <strong>${escapeHtml(row.product.name)}</strong>
        <span>${escapeHtml(row.failure.error_code || 'falha')}</span>
        <small>${escapeHtml(row.failure.error_detail || '')}</small>
      </article>
    `).join('') || '<p class="section-note">Nenhuma falha no último snapshot.</p>';
  }
  if (els.detail) {
    els.detail.innerHTML = priced.slice(0, 5).map((row) => `
      <p><strong>${escapeHtml(row.product.name)}</strong>: ${formatMoney(row.item.price)}</p>
    `).join('') || 'Sem dados para o recorte.';
  }
  if (els.runDrilldown) els.runDrilldown.textContent = state.latest?.run_id || 'Sem run.';
  if (els.categoryLegend) {
    const categories = [...new Set(rows.map((row) => slugifyLoose(row.product.category, 'sem-categoria')))].sort();
    els.categoryLegend.innerHTML = categories.map((category) => `<span class="site-pill">${escapeHtml(formatCategoryLabel(category))}</span>`).join('');
  }
}

function renderLinkedViews() {
  renderSummary();
  renderFilters();
  renderStoreHealth();
  renderTable();
  renderInsights();
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
        <label>Categoria<input type="text" data-field="category" list="ap-category-list" value="${escapeHtml(draft.category)}"></label>
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

function openModal() {
  const repoInput = document.getElementById('ap-repo');
  const previousRepo = repoInput?.value || '';
  if (els.modal) els.modal.setAttribute('aria-hidden', 'false');
  resetAddModal();
  if (repoInput && !repoInput.value.trim()) repoInput.value = previousRepo || detectDefaultRepo();
}

function closeModal() {
  if (els.modal) els.modal.setAttribute('aria-hidden', 'true');
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

  return {
    action: 'add',
    name,
    ...(characteristics ? { characteristics } : {}),
    ...(category ? { category } : {}),
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
  try {
    const [products, latest] = await Promise.all([
      fetchDataJson('products.json', []),
      fetchDataJson('latest.json', null),
    ]);

    state.products = Array.isArray(products) ? products : [];
    state.productsById = new Map(state.products.map((product) => [product.id, product]));
    state.latest = latest;
    renderDrafts();
    renderLinkedViews();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (els.summaryGrid) els.summaryGrid.innerHTML = `<div class="summary-item"><span class="k">Erro</span><span class="v">${escapeHtml(message)}</span></div>`;
    if (els.tbody) els.tbody.innerHTML = '<tr><td colspan="6">Falha ao carregar dados.</td></tr>';
  }
}

[
  els.dashboardSearch,
  els.globalDashboardSearch,
].forEach((input) => input?.addEventListener('input', () => {
  if (els.dashboardSearch && els.globalDashboardSearch && document.activeElement === els.globalDashboardSearch) {
    els.dashboardSearch.value = els.globalDashboardSearch.value;
  }
  renderLinkedViews();
}));
els.siteFilter?.addEventListener('change', renderLinkedViews);
els.statusFilter?.addEventListener('change', renderLinkedViews);
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
  if (event.key === 'Escape') closeModal();
});

init();
