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
  fieldUrl: document.getElementById('mf-url'),
  fieldCategory: document.getElementById('mf-category'),
  fieldCategoryHint: document.getElementById('mf-category-hint'),
  fieldCategoryList: document.getElementById('mf-category-list'),
  fieldComparisonKey: document.getElementById('mf-comparison-key'),
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
  colorsByCategory: new Map(),
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

function normalizeCategory(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'sem-categoria';
}

function normalizeLooseKey(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildCategoryColors(categories) {
  state.colorsByCategory = new Map();
  categories.forEach((category, index) => {
    state.colorsByCategory.set(category, CATEGORY_PALETTE[index % CATEGORY_PALETTE.length]);
  });
}

function colorForCategory(category) {
  return state.colorsByCategory.get(normalizeCategory(category)) || '#0f7a62';
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

function renderCategoryInputSuggestions() {
  if (!els.fieldCategoryList) return;
  els.fieldCategoryList.innerHTML = state.categories
    .map((category) => `<option value="${category}"></option>`)
    .join('');
}

function updateCategoryFieldHint({ applyMatch = false } = {}) {
  if (!els.fieldCategory) return '';

  const typed = els.fieldCategory.value.trim();
  if (!typed) {
    if (els.fieldCategoryHint) {
      els.fieldCategoryHint.textContent = '';
      els.fieldCategoryHint.dataset.state = '';
    }
    return '';
  }

  const match = findCategoryMatch(typed);
  if (!match) {
    if (els.fieldCategoryHint) {
      els.fieldCategoryHint.textContent = `Nova categoria: "${typed}".`;
      els.fieldCategoryHint.dataset.state = 'new';
    }
    return typed;
  }

  if (applyMatch) {
    els.fieldCategory.value = match.category;
  }

  if (els.fieldCategoryHint) {
    if (match.kind === 'exact') {
      els.fieldCategoryHint.textContent = `Categoria existente: "${match.category}".`;
    } else {
      els.fieldCategoryHint.textContent = `Categoria parecida encontrada: "${match.category}".`;
    }
    els.fieldCategoryHint.dataset.state = 'ok';
  }

  return applyMatch ? els.fieldCategory.value.trim() : typed;
}

function containsHtmlSnippet(lines) {
  return lines.some((line) => /<[^>]+>/.test(String(line || '')));
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

  throw new Error('Nao foi possivel localizar products.json em ./data ou ../data.');
}

async function fetchProducts() {
  const dataRoot = await detectDataRoot();
  const response = await fetch(`${dataRoot}/products.json`, { cache: 'no-store' });
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

function renderStats() {
  const total = state.products.length;
  const active = state.products.filter((product) => product.is_active).length;
  const comparisonGroups = new Set(
    state.products
      .map((product) => String(product.comparison_key || '').trim())
      .filter(Boolean),
  ).size;

  els.stats.innerHTML = [
    `<span class="stat-pill"><strong>${total}</strong> produtos</span>`,
    `<span class="stat-pill"><strong>${active}</strong> ativos</span>`,
    `<span class="stat-pill"><strong>${state.categories.length}</strong> categorias</span>`,
    `<span class="stat-pill"><strong>${comparisonGroups}</strong> grupos comparativos</span>`,
  ].join('');
}

function currentFilteredProducts() {
  const category = els.categoryFilter.value || ALL;
  const activeFilter = els.activeFilter.value || ALL;
  const query = String(els.searchInput.value || '').trim().toLowerCase();

  return state.products.filter((product) => {
    const productCategory = normalizeCategory(product.category);
    const categoryOk = category === ALL || productCategory === category;
    if (!categoryOk) return false;

    if (activeFilter === 'active' && !product.is_active) return false;
    if (activeFilter === 'inactive' && product.is_active) return false;

    if (!query) return true;
    const site = formatSiteLabel(siteLabelFromUrl(product.url)).toLowerCase();
    return (
      String(product.name || '').toLowerCase().includes(query)
      || String(product.url || '').toLowerCase().includes(query)
      || String(product.id || '').toLowerCase().includes(query)
      || String(product.comparison_key || '').toLowerCase().includes(query)
      || site.includes(query)
    );
  });
}

function renderProductsTable() {
  const rows = currentFilteredProducts().sort((a, b) => {
    const catA = normalizeCategory(a.category);
    const catB = normalizeCategory(b.category);
    if (catA !== catB) return catA.localeCompare(catB);
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  if (rows.length === 0) {
    els.tbody.innerHTML = '<tr><td colspan="6">Nenhum produto para o filtro atual.</td></tr>';
    return;
  }

  const html = [];
  let lastCategory = '';

  for (const product of rows) {
    const category = normalizeCategory(product.category);
    const siteLabel = formatSiteLabel(siteLabelFromUrl(product.url));
    if (category !== lastCategory) {
      html.push(`
        <tr class="category-group-row" style="--category-color:${colorForCategory(category)}">
          <td colspan="6">
            <span class="category-row-dot"></span>
            ${formatCategoryLabel(category)}
          </td>
        </tr>
      `);
      lastCategory = category;
    }

    html.push(`
      <tr>
        <td>
          <div class="product-name-cell">
            <strong>${product.name}</strong>
            <span class="product-meta">
              <a href="${product.url}" target="_blank" rel="noopener noreferrer">${product.url}</a>
            </span>
          </div>
        </td>
        <td><span class="site-pill">${siteLabel}</span></td>
        <td>${formatCategoryLabel(category)}</td>
        <td>${product.comparison_key ? `<span class="site-pill">${product.comparison_key}</span>` : '-'}</td>
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
  renderCategoryInputSuggestions();

  if (!product) {
    els.fieldId.value = '';
    els.fieldName.value = '';
    els.fieldUrl.value = '';
    els.fieldCategory.value = '';
    els.fieldComparisonKey.value = '';
    els.fieldUnits.value = '';
    els.fieldActive.value = 'true';
    els.fieldPriceCss.value = '';
    els.fieldJsonld.value = '';
    els.fieldRegex.value = '';
    els.fieldNotes.value = '';
    updateCategoryFieldHint();
    return;
  }

  els.fieldId.value = product.id || '';
  els.fieldName.value = product.name || '';
  els.fieldUrl.value = product.url || '';
  els.fieldCategory.value = normalizeCategory(product.category);
  els.fieldComparisonKey.value = product.comparison_key || '';
  els.fieldUnits.value = product.units_per_package || '';
  els.fieldActive.value = product.is_active ? 'true' : 'false';
  els.fieldPriceCss.value = (product.selectors?.price_css || []).join('\n');
  els.fieldJsonld.value = (product.selectors?.jsonld_paths || []).join('\n');
  els.fieldRegex.value = (product.selectors?.regex_hints || []).join('\n');
  els.fieldNotes.value = product.notes || '';
  updateCategoryFieldHint({ applyMatch: true });
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

  const categoryRaw = updateCategoryFieldHint({ applyMatch: true });
  const category = categoryRaw ? normalizeCategory(categoryRaw) : '';
  const priceCss = splitLines(els.fieldPriceCss.value);
  const jsonldPaths = splitLines(els.fieldJsonld.value);
  const regexHints = splitLines(els.fieldRegex.value);

  if (containsHtmlSnippet(priceCss)) {
    alert('No campo Seletores CSS, informe apenas seletores (ex: .a-price .a-offscreen), nao HTML copiado.');
    return;
  }

  const payload = {
    action: state.mode === 'add' ? 'add' : 'edit',
    ...(state.mode === 'edit' ? { product_id: els.fieldId.value.trim() } : {}),
    name: els.fieldName.value.trim(),
    url: els.fieldUrl.value.trim(),
    category,
    comparison_key: normalizeLooseKey(els.fieldComparisonKey.value.trim()),
    units_per_package: els.fieldUnits.value.trim() || null,
    is_active: els.fieldActive.value === 'true',
    selectors: {
      price_css: priceCss,
      jsonld_paths: jsonldPaths,
      regex_hints: regexHints,
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
  if (!payload.comparison_key) delete payload.comparison_key;
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
    state.categories = [...new Set(state.products.map((item) => normalizeCategory(item.category)))].sort();
    buildCategoryColors(state.categories);
    setCategoryFilterOptions(state.categories);
    renderCategoryInputSuggestions();
    renderStats();
    renderProductsTable();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    els.tbody.innerHTML = `<tr><td colspan="6">Erro: ${message}</td></tr>`;
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
els.activeFilter.addEventListener('change', renderProductsTable);
els.searchInput.addEventListener('input', renderProductsTable);
els.fieldCategory.addEventListener('input', () => updateCategoryFieldHint());
els.fieldCategory.addEventListener('blur', () => updateCategoryFieldHint({ applyMatch: true }));
bindTableActions();

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && els.modal.getAttribute('aria-hidden') === 'false') {
    closeModal();
  }
});

init();
