const ALL = '__all__';

const els = {
  repoInput: document.getElementById('repo-input'),
  categoryFilter: document.getElementById('category-filter'),
  searchInput: document.getElementById('search-input'),
  tbody: document.getElementById('products-manage-tbody'),
  openAdd: document.getElementById('open-add'),
  modal: document.getElementById('manage-modal'),
  closeModal: document.getElementById('close-manage-modal'),
  form: document.getElementById('manage-form'),
  fieldId: document.getElementById('mf-product-id'),
  fieldName: document.getElementById('mf-name'),
  fieldUrl: document.getElementById('mf-url'),
  fieldCategory: document.getElementById('mf-category'),
  fieldUnits: document.getElementById('mf-units'),
  fieldActive: document.getElementById('mf-active'),
  fieldPriceCss: document.getElementById('mf-price-css'),
  fieldJsonld: document.getElementById('mf-jsonld'),
  fieldRegex: document.getElementById('mf-regex'),
  fieldNotes: document.getElementById('mf-notes'),
  modalTitle: document.getElementById('manage-modal-title'),
};

const state = {
  products: [],
  categories: [],
  mode: 'add',
};

function splitLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function detectDefaultRepo() {
  const host = window.location.hostname;
  const pathParts = window.location.pathname.split('/').filter(Boolean);

  if (host.endsWith('.github.io')) {
    const owner = host.split('.')[0];
    const repo = pathParts[0] || '';
    if (owner && repo) return `${owner}/${repo}`;
  }

  if (pathParts.length >= 2) {
    return `${pathParts[0]}/${pathParts[1]}`;
  }

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

function formatCategoryLabel(value) {
  const raw = String(value || 'sem-categoria').trim() || 'sem-categoria';
  return raw.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function fetchProducts() {
  const response = await fetch('../data/products.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Falha ao carregar products.json (${response.status})`);
  }
  const products = await response.json();
  return Array.isArray(products) ? products : [];
}

function setCategoryFilterOptions(categories) {
  els.categoryFilter.innerHTML = [
    `<option value="${ALL}">Todas</option>`,
    ...categories.map((category) => `<option value="${category}">${formatCategoryLabel(category)}</option>`),
  ].join('');
}

function currentFilteredProducts() {
  const category = els.categoryFilter.value || ALL;
  const query = String(els.searchInput.value || '').trim().toLowerCase();

  return state.products.filter((product) => {
    const productCategory = String(product.category || 'sem-categoria');
    const categoryOk = category === ALL || productCategory === category;
    if (!categoryOk) return false;

    if (!query) return true;
    return (
      String(product.name || '').toLowerCase().includes(query)
      || String(product.url || '').toLowerCase().includes(query)
      || String(product.id || '').toLowerCase().includes(query)
    );
  });
}

function renderProductsTable() {
  const rows = currentFilteredProducts().sort((a, b) => {
    const catA = String(a.category || 'sem-categoria');
    const catB = String(b.category || 'sem-categoria');
    if (catA !== catB) return catA.localeCompare(catB);
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  if (rows.length === 0) {
    els.tbody.innerHTML = '<tr><td colspan="5">Nenhum produto para o filtro atual.</td></tr>';
    return;
  }

  const html = [];
  let lastCategory = '';

  for (const product of rows) {
    const category = String(product.category || 'sem-categoria');
    if (category !== lastCategory) {
      html.push(`<tr class="category-group-row"><td colspan="5">${formatCategoryLabel(category)}</td></tr>`);
      lastCategory = category;
    }

    html.push(`
      <tr>
        <td>${product.name}</td>
        <td>${formatCategoryLabel(category)}</td>
        <td><a href="${product.url}" target="_blank" rel="noopener noreferrer">${product.url}</a></td>
        <td>${product.is_active ? 'true' : 'false'}</td>
        <td class="actions-cell">
          <button type="button" class="btn btn-ghost" data-action="edit" data-id="${product.id}">Editar</button>
          <button type="button" class="btn btn-danger" data-action="remove" data-id="${product.id}">Remover</button>
        </td>
      </tr>
    `);
  }

  els.tbody.innerHTML = html.join('');
}

function openModal(mode, product = null) {
  state.mode = mode;
  els.modal.setAttribute('aria-hidden', 'false');
  els.modalTitle.textContent = mode === 'add' ? 'Novo Produto' : 'Editar Produto';

  if (!product) {
    els.fieldId.value = '';
    els.fieldName.value = '';
    els.fieldUrl.value = '';
    els.fieldCategory.value = '';
    els.fieldUnits.value = '';
    els.fieldActive.value = 'true';
    els.fieldPriceCss.value = '';
    els.fieldJsonld.value = '';
    els.fieldRegex.value = '';
    els.fieldNotes.value = '';
    return;
  }

  els.fieldId.value = product.id || '';
  els.fieldName.value = product.name || '';
  els.fieldUrl.value = product.url || '';
  els.fieldCategory.value = product.category || '';
  els.fieldUnits.value = product.units_per_package || '';
  els.fieldActive.value = product.is_active ? 'true' : 'false';
  els.fieldPriceCss.value = (product.selectors?.price_css || []).join('\n');
  els.fieldJsonld.value = (product.selectors?.jsonld_paths || []).join('\n');
  els.fieldRegex.value = (product.selectors?.regex_hints || []).join('\n');
  els.fieldNotes.value = product.notes || '';
}

function closeModal() {
  els.modal.setAttribute('aria-hidden', 'true');
}

function buildIssueUrl({ title, payload }) {
  const repo = parseRepoInput(els.repoInput.value);
  if (!repo) {
    alert('Informe o repositorio no formato owner/repo.');
    return null;
  }

  const body = [
    '## Manage Product Request',
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '',
    'Criado via pagina de gerenciamento.',
  ].join('\n');

  return `https://github.com/${repo}/issues/new?labels=manage-product&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

function onSubmitManageForm(event) {
  event.preventDefault();

  const payload = {
    action: state.mode === 'add' ? 'add' : 'edit',
    ...(state.mode === 'edit' ? { product_id: els.fieldId.value.trim() } : {}),
    name: els.fieldName.value.trim(),
    url: els.fieldUrl.value.trim(),
    category: els.fieldCategory.value.trim(),
    units_per_package: els.fieldUnits.value.trim() || null,
    is_active: els.fieldActive.value === 'true',
    selectors: {
      price_css: splitLines(els.fieldPriceCss.value),
      jsonld_paths: splitLines(els.fieldJsonld.value),
      regex_hints: splitLines(els.fieldRegex.value),
    },
    notes: els.fieldNotes.value.trim(),
  };

  if (!payload.name || !payload.url) {
    alert('Nome e URL sao obrigatorios.');
    return;
  }

  if (payload.selectors.price_css.length === 0) delete payload.selectors.price_css;
  if (payload.selectors.jsonld_paths.length === 0) delete payload.selectors.jsonld_paths;
  if (payload.selectors.regex_hints.length === 0) delete payload.selectors.regex_hints;
  if (Object.keys(payload.selectors).length === 0) delete payload.selectors;
  if (!payload.category) delete payload.category;
  if (!payload.notes) delete payload.notes;

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
    url: product.url,
  };

  const issueUrl = buildIssueUrl({
    title: `[MANAGE PRODUCT] REMOVE ${product.name}`,
    payload,
  });
  if (!issueUrl) return;

  window.open(issueUrl, '_blank', 'noopener,noreferrer');
}

function bindTableActions() {
  els.tbody.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action][data-id]');
    if (!button) return;

    const id = button.dataset.id;
    const action = button.dataset.action;
    const product = state.products.find((item) => item.id === id);
    if (!product) return;

    if (action === 'edit') {
      openModal('edit', product);
    } else if (action === 'remove') {
      onRemoveProduct(product);
    }
  });
}

async function init() {
  try {
    state.products = await fetchProducts();
    state.categories = [...new Set(state.products.map((item) => String(item.category || 'sem-categoria')))].sort();
    setCategoryFilterOptions(state.categories);
    renderProductsTable();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    els.tbody.innerHTML = `<tr><td colspan="5">Erro: ${message}</td></tr>`;
  }

  if (!els.repoInput.value.trim()) {
    els.repoInput.value = detectDefaultRepo();
  }
}

els.openAdd.addEventListener('click', () => openModal('add', null));
els.closeModal.addEventListener('click', closeModal);
els.modal.addEventListener('click', (event) => {
  if (event.target.dataset.closeModal === 'true') {
    closeModal();
  }
});
els.form.addEventListener('submit', onSubmitManageForm);
els.categoryFilter.addEventListener('change', renderProductsTable);
els.searchInput.addEventListener('input', renderProductsTable);
bindTableActions();

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && els.modal.getAttribute('aria-hidden') === 'false') {
    closeModal();
  }
});

init();
