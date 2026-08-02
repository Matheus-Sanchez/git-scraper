const ALL = '__all__';

export function positiveNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

export function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizeCategory(value) {
  return normalizeText(value).replace(/\s+/g, '-') || 'sem-categoria';
}

export function storeLabel(value, url = '') {
  const explicit = String(value || '').trim();
  if (explicit) return explicit.replace(/\b\w/g, (letter) => letter.toUpperCase());
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    const core = hostname.split('.')[0];
    return core.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  } catch {
    return 'Sem loja';
  }
}

function dateFromRun(run, fallback = '') {
  const candidate = run?.run_date || run?.generated_at || run?.run_id || fallback;
  const match = String(candidate || '').match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

function runIdFromPayload(run, fallbackFile = '') {
  return String(run?.run_id || fallbackFile || run?.generated_at || run?.run_date || '')
    .replace(/\.json$/i, '');
}

function normalizeRecord(record, run) {
  const productId = String(record?.product_id || record?.intent_id || '');
  const status = record?.status === 'carried_forward' || record?.engine_used === 'carry_forward'
    ? 'carried_forward'
    : 'fresh_success';
  return {
    ...record,
    product_id: productId,
    intent_id: String(record?.intent_id || productId),
    price: positiveNumber(record?.price),
    unit_price: positiveNumber(record?.unit_price),
    normalized_quantity: positiveNumber(record?.normalized_quantity),
    store_label: storeLabel(record?.store || record?.store_id, record?.url),
    observation_status: status,
    run_id: run.run_id,
    run_date: run.run_date,
    generated_at: record?.fetched_at || run.generated_at || null,
  };
}

function normalizeOffer(offer, run) {
  const normalized = normalizeRecord(offer, run);
  return {
    ...normalized,
    rejected: Boolean(offer?.rejected),
    rejected_reasons: Array.isArray(offer?.rejected_reasons) ? offer.rejected_reasons : [],
  };
}

export function normalizeRunPayload(payload, fallbackFile = '') {
  if (!payload || typeof payload !== 'object') return null;
  const runId = runIdFromPayload(payload, fallbackFile);
  const runDate = dateFromRun(payload, fallbackFile);
  if (!runId || !runDate) return null;

  const shell = {
    ...payload,
    run_id: runId,
    run_date: runDate,
    run_file: payload.run_file || fallbackFile || `${runId}.json`,
    generated_at: payload.generated_at || `${runDate}T00:00:00.000Z`,
  };
  const rawResults = Array.isArray(payload.results)
    ? payload.results
    : (Array.isArray(payload.items) ? payload.items : []);

  return {
    ...shell,
    results: rawResults.map((record) => normalizeRecord(record, shell)).filter((record) => record.product_id),
    offers: (Array.isArray(payload.offers) ? payload.offers : [])
      .map((offer) => normalizeOffer(offer, shell))
      .filter((offer) => offer.product_id),
    failures: (Array.isArray(payload.failures) ? payload.failures : []).map((failure) => ({
      ...failure,
      product_id: String(failure?.product_id || failure?.intent_id || ''),
      intent_id: String(failure?.intent_id || failure?.product_id || ''),
      store_label: storeLabel(failure?.store || failure?.store_id, failure?.url),
      observation_status: 'hard_failure',
      run_id: runId,
      run_date: runDate,
    })),
  };
}

export function normalizeRuns(payloads) {
  const byId = new Map();
  for (const entry of payloads || []) {
    const payload = entry?.payload || entry;
    const fallbackFile = entry?.file || payload?.run_file || '';
    const normalized = normalizeRunPayload(payload, fallbackFile);
    if (normalized) byId.set(normalized.run_id, normalized);
  }
  return [...byId.values()].sort((left, right) => {
    const leftKey = String(left.generated_at || left.run_id);
    const rightKey = String(right.generated_at || right.run_id);
    return leftKey.localeCompare(rightKey);
  });
}

export function selectRecentRunFiles(manifest, runLimit = 30) {
  const limit = Math.max(1, Number.parseInt(String(runLimit), 10) || 1);
  const entries = Array.isArray(manifest?.runs) ? manifest.runs : [];
  if (entries.length === 0) {
    return [...new Set((Array.isArray(manifest?.files) ? manifest.files : []).filter(Boolean))]
      .slice(0, limit);
  }

  const sorted = entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const leftKey = String(left.entry?.generated_at || left.entry?.run_id || left.entry?.run_date || left.entry?.run_file || '');
      const rightKey = String(right.entry?.generated_at || right.entry?.run_id || right.entry?.run_date || right.entry?.run_file || '');
      const recency = rightKey.localeCompare(leftKey);
      if (recency !== 0) return recency;
      const runIdOrder = String(right.entry?.run_id || '').localeCompare(String(left.entry?.run_id || ''));
      if (runIdOrder !== 0) return runIdOrder;
      const fileOrder = String(right.entry?.run_file || '').localeCompare(String(left.entry?.run_file || ''));
      return fileOrder || left.index - right.index;
    });
  const files = [];
  for (const { entry } of sorted) {
    const file = entry?.run_file || (entry?.run_id ? `${entry.run_id}.json` : '');
    if (!file || files.includes(file)) continue;
    files.push(file);
    if (files.length >= limit) break;
  }
  return files;
}

function manifestEntrySortKey(entry) {
  return String(entry?.generated_at || entry?.run_id || entry?.run_date || entry?.run_file || '');
}

export function selectLatestManifestRun(manifest) {
  const entries = Array.isArray(manifest?.runs) ? manifest.runs.filter(Boolean) : [];
  return [...entries].sort((left, right) => (
    manifestEntrySortKey(right).localeCompare(manifestEntrySortKey(left))
  ))[0] || null;
}

function errorPayloadForRun(fatalErrors, runId) {
  if (!fatalErrors || !runId) return null;
  if (fatalErrors instanceof Map) return fatalErrors.get(runId) || null;
  return fatalErrors[runId] || null;
}

function fatalFailureDetail(errorPayload) {
  return String(
    errorPayload?.error_detail
    || errorPayload?.message
    || errorPayload?.error_code
    || 'A execução terminou antes de concluir a coleta.',
  );
}

function synthesizeOperationalFailures(run, productsById, errorPayload, code = 'fatal_run') {
  const covered = new Set([
    ...run.results.map((record) => record.product_id),
    ...run.failures.map((record) => record.product_id),
  ]);
  const detail = fatalFailureDetail(errorPayload);
  for (const product of productsById.values()) {
    if (product.legacy || product.is_active === false || covered.has(product.id)) continue;
    run.failures.push({
      product_id: product.id,
      intent_id: product.id,
      name: product.name || product.id,
      store_label: 'Sem loja',
      observation_status: 'hard_failure',
      error_code: errorPayload?.error_code || code,
      error_detail: detail,
      run_id: run.run_id,
      run_date: run.run_date,
      synthetic_operational_failure: true,
    });
  }
}

function annotateManifestState(runs, productsById, manifest, fatalErrors) {
  const entries = new Map((Array.isArray(manifest?.runs) ? manifest.runs : [])
    .filter((entry) => entry?.run_id)
    .map((entry) => [String(entry.run_id), entry]));
  for (const run of runs) {
    const entry = entries.get(run.run_id);
    run.manifest_status = entry?.status || null;
    const operationalError = errorPayloadForRun(fatalErrors, run.run_id);
    if (operationalError) run.operational_error = operationalError;
    if (entry?.status === 'fatal') {
      synthesizeOperationalFailures(run, productsById, operationalError);
    }
  }
}

function inferredRunStatus(run) {
  if (!run) return 'data_error';
  if (run.manifest_status) return run.manifest_status;
  return Number(run.summary?.failure_count || run.failures?.length || 0) > 0 ? 'partial' : 'success';
}

export function resolveOperationalState({ manifest, runs = [], latest = null, products = [], fatalErrors = null } = {}) {
  const entry = selectLatestManifestRun(manifest);
  const normalizedLatest = normalizeRunPayload(latest, `${latest?.run_id || 'latest'}.json`);
  const expectedRunId = String(entry?.run_id || '');
  let run = expectedRunId
    ? runs.find((candidate) => candidate.run_id === expectedRunId) || null
    : (normalizedLatest || runs.at(-1) || null);
  let available = Boolean(run);
  let status = entry?.status || inferredRunStatus(run);
  const operationalError = errorPayloadForRun(fatalErrors, expectedRunId) || run?.operational_error || null;

  if (!run && entry) {
    run = normalizeRunPayload({
      run_id: entry.run_id,
      run_date: entry.run_date,
      generated_at: entry.generated_at || `${entry.run_date}T00:00:00.000Z`,
      summary: {
        total_products: products.filter((product) => product.is_active !== false).length,
        success_count: 0,
        failure_count: products.filter((product) => product.is_active !== false).length,
        engines: operationalError?.engine_summary || {},
      },
      results: [],
      offers: [],
      failures: [],
    }, entry.run_file || `${entry.run_id}.json`);
    const productsById = new Map(products.map((product) => [product.id, { ...product, legacy: false }]));
    synthesizeOperationalFailures(run, productsById, operationalError, 'run_payload_unavailable');
    run.manifest_status = entry.status || null;
    if (operationalError) run.operational_error = operationalError;
    status = 'data_error';
    available = false;
  }

  return {
    entry,
    run,
    status,
    available,
    is_fatal: status === 'fatal',
    latest_is_stale: Boolean(entry && normalizedLatest?.run_id !== entry.run_id),
    latest_run_id: normalizedLatest?.run_id || null,
    operational_error: operationalError,
  };
}

export function median(values) {
  const sorted = (values || [])
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function valuesEqual(left, right) {
  if (typeof right === 'number') return Number(left) === right;
  if (typeof right === 'boolean') {
    if (typeof left === 'boolean') return left === right;
    if (String(left).toLowerCase() === 'true') return right === true;
    if (String(left).toLowerCase() === 'false') return right === false;
    return false;
  }
  return normalizeText(left) === normalizeText(right);
}

function includesNormalizedPhrase(haystack, needle) {
  const normalizedHaystack = ` ${normalizeText(haystack)} `;
  const normalizedNeedle = normalizeText(needle);
  return Boolean(normalizedNeedle) && normalizedHaystack.includes(` ${normalizedNeedle} `);
}

function qualityReasons(record, product) {
  const reasons = [];
  if (!positiveNumber(record?.price)) reasons.push('preco_invalido');
  if (record?.rejected) {
    const rejectedReasons = Array.isArray(record.rejected_reasons) ? record.rejected_reasons : [];
    reasons.push(...(rejectedReasons.length ? rejectedReasons : ['oferta_rejeitada']));
  }
  if (record?.suspicious || record?.is_suspicious) reasons.push('marcado_como_suspeito');
  if (Array.isArray(record?.quality_flags)) reasons.push(...record.quality_flags);

  const title = normalizeText(record?.title || record?.name);
  const requiredTerms = (product?.required_terms || []).map(normalizeText).filter(Boolean);
  if (title && requiredTerms.some((term) => !includesNormalizedPhrase(title, term))) reasons.push('termo_obrigatorio_ausente');

  const excludedTerms = (product?.excluded_terms || []).map(normalizeText).filter(Boolean);
  if (title && excludedTerms.some((term) => includesNormalizedPhrase(title, term))) {
    reasons.push('termo_excluido_presente');
  }

  const accessoryPhrases = [
    'suporte para',
    'suporte stand',
    'stand de mesa',
    'capa para',
    'case para',
    'pelicula para',
    'adaptador para',
    'cabo para',
    'refil para',
  ];
  if (
    title
    && product?.required_attributes?.is_accessory === false
    && accessoryPhrases.some((phrase) => includesNormalizedPhrase(title, phrase))
  ) {
    reasons.push('possivel_acessorio');
  }

  const requirements = product?.required_attributes || {};
  for (const [key, expected] of Object.entries(requirements)) {
    const actual = record?.attributes?.[key];
    if (actual !== undefined && actual !== null && !valuesEqual(actual, expected)) {
      reasons.push(`atributo_${key}_incompativel`);
    }
  }
  return [...new Set(reasons.filter(Boolean))];
}

function unknownQualityReasons(record, product) {
  const reasons = [];
  for (const key of Object.keys(product?.required_attributes || {})) {
    if (record?.attributes?.[key] === undefined || record?.attributes?.[key] === null) {
      reasons.push(`atributo_${key}_nao_informado`);
    }
  }
  return reasons;
}

function markQuality(runs, productsById) {
  const freshPricesByProduct = new Map();
  for (const run of runs) {
    for (const record of run.results) {
      const product = productsById.get(record.product_id);
      record.quality_reasons = qualityReasons(record, product);
      record.quality_unknown_reasons = unknownQualityReasons(record, product);
      record.unverified = record.quality_unknown_reasons.length > 0;
      if (
        record.quality_reasons.length === 0
        && !record.unverified
        && record.observation_status === 'fresh_success'
        && record.price
      ) {
        const prices = freshPricesByProduct.get(record.product_id) || [];
        prices.push(record.price);
        freshPricesByProduct.set(record.product_id, prices);
      }
    }
    for (const offer of run.offers) {
      offer.quality_reasons = qualityReasons(offer, productsById.get(offer.product_id));
      offer.quality_unknown_reasons = unknownQualityReasons(offer, productsById.get(offer.product_id));
      offer.unverified = offer.quality_unknown_reasons.length > 0;
    }
  }

  const robustBaselines = new Map();
  for (const [productId, prices] of freshPricesByProduct) {
    if (prices.length < 3) continue;
    const logs = prices.map((price) => Math.log(price));
    const center = median(logs);
    const mad = median(logs.map((value) => Math.abs(value - center)));
    robustBaselines.set(productId, {
      price: Math.exp(center),
      logCenter: center,
      logMad: mad || 0,
    });
  }

  for (const run of runs) {
    for (const record of run.results) {
      const baseline = robustBaselines.get(record.product_id);
      if (baseline && record.price && record.quality_reasons.length === 0) {
        const ratio = record.price / baseline.price;
        const logDistance = Math.abs(Math.log(record.price) - baseline.logCenter);
        const robustLimit = Math.max(Math.log(4), baseline.logMad * 8);
        if (ratio < 0.25 || ratio > 4 || logDistance > robustLimit) {
          record.quality_reasons.push('salto_de_preco_atipico');
        }
      }
      record.quality_reasons = [...new Set(record.quality_reasons)];
      record.suspicious = record.quality_reasons.length > 0;
    }
    for (const offer of run.offers) {
      offer.suspicious = offer.quality_reasons.length > 0;
    }
  }
}

function derivedProduct(record) {
  return {
    id: record.product_id,
    name: record.name || record.title || record.product_id,
    category: record.category || 'sem-categoria',
    is_active: false,
    legacy: true,
  };
}

function latestRecordByDate(runs, productId, date) {
  let found = null;
  for (const run of runs) {
    if (run.run_date !== date) continue;
    const candidate = run.results.find((record) => record.product_id === productId);
    const failure = run.failures.find((record) => record.product_id === productId);
    if (candidate) found = candidate;
    else if (failure) found = failure;
  }
  return found;
}

export function buildHistoryModel({ products = [], runs = [], limit = 30, manifest = null, fatalErrors = null } = {}) {
  const normalizedRuns = normalizeRuns(runs);
  const productsById = new Map(products.map((product) => [product.id, { ...product, legacy: false }]));
  for (const run of normalizedRuns) {
    for (const record of run.results) {
      if (!productsById.has(record.product_id)) productsById.set(record.product_id, derivedProduct(record));
    }
    for (const failure of run.failures) {
      if (failure.product_id && !productsById.has(failure.product_id)) {
        productsById.set(failure.product_id, derivedProduct(failure));
      }
    }
  }
  annotateManifestState(normalizedRuns, productsById, manifest, fatalErrors);
  markQuality(normalizedRuns, productsById);

  const allDates = [...new Set(normalizedRuns.map((run) => run.run_date).filter(Boolean))].sort();
  const dates = allDates.slice(-Math.max(1, limit));
  const histories = new Map();

  for (const product of productsById.values()) {
    const points = dates.map((date) => {
      const record = latestRecordByDate(normalizedRuns, product.id, date);
      if (!record) return { date, value: null, status: 'missing' };
      if (record.observation_status === 'hard_failure') {
        return {
          date,
          value: null,
          status: 'hard_failure',
          store: record.store_label,
          source: record.source || record.engine_used || '',
          title: '',
          run_id: record.run_id,
          suspicious: false,
          unverified: false,
          quality_reasons: [],
          quality_unknown_reasons: [],
          raw: record,
        };
      }
      return {
        date,
        value: record.price,
        status: record.observation_status,
        store: record.store_label,
        source: record.source || record.engine_used || '',
        title: record.title || record.name || '',
        run_id: record.run_id,
        suspicious: record.suspicious,
        unverified: record.unverified,
        quality_reasons: record.quality_reasons,
        quality_unknown_reasons: record.quality_unknown_reasons,
        raw: record,
      };
    });
    histories.set(product.id, {
      product_id: product.id,
      name: product.name || product.id,
      category: normalizeCategory(product.category),
      legacy: Boolean(product.legacy),
      product,
      points,
    });
  }

  return { runs: normalizedRuns, productsById, histories, dates, allDates };
}

function latestPointForFilters(entry, filters) {
  return [...(entry?.points || [])].reverse().find((point) => (
    point.status !== 'missing'
    && (!filters.site || filters.site === ALL || point.store === filters.site)
  )) || null;
}

function pointAllowed(point, filters) {
  if (!point || point.value === null) return false;
  if (!filters.includeSuspicious && (point.suspicious || point.unverified)) return false;
  if (filters.site && filters.site !== ALL && point.store !== filters.site) return false;
  return true;
}

function entryAllowed(entry, filters) {
  if (!entry) return false;
  if (filters.hideLegacy && entry.legacy) return false;
  if (!entry.legacy && entry.product?.is_active === false) return false;
  if (filters.category && filters.category !== ALL && entry.category !== filters.category) return false;
  const query = normalizeText(filters.query);
  if (query && !normalizeText(`${entry.name} ${entry.category} ${entry.product_id}`).includes(query)) return false;
  if (filters.status && filters.status !== ALL) {
    const latest = latestPointForFilters(entry, filters);
    if (!latest || latest.status !== filters.status) return false;
  }
  return true;
}

function indexedPoints(entry, filters) {
  const eligible = entry.points.filter((point) => pointAllowed(point, filters));
  const baselinePoint = eligible.find((point) => point.status === 'fresh_success') || eligible[0];
  const baseline = positiveNumber(baselinePoint?.value);
  return entry.points.map((point) => ({
    ...point,
    value: baseline && pointAllowed(point, filters) ? Math.round((point.value / baseline) * 10000) / 100 : null,
    original_value: point.value,
  }));
}

export function buildAllIndexSeries(model, filters = {}) {
  return [...model.histories.values()]
    .filter((entry) => entryAllowed(entry, filters))
    .map((entry) => ({
      id: entry.product_id,
      label: entry.name,
      kind: 'product-index',
      category: entry.category,
      product_id: entry.product_id,
      unit: 'index',
      points: indexedPoints(entry, filters),
    }))
    .filter((series) => series.points.some((point) => point.value !== null))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function buildCategoryIndexSeries(model, filters = {}) {
  const productSeries = buildAllIndexSeries(model, filters);
  const categories = [...new Set(productSeries.map((series) => series.category))].sort();
  return categories.map((category) => {
    const members = productSeries.filter((series) => series.category === category);
    return {
      id: `category:${category}`,
      label: category.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
      kind: 'category-index',
      category,
      unit: 'index',
      points: model.dates.map((date, index) => {
        const available = members.map((series) => series.points[index]).filter((point) => point?.value !== null);
        const value = median(available.map((point) => point.value));
        const carriedCount = available.filter((point) => point.status === 'carried_forward').length;
        return {
          date,
          value: value === null ? null : Math.round(value * 100) / 100,
          status: carriedCount === available.length && available.length > 0
            ? 'carried_forward'
            : (carriedCount > 0 ? 'mixed' : 'fresh_success'),
          source: `${available.length} produto(s), ${carriedCount} reaproveitado(s)`,
        };
      }),
    };
  }).filter((series) => series.points.some((point) => point.value !== null));
}

export function buildProductCurrencySeries(model, productId, filters = {}) {
  const entry = model.histories.get(productId);
  if (!entry || !entryAllowed(entry, filters)) return [];
  return [{
    id: `product:${productId}`,
    label: entry.name,
    kind: 'product-currency',
    category: entry.category,
    product_id: productId,
    unit: 'BRL',
    points: entry.points.map((point) => ({
      ...point,
      value: pointAllowed(point, filters) ? point.value : null,
    })),
  }];
}

function comparisonMetric(record, product) {
  return product?.unit_rule ? positiveNumber(record?.unit_price) : positiveNumber(record?.price);
}

export function buildEquivalentStoreSeries(model, productId, filters = {}) {
  const product = model.productsById.get(productId);
  const entry = model.histories.get(productId);
  if (!product || !entry || !entryAllowed(entry, filters)) return [];
  const byStore = new Map();

  for (const date of model.dates) {
    const runs = model.runs.filter((run) => run.run_date === date);
    const day = new Map();
    for (const run of runs) {
      const offers = run.offers.filter((offer) => (
        offer.product_id === productId
        && !offer.rejected
        && (filters.includeSuspicious || (!offer.suspicious && !offer.unverified))
        && comparisonMetric(offer, product) !== null
      ));
      for (const offer of offers) {
        if (filters.site && filters.site !== ALL && offer.store_label !== filters.site) continue;
        const value = comparisonMetric(offer, product);
        const previous = day.get(offer.store_label);
        if (!previous || value < previous.value) {
          day.set(offer.store_label, {
            date,
            value,
            original_value: offer.price,
            status: 'fresh_success',
            store: offer.store_label,
            title: offer.title,
            source: offer.source || offer.engine_used || '',
            run_id: run.run_id,
            suspicious: offer.suspicious,
            unverified: offer.unverified,
            quality_reasons: offer.quality_reasons,
            quality_unknown_reasons: offer.quality_unknown_reasons,
          });
        }
      }

      const result = run.results.find((candidate) => candidate.product_id === productId);
      if (
        result
        && (filters.includeSuspicious || (!result.suspicious && !result.unverified))
        && comparisonMetric(result, product) !== null
        && !day.has(result.store_label)
      ) {
        if (!filters.site || filters.site === ALL || result.store_label === filters.site) {
          day.set(result.store_label, {
            date,
            value: comparisonMetric(result, product),
            original_value: result.price,
            status: result.observation_status,
            store: result.store_label,
            title: result.title || result.name,
            source: result.source || result.engine_used || '',
            run_id: run.run_id,
            suspicious: result.suspicious,
            unverified: result.unverified,
            quality_reasons: result.quality_reasons,
            quality_unknown_reasons: result.quality_unknown_reasons,
          });
        }
      }
    }

    for (const [store, point] of day) {
      if (!byStore.has(store)) byStore.set(store, new Map());
      byStore.get(store).set(date, point);
    }
  }

  return [...byStore.entries()].map(([store, points]) => ({
    id: `store:${productId}:${store}`,
    label: store,
    kind: 'equivalent-store',
    category: entry.category,
    product_id: productId,
    store,
    unit: product.unit_rule ? `BRL/${product.unit_rule.label || product.unit_rule.basis || 'unidade'}` : 'BRL',
    points: model.dates.map((date) => points.get(date) || { date, value: null, status: 'missing' }),
  })).sort((left, right) => left.label.localeCompare(right.label));
}

export function buildHistorySeries(model, options = {}) {
  const filters = {
    query: options.query || '',
    site: options.site || ALL,
    status: options.status || ALL,
    category: options.category || ALL,
    hideLegacy: options.hideLegacy !== false,
    includeSuspicious: Boolean(options.includeSuspicious),
  };
  if (options.scope === 'by-category') return buildCategoryIndexSeries(model, filters);
  if (options.scope === 'comparison-group') return buildEquivalentStoreSeries(model, options.productId, filters);
  if (options.scope === 'single-product') return buildProductCurrencySeries(model, options.productId, filters);
  return buildAllIndexSeries(model, filters);
}

export function buildStoreHealth(latest, products = []) {
  const run = normalizeRunPayload(latest || {}, latest?.run_id || latest?.generated_at || 'latest');
  if (!run) return [];
  const groups = new Map();
  const productIds = new Set(products.filter((product) => product.is_active !== false).map((product) => product.id));
  if (productIds.size === 0) {
    for (const result of run.results) productIds.add(result.product_id);
    for (const failure of run.failures) productIds.add(failure.product_id);
  }

  for (const productId of productIds) {
    const result = run.results.find((candidate) => candidate.product_id === productId);
    const failure = run.failures.find((candidate) => candidate.product_id === productId);
    const attempts = Array.isArray(failure?.attempts) ? failure.attempts : [];
    const attemptOutcomes = [...attempts].reverse()
      .find((attempt) => Array.isArray(attempt?.store_outcomes) && attempt.store_outcomes.length > 0)
      ?.store_outcomes;
    const reportedOutcomes = [
      ...(Array.isArray(result?.store_outcomes) ? result.store_outcomes : []),
      ...(Array.isArray(failure?.store_outcomes) ? failure.store_outcomes : []),
    ];
    if (reportedOutcomes.length === 0 && Array.isArray(attemptOutcomes)) {
      reportedOutcomes.push(...attemptOutcomes);
    }
    if (reportedOutcomes.length === 0 && Array.isArray(failure?.store_errors)) {
      reportedOutcomes.push(...failure.store_errors.map((error) => ({ ...error, status: 'hard_failure' })));
    }
    const productStates = new Map();
    const statusPriority = { hard_failure: 1, fresh_success: 2, carried_forward: 3 };
    const addProductState = ({ storeId = '', store = '', status }) => {
      const label = storeLabel(store || storeId);
      const key = String(storeId || normalizeText(label) || 'sem-loja').toLowerCase();
      const previous = productStates.get(key);
      if (!previous || statusPriority[status] > statusPriority[previous.status]) {
        productStates.set(key, { store: label, status });
      }
    };

    for (const outcome of reportedOutcomes) {
      const sameAsCarriedStore = result?.observation_status === 'carried_forward'
        && ((result.store_id && outcome?.store_id === result.store_id)
          || (!result.store_id && result.store_label === storeLabel(outcome?.store || outcome?.store_id)));
      const successful = outcome?.status === 'fresh_success'
        || outcome?.status === 'success'
        || outcome?.status === 'ok'
        || Number(outcome?.accepted_offer_count || 0) > 0;
      addProductState({
        storeId: outcome?.store_id,
        store: outcome?.store || outcome?.store_label,
        status: sameAsCarriedStore ? 'carried_forward' : (successful ? 'fresh_success' : 'hard_failure'),
      });
    }

    if (result) {
      addProductState({
        storeId: result.store_id,
        store: result.store_label,
        status: result.observation_status,
      });
    } else if (productStates.size === 0) {
      addProductState({
        storeId: failure?.store_id,
        store: failure?.store_label,
        status: 'hard_failure',
      });
    }

    for (const state of productStates.values()) {
      const group = groups.get(state.store)
        || { store: state.store, fresh_success: 0, carried_forward: 0, hard_failure: 0, total: 0 };
      group.total += 1;
      group[state.status] += 1;
      groups.set(state.store, group);
    }
  }
  return [...groups.values()].sort((left, right) => left.store.localeCompare(right.store));
}

export function buildEngineHealth(latest) {
  return Object.entries(latest?.summary?.engines || {}).map(([name, value]) => ({
    name,
    attempted: Number(value?.attempted || 0),
    success: Number(value?.success || 0),
    failed: Number(value?.failed || 0),
  }));
}

export function buildFailureBreakdown(latest) {
  const counts = new Map();
  for (const failure of latest?.failures || []) {
    const code = String(failure?.error_code || failure?.last_error_code || 'falha_nao_classificada');
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));
}

export function buildCategoryCounts(products = []) {
  const counts = new Map();
  for (const product of products) {
    if (product.is_active === false) continue;
    const category = normalizeCategory(product.category);
    counts.set(category, (counts.get(category) || 0) + 1);
  }
  return [...counts.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => a.category.localeCompare(b.category));
}

export function buildOpportunities(model, { limit = 6 } = {}) {
  const opportunities = [];
  const latestDate = model.dates.at(-1);
  for (const entry of model.histories.values()) {
    if (entry.legacy) continue;
    if (entry.product?.is_active === false) continue;
    const metric = entry.product?.unit_rule ? 'unit_price' : 'price';
    const metricValue = (point) => positiveNumber(metric === 'unit_price' ? point?.raw?.unit_price : point?.value);
    const current = entry.points.find((point) => point.date === latestDate);
    if (
      !current
      || current.status !== 'fresh_success'
      || current.suspicious
      || current.unverified
      || metricValue(current) === null
    ) continue;
    const historicalValues = entry.points.filter((point) => (
      point.date < latestDate
      && point.status === 'fresh_success'
      && !point.suspicious
      && !point.unverified
      && metricValue(point) !== null
    )).slice(-30).map(metricValue);
    const baseline = median(historicalValues);
    if (!baseline) continue;
    const currentValue = metricValue(current);
    const changePct = ((currentValue / baseline) - 1) * 100;
    opportunities.push({
      product_id: entry.product_id,
      name: entry.name,
      store: current.store,
      price: currentValue,
      total_price: current.value,
      baseline,
      change_pct: changePct,
      date: current.date,
      metric,
      unit: metric === 'unit_price' ? (entry.product.unit_rule.label || entry.product.unit_rule.basis || 'unidade') : null,
    });
  }
  return opportunities.sort((left, right) => left.change_pct - right.change_pct).slice(0, limit);
}

export function buildRiskRows(model, latest, { limit = 6 } = {}) {
  const run = normalizeRunPayload(latest || {}, latest?.run_id || latest?.generated_at || 'latest');
  const rows = [];
  for (const failure of run?.failures || []) {
    const product = model.productsById.get(failure.product_id);
    const result = run.results.find((candidate) => candidate.product_id === failure.product_id);
    rows.push({
      product_id: failure.product_id,
      name: product?.name || failure.product_id,
      status: result?.observation_status === 'carried_forward' ? 'carried_forward' : 'hard_failure',
      detail: failure.error_detail || failure.last_error || failure.error_code || 'Falha sem detalhe',
    });
  }
  for (const result of run?.results || []) {
    if (result.observation_status === 'carried_forward' && !rows.some((row) => row.product_id === result.product_id)) {
      rows.push({
        product_id: result.product_id,
        name: model.productsById.get(result.product_id)?.name || result.name || result.product_id,
        status: 'carried_forward',
        detail: result.carried_forward_reason || 'Preço reaproveitado de outra execução',
      });
    }
    if (result.suspicious || result.unverified) {
      const qualityReasons = [
        ...(result.quality_reasons || []),
        ...(result.quality_unknown_reasons || []),
      ];
      const existing = rows.find((row) => row.product_id === result.product_id);
      if (existing) {
        existing.detail = `${existing.detail} · Qualidade: ${qualityReasons.join(', ')}`;
      } else {
        rows.push({
          product_id: result.product_id,
          name: model.productsById.get(result.product_id)?.name || result.name || result.product_id,
          status: result.suspicious ? 'suspicious' : 'unverified',
          detail: qualityReasons.join(', ') || 'Observação não verificada',
        });
      }
    }
  }
  return rows.slice(0, limit);
}

export { ALL };
