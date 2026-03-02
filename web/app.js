const RUNS_LIMIT = 30;

const els = {
  generatedAt: document.getElementById('generated-at'),
  summaryGrid: document.getElementById('summary-grid'),
  tbody: document.getElementById('products-tbody'),
  select: document.getElementById('product-select'),
  canvas: document.getElementById('history-chart'),
  openModal: document.getElementById('open-add-modal'),
  closeModal: document.getElementById('close-add-modal'),
  modal: document.getElementById('add-modal'),
  addForm: document.getElementById('add-product-form'),
};

const state = {
  latest: null,
  runs: [],
  historyByProduct: new Map(),
  chart: null,
};

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

function renderSummary(latest) {
  const summary = latest?.summary || {};
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
    .map(([k, v]) => `<div class="summary-item"><span class="k">${k}</span><span class="v">${v}</span></div>`)
    .join('');

  els.generatedAt.textContent = latest?.generated_at
    ? `Atualizado: ${formatDateTime(latest.generated_at)}`
    : 'Sem execucao registrada';
}

function renderTable(latest) {
  const successes = Array.isArray(latest?.items) ? latest.items : [];
  const failures = Array.isArray(latest?.failures) ? latest.failures : [];

  const rows = [];

  for (const item of successes) {
    rows.push({
      name: item.name,
      price: item.price,
      unit_price: item.unit_price,
      engine: item.engine_used,
      fetched_at: item.fetched_at,
      status: 'ok',
    });
  }

  for (const item of failures) {
    rows.push({
      name: item.name,
      price: null,
      unit_price: null,
      engine: item.attempts?.[item.attempts.length - 1]?.engine || '-',
      fetched_at: item.fetched_at,
      status: 'failed',
    });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));

  if (rows.length === 0) {
    els.tbody.innerHTML = '<tr><td colspan="6">Nenhum dado disponivel.</td></tr>';
    return;
  }

  els.tbody.innerHTML = rows
    .map((row) => {
      const statusClass = row.status === 'ok' ? 'status-ok' : 'status-failed';
      return `
        <tr>
          <td>${row.name}</td>
          <td>${formatMoney(row.price)}</td>
          <td>${formatMoney(row.unit_price)}</td>
          <td>${row.engine || '-'}</td>
          <td>${formatDateTime(row.fetched_at)}</td>
          <td><span class="status-pill ${statusClass}">${row.status}</span></td>
        </tr>
      `;
    })
    .join('');
}

function buildHistoryMap(runs) {
  const history = new Map();

  for (const run of runs) {
    const dateLabel = run.run_date || (run.generated_at ? run.generated_at.slice(0, 10) : '-');
    const results = Array.isArray(run.results) ? run.results : [];

    for (const item of results) {
      if (!history.has(item.product_id)) {
        history.set(item.product_id, {
          product_id: item.product_id,
          name: item.name,
          points: [],
        });
      }

      history.get(item.product_id).points.push({
        date: dateLabel,
        price: Number(item.price),
      });
    }
  }

  for (const value of history.values()) {
    value.points.sort((a, b) => a.date.localeCompare(b.date));
  }

  return history;
}

function renderProductSelect(historyByProduct) {
  const options = [...historyByProduct.values()].sort((a, b) => a.name.localeCompare(b.name));

  if (options.length === 0) {
    els.select.innerHTML = '<option value="">Sem historico</option>';
    renderChart(null);
    return;
  }

  els.select.innerHTML = options
    .map((item, index) => `<option value="${item.product_id}" ${index === 0 ? 'selected' : ''}>${item.name}</option>`)
    .join('');

  renderChart(options[0].product_id);
}

function renderChart(productId) {
  if (state.chart) {
    state.chart.destroy();
    state.chart = null;
  }

  const history = productId ? state.historyByProduct.get(productId) : null;

  const labels = history?.points.map((p) => p.date) || [];
  const values = history?.points.map((p) => p.price) || [];

  state.chart = new window.Chart(els.canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: history?.name ? `Preco - ${history.name}` : 'Sem dados',
          data: values,
          borderColor: '#0f7a62',
          backgroundColor: '#0f7a62',
        },
      ],
    },
    options: {
      responsive: true,
    },
  });
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
  const json = JSON.stringify(payload, null, 2);
  return [
    '## Add Product Request',
    '',
    '```json',
    json,
    '```',
    '',
    'Criado via dashboard estatico.',
  ].join('\n');
}

function parseRepoInput(value) {
  const cleaned = String(value || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/^\/+|\/+$/g, '');
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

  const title = `[ADD PRODUCT] ${name}`;
  const body = buildIssueBody(payload);
  const issueUrl = `https://github.com/${repoValue}/issues/new?labels=add-product&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;

  window.open(issueUrl, '_blank', 'noopener,noreferrer');
  closeModal();
}

async function init() {
  try {
    const [latest, runsIndex] = await Promise.all([
      fetchJson('../data/latest.json'),
      fetchJson('../data/runs/index.json').catch(() => ({ files: [] })),
    ]);

    const runFiles = (runsIndex.files || []).slice(0, RUNS_LIMIT);
    const runPayloads = await Promise.all(
      runFiles.map((file) => fetchJson(`../data/runs/${file}`).catch(() => null)),
    );

    state.latest = latest;
    state.runs = runPayloads.filter(Boolean);
    state.historyByProduct = buildHistoryMap(state.runs);

    renderSummary(state.latest);
    renderTable(state.latest);
    renderProductSelect(state.historyByProduct);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    els.summaryGrid.innerHTML = `<div class="summary-item"><span class="k">Erro</span><span class="v">${message}</span></div>`;
    els.tbody.innerHTML = '<tr><td colspan="6">Falha ao carregar dados.</td></tr>';
    renderChart(null);
  }
}

els.select.addEventListener('change', (event) => {
  renderChart(event.target.value);
});

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
