import { getStoreSupportByUrl, listSmokeEnabledStores } from '../config/support_matrix.js';

function normalizeProductIds(productIds) {
  return [...new Set((productIds || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function buildSelectedProduct(product, support) {
  return {
    ...product,
    smoke_store: support.store,
    smoke_support_level: support.support_level,
  };
}

export function parseSmokeProductIds(rawValue) {
  return normalizeProductIds(String(rawValue || '').split(','));
}

export function selectSmokeProducts(products, { productIds = [], maxProductsPerStore = 1 } = {}) {
  const explicitProductIds = normalizeProductIds(productIds);
  const smokeEnabledStores = listSmokeEnabledStores();
  const byStore = new Map(smokeEnabledStores.map((entry) => [entry.store, []]));

  const eligibleProducts = (products || [])
    .filter((product) => product?.is_active)
    .map((product) => ({
      product,
      support: getStoreSupportByUrl(product.url),
    }))
    .filter(({ support }) => support.smoke_real);

  if (explicitProductIds.length > 0) {
    const allowedIds = new Set(explicitProductIds);
    return eligibleProducts
      .filter(({ product }) => allowedIds.has(product.id))
      .map(({ product, support }) => buildSelectedProduct(product, support));
  }

  for (const { product, support } of eligibleProducts) {
    const bucket = byStore.get(support.store);
    if (!bucket) continue;
    if (bucket.length >= Math.max(1, Number(maxProductsPerStore) || 1)) continue;
    bucket.push(buildSelectedProduct(product, support));
  }

  return smokeEnabledStores.flatMap((entry) => byStore.get(entry.store) || []);
}

function createStoreSummary(store, supportLevel) {
  return {
    store,
    support_level: supportLevel,
    selected_count: 0,
    direct_success_count: 0,
    carried_forward_count: 0,
    failure_count: 0,
    selected_product_ids: [],
    direct_success_product_ids: [],
    carried_forward_product_ids: [],
    failed_product_ids: [],
    failure_codes: [],
    status: 'fail',
  };
}

export function summarizeSmokeRun({ selectedProducts, latestPayload }) {
  const itemsById = new Map((latestPayload?.items || []).map((item) => [item.product_id, item]));
  const failuresById = new Map((latestPayload?.failures || []).map((failure) => [failure.product_id, failure]));
  const storeSummaries = new Map();

  for (const product of selectedProducts || []) {
    const support = getStoreSupportByUrl(product.url);
    const existing = storeSummaries.get(support.store) || createStoreSummary(support.store, support.support_level);
    existing.selected_count += 1;
    existing.selected_product_ids.push(product.id);

    const item = itemsById.get(product.id);
    const failure = failuresById.get(product.id);

    if (item?.status === 'ok' && item.engine_used !== 'carry_forward') {
      existing.direct_success_count += 1;
      existing.direct_success_product_ids.push(product.id);
    } else if (item?.status === 'carried_forward' || item?.engine_used === 'carry_forward') {
      existing.carried_forward_count += 1;
      existing.carried_forward_product_ids.push(product.id);
      if (failure?.error_code) {
        existing.failure_codes.push(failure.error_code);
      }
    } else {
      existing.failure_count += 1;
      existing.failed_product_ids.push(product.id);
      if (failure?.error_code) {
        existing.failure_codes.push(failure.error_code);
      }
    }

    existing.status = existing.direct_success_count > 0 ? 'pass' : 'fail';
    storeSummaries.set(support.store, existing);
  }

  const stores = [...storeSummaries.values()].map((entry) => ({
    ...entry,
    failure_codes: [...new Set(entry.failure_codes)],
  }));
  const ok = stores.length > 0 && stores.every((entry) => entry.status === 'pass');

  return {
    ok,
    overall_status: ok ? 'pass' : 'fail',
    store_results: stores,
  };
}
