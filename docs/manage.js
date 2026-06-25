const ALL = '__all__';
let resolvedDataRoot = null;

const els = {
  repoInput: document.getElementById('repo-input'),
  categoryFilter: document.getElementById('category-filter'),
  activeFilter: document.getElementById('active-filter'),
  searchInput: document.getElementById('search-input'),
  stats: document.getElementById('manage-stats'),
  tbody: document.getElementById('products-manage-tbody'),
  openAdd: document.getElementById('open-add'),
  modal: document.getElementById('manage-modal'),
  closeModal: document.getElementById('close-manage-modal'),
  form: document.getElementById('manage-form'),
  fieldId: document.getElementById('mf-product-id'),
  fieldName: document.getElementById('mf-name'),
  fieldCharacteristics: document.getElementById('mf-characteristics'),
  fieldCategory: document.getElementById('mf-category'),
  fieldCategoryHint: document.getElementById('mf-category-hint'),
  fieldCategoryList: document.getElementById('mf-category-list'),
  fieldStores: document.getElementById('mf-stores'),
  fieldRequiredTerms: document.getElementById('mf-required-terms'),
  fieldPreferredTerms: document.getElementById('mf-preferred-terms'),
  fieldExcludedTerms: document.getElementById('mf-excluded-terms'),
  fieldRequiredAttributes: document.getElementById('mf-required-attributes'),
  fieldPreferredAttributes: document.getElementById('mf-preferred-attributes'),
  fieldUnitBasis: document.getElementById('mf-unit-basis'),
  fieldActive: document.getElementById('mf-active'),
  fieldNotes: document.getElementById('mf-notes'),
  modalTitle: document.getElementById('manage-modal-title'),
};

const state = {
  products: [],
  categories: [],
  mode: 'add',
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

function normalizeKey(value, fallback = '') {
  const normalized = String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function formatCategoryLabel(value) {
  return normalizeKey(value, 'sem-categoria')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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
        return candidate;
      }
    } catch {
      // Try next candidate.
    }
  }
  throw new Error('Não foi possível localizar products.json.');
}

async function fetchProducts() {
  const dataRoot = await detectDataRoot();
  const response = await fetch(`${dataRoot}/products.json`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Falha ao carregar products.json (${response.status})`);
  const products = await response.json();
  return Array.isArray(products) ? products : [];
}

function renderCategorySuggestions() {
  if (!els.fieldCategoryList) return;
  els.fieldCategoryList.innerHTML = state.categories.map((category) => `<option value="${escapeHtml(category)}"></option>`).join('');
}

function setCategoryFilterOptions() {
  if (!els.categoryFilter) return;
  els.categoryFilter.innerHTML = [
    `<option value="${ALL}">Todas</option>`,
    ...state.categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(formatCategoryLabel(category))}</option>`),
  ].join('');
}

function renderStats() {
  const total = state.products.length;
  const active = state.products.filter((product) => product.is_active).length;
  if (!els.stats) return;
  els.stats.innerHTML = [
    `<span class="stat-pill"><strong>${total}</strong> intenções</span>`,
    `<span class="stat-pill"><strong>${active}</strong> ativas</span>`,
    `<span class="stat-pill"><strong>${state.categories.length}</strong> categorias</span>`,
  ].join('');
}

function currentFilteredProducts() {
  const category = els.categoryFilter?.value || ALL;
  const activeFilter = els.activeFilter?.value || ALL;
  const query = String(els.searchInput?.value || '').trim().toLowerCase();

  return state.products.filter((product) => {
    const productCategory = normalizeKey(product.category, 'sem-categoria');
    if (category !== ALL && productCategory !== category) return false;
    if (activeFilter === 'active' && !product.is_active) return false;
    if (activeFilter === 'inactive' && product.is_active) return false;
    if (!query) return true;
    return [
      product.id,
      product.name,
      product.characteristics,
      product.category,
      product.stores?.join(' '),
      product.required_terms?.join(' '),
      product.preferred_terms?.join(' '),
      product.notes,
    ].join(' ').toLowerCase().includes(query);
  });
}

function renderProductsTable() {
  const rows = currentFilteredProducts().sort((a, b) => a.name.localeCompare(b.name));
  if (!els.tbody) return;
  if (rows.length === 0) {
    els.tbody.innerHTML = '<tr><td colspan="6">Nenhuma intenção para o filtro atual.</td></tr>';
    return;
  }

  els.tbody.innerHTML = rows.map((product) => `
    <tr>
      <td>
        <div class="product-name-cell">
          <strong>${escapeHtml(product.name)}</strong>
          <span class="product-meta">${escapeHtml(product.characteristics || '')}</span>
        </div>
      </td>
      <td>${escapeHtml(formatCategoryLabel(product.category))}</td>
      <td>${escapeHtml((product.stores || []).join(', ') || 'todas')}</td>
      <td>${escapeHtml((product.required_terms || []).join(', ') || '-')}</td>
      <td><span class="status-pill ${product.is_active ? 'status-ok' : 'status-fallback'}">${product.is_active ? 'Ativo' : 'Inativo'}</span></td>
      <td class="actions-cell">
        <button type="button" class="btn btn-ghost" data-action="edit" data-id="${escapeHtml(product.id)}">Editar</button>
        <button type="button" class="btn btn-danger" data-action="remove" data-id="${escapeHtml(product.id)}">Remover</button>
      </td>
    </tr>
  `).join('');
}

function updateCategoryHint() {
  if (!els.fieldCategoryHint || !els.fieldCategory) return;
  const category = normalizeKey(els.fieldCategory.value);
  els.fieldCategoryHint.textContent = category && !state.categories.includes(category)
    ? `Nova categoria: "${category}".`
    : '';
}

function setUnitBasisValue(product) {
  if (!els.fieldUnitBasis) return;
  els.fieldUnitBasis.value = product?.unit_rule?.basis || '';
}

function openModal(mode, product = null) {
  state.mode = mode;
  if (els.modal) els.modal.setAttribute('aria-hidden', 'false');
  if (els.modalTitle) els.modalTitle.textContent = mode === 'add' ? 'Nova Intenção' : 'Editar Intenção';
  renderCategorySuggestions();

  els.fieldId.value = product?.id || '';
  els.fieldName.value = product?.name || '';
  els.fieldCharacteristics.value = product?.characteristics || '';
  els.fieldCategory.value = product?.category || '';
  els.fieldStores.value = (product?.stores || []).join('\n');
  els.fieldRequiredTerms.value = (product?.required_terms || []).join('\n');
  els.fieldPreferredTerms.value = (product?.preferred_terms || []).join('\n');
  els.fieldExcludedTerms.value = (product?.excluded_terms || []).join('\n');
  els.fieldRequiredAttributes.value = product?.required_attributes ? JSON.stringify(product.required_attributes, null, 2) : '';
  els.fieldPreferredAttributes.value = product?.preferred_attributes ? JSON.stringify(product.preferred_attributes, null, 2) : '';
  setUnitBasisValue(product);
  els.fieldActive.value = product?.is_active === false ? 'false' : 'true';
  els.fieldNotes.value = product?.notes || '';
  updateCategoryHint();
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

function buildIssueUrl({ title, payload }) {
  const repo = parseRepoInput(els.repoInput.value);
  if (!repo) {
    alert('Informe o repositório no formato owner/repo.');
    return null;
  }

  const body = [
    '## Manage Product Request',
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '',
    'Criado via página de gerenciamento.',
  ].join('\n');

  return `https://github.com/${repo}/issues/new?labels=manage-product&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

function buildPayloadFromForm() {
  const category = normalizeKey(els.fieldCategory.value);
  const requiredAttributes = parseJsonField(els.fieldRequiredAttributes.value, 'Atributos obrigatórios');
  const preferredAttributes = parseJsonField(els.fieldPreferredAttributes.value, 'Atributos preferenciais');
  return {
    action: state.mode === 'add' ? 'add' : 'edit',
    ...(state.mode === 'edit' ? { product_id: els.fieldId.value.trim() } : {}),
    name: els.fieldName.value.trim(),
    characteristics: els.fieldCharacteristics.value.trim(),
    ...(category ? { category } : {}),
    ...(splitLines(els.fieldStores.value).length ? { stores: splitLines(els.fieldStores.value) } : {}),
    ...(splitLines(els.fieldRequiredTerms.value).length ? { required_terms: splitLines(els.fieldRequiredTerms.value) } : {}),
    ...(splitLines(els.fieldPreferredTerms.value).length ? { preferred_terms: splitLines(els.fieldPreferredTerms.value) } : {}),
    ...(splitLines(els.fieldExcludedTerms.value).length ? { excluded_terms: splitLines(els.fieldExcludedTerms.value) } : {}),
    ...(requiredAttributes ? { required_attributes: requiredAttributes } : {}),
    ...(preferredAttributes ? { preferred_attributes: preferredAttributes } : {}),
    ...(els.fieldUnitBasis.value ? { unit_rule: { basis: els.fieldUnitBasis.value } } : {}),
    is_active: els.fieldActive.value === 'true',
    ...(els.fieldNotes.value.trim() ? { notes: els.fieldNotes.value.trim() } : {}),
  };
}

function onSubmitManageForm(event) {
  event.preventDefault();

  let payload;
  try {
    payload = buildPayloadFromForm();
  } catch (error) {
    alert(error instanceof Error ? error.message : String(error));
    return;
  }

  if (!payload.name) {
    alert('Nome é obrigatório.');
    return;
  }

  const title = `[MANAGE PRODUCT] ${payload.action.toUpperCase()} ${payload.name}`;
  const issueUrl = buildIssueUrl({ title, payload });
  if (!issueUrl) return;
  window.open(issueUrl, '_blank', 'noopener,noreferrer');
  closeModal();
}

function onRemoveProduct(product) {
  const ok = window.confirm(`Deseja abrir uma issue para remover "${product.name}"?`);
  if (!ok) return;
  const payload = {
    action: 'remove',
    product_id: product.id,
    name: product.name,
  };
  const issueUrl = buildIssueUrl({
    title: `[MANAGE PRODUCT] REMOVE ${product.name}`,
    payload,
  });
  if (!issueUrl) return;
  window.open(issueUrl, '_blank', 'noopener,noreferrer');
}

function bindTableActions() {
  els.tbody?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action][data-id]');
    if (!button) return;
    const product = state.products.find((item) => item.id === button.dataset.id);
    if (!product) return;
    if (button.dataset.action === 'edit') openModal('edit', product);
    if (button.dataset.action === 'remove') onRemoveProduct(product);
  });
}

async function init() {
  try {
    state.products = await fetchProducts();
    state.categories = [...new Set(state.products.map((item) => normalizeKey(item.category, 'sem-categoria')))].sort();
    setCategoryFilterOptions();
    renderCategorySuggestions();
    renderStats();
    renderProductsTable();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (els.tbody) els.tbody.innerHTML = `<tr><td colspan="6">Erro: ${escapeHtml(message)}</td></tr>`;
  }

  if (els.repoInput && !els.repoInput.value.trim()) {
    els.repoInput.value = detectDefaultRepo();
  }
}

els.openAdd?.addEventListener('click', () => openModal('add', null));
document.querySelectorAll('[data-open-manage-add]').forEach((button) => {
  button.addEventListener('click', () => openModal('add', null));
});
els.closeModal?.addEventListener('click', closeModal);
els.modal?.addEventListener('click', (event) => {
  if (event.target.dataset.closeModal === 'true') closeModal();
});
els.form?.addEventListener('submit', onSubmitManageForm);
els.categoryFilter?.addEventListener('change', renderProductsTable);
els.activeFilter?.addEventListener('change', renderProductsTable);
els.searchInput?.addEventListener('input', renderProductsTable);
els.fieldCategory?.addEventListener('input', updateCategoryHint);
bindTableActions();

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeModal();
});

init();
