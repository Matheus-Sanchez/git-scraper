import {
  getStoreSupportById,
  isKnownStoreId,
  listSmokeEnabledStores,
} from '../config/support_matrix.js';
import { includesNormalized, normalizeSearchText } from '../search/text.js';
import { extractOfferAttributes } from '../search/unit.js';
import { listRegisteredSmokeCases } from './cases.js';

function normalizeProductIds(productIds) {
  return [...new Set((productIds || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function buildSelectedProduct(product, support, smokeCase) {
  return {
    ...product,
    id: `${product.id}-${support.adapter}`,
    stores: [support.adapter],
    required_terms: [...smokeCase.required_terms],
    required_attributes: { ...smokeCase.required_attributes },
    excluded_terms: [...smokeCase.excluded_terms],
    smoke_case_id: smokeCase.id,
    smoke_store: support.store,
    smoke_store_id: support.adapter,
    smoke_support_level: support.support_level,
    smoke_original_id: product.id,
  };
}

export function parseSmokeProductIds(rawValue) {
  return normalizeProductIds(String(rawValue || '').split(','));
}

export function parseSmokeStoreIds(rawValue) {
  return [...new Set(normalizeProductIds(String(rawValue || '').split(','))
    .map((storeId) => storeId.toLowerCase()))];
}

function requestedSmokeSupports(storeIds) {
  const explicitStoreIds = [...new Set(normalizeProductIds(storeIds)
    .map((storeId) => storeId.toLowerCase()))];
  if (explicitStoreIds.length === 0) return listSmokeEnabledStores();

  const registeredCaseStores = new Set(listRegisteredSmokeCases().map((entry) => entry.store_id));
  return explicitStoreIds.map((storeId) => {
    if (!isKnownStoreId(storeId) || !registeredCaseStores.has(storeId)) {
      throw new Error(`Unknown or unregistered smoke store: ${storeId}`);
    }
    return getStoreSupportById(storeId);
  });
}

export function assertSmokeSelectionCoverage(selectedProducts, { storeIds = [], productIds = [] } = {}) {
  if (normalizeProductIds(productIds).length > 0) return true;
  const expectedStoreIds = requestedSmokeSupports(storeIds).map((entry) => entry.adapter);
  const selectedStoreIds = new Set((selectedProducts || []).map((product) => product.smoke_store_id));
  const missingStoreIds = expectedStoreIds.filter((storeId) => !selectedStoreIds.has(storeId));
  if (missingStoreIds.length > 0) {
    throw new Error(`Smoke selection is missing active cases for: ${missingStoreIds.join(', ')}`);
  }
  return true;
}

export function selectSmokeProducts(products, {
  productIds = [],
  storeIds = [],
  maxProductsPerStore = 1,
} = {}) {
  const explicitProductIds = normalizeProductIds(productIds);
  const requestedSupports = requestedSmokeSupports(storeIds);
  const requestedStoreIds = new Set(requestedSupports.map((entry) => entry.adapter));
  const byStore = new Map(requestedSupports.map((entry) => [entry.store, []]));
  const productsById = new Map((products || []).map((product) => [product.id, product]));
  const eligibleProducts = listRegisteredSmokeCases()
    .filter((smokeCase) => requestedStoreIds.has(smokeCase.store_id))
    .map((smokeCase) => ({
      smokeCase,
      product: productsById.get(smokeCase.product_id),
      support: requestedSupports.find((entry) => entry.adapter === smokeCase.store_id),
    }))
    .filter(({ product, support }) => product?.is_active && support);

  if (explicitProductIds.length > 0) {
    const allowedIds = new Set(explicitProductIds);
    return eligibleProducts
      .filter(({ product, support, smokeCase }) => allowedIds.has(smokeCase.id)
        || allowedIds.has(product.id)
        || allowedIds.has(`${product.id}-${support.adapter}`))
      .map(({ product, support, smokeCase }) => buildSelectedProduct(product, support, smokeCase));
  }

  for (const { product, support, smokeCase } of eligibleProducts) {
    const bucket = byStore.get(support.store);
    if (!bucket) continue;
    if (bucket.length >= Math.max(1, Number(maxProductsPerStore) || 1)) continue;
    bucket.push(buildSelectedProduct(product, support, smokeCase));
  }

  return requestedSupports.flatMap((entry) => byStore.get(entry.store) || []);
}

function createStoreSummary(store, supportLevel) {
  return {
    store,
    support_level: supportLevel,
    selected_count: 0,
    direct_success_count: 0,
    accepted_offer_count: 0,
    carried_forward_count: 0,
    identity_failure_count: 0,
    failure_count: 0,
    selected_product_ids: [],
    direct_success_product_ids: [],
    carried_forward_product_ids: [],
    failed_product_ids: [],
    identity_failure_product_ids: [],
    identity_failure_reasons: [],
    failure_codes: [],
    status: 'fail',
  };
}

function attributeMatches(actual, expected) {
  if (expected === undefined || expected === null || expected === '') return true;
  if (actual === undefined || actual === null || actual === '') return false;
  if (typeof expected === 'number') return Number(actual) === expected;
  if (typeof expected === 'boolean') return Boolean(actual) === expected;
  return normalizeSearchText(actual) === normalizeSearchText(expected);
}

function assessDirectResult(product, item, offers) {
  const reasons = [];
  if (item?.store_id !== product.smoke_store_id) reasons.push('wrong_store');

  const title = item?.title || '';
  const missingTerms = (product.required_terms || []).filter((term) => !includesNormalized(title, term));
  if (missingTerms.length > 0) reasons.push(`missing_required_terms:${missingTerms.join(',')}`);

  const excludedMatches = (product.excluded_terms || []).filter((term) => includesNormalized(title, term));
  if (excludedMatches.length > 0) reasons.push(`excluded_terms:${excludedMatches.join(',')}`);

  const extractedAttributes = extractOfferAttributes(title);
  const attributes = { ...extractedAttributes, ...(item?.attributes || {}) };
  const mismatchedAttributes = Object.entries(product.required_attributes || {})
    .filter(([key, expected]) => !attributeMatches(attributes[key], expected))
    .map(([key]) => key);
  if (mismatchedAttributes.length > 0) reasons.push(`required_attributes:${mismatchedAttributes.join(',')}`);

  const matchScore = item?.match_score;
  if (matchScore === null || matchScore === undefined || !Number.isFinite(Number(matchScore)) || Number(matchScore) < 0.8) {
    reasons.push('low_or_missing_match_score');
  }

  const acceptedOffer = (offers || []).find((offer) => (
    (offer.intent_id === product.id || offer.product_id === product.id)
    && offer.store_id === product.smoke_store_id
    && offer.rejected === false
    && (offer.url === item?.url || offer.title === item?.title)
  ));
  if (!acceptedOffer) reasons.push('accepted_offer_not_found');

  return {
    ok: reasons.length === 0,
    accepted_offer: Boolean(acceptedOffer),
    reasons,
  };
}

export function summarizeSmokeRun({ selectedProducts, latestPayload }) {
  const itemsById = new Map((latestPayload?.items || []).map((item) => [item.product_id, item]));
  const failuresById = new Map((latestPayload?.failures || []).map((failure) => [failure.product_id, failure]));
  const storeSummaries = new Map();
  const offers = latestPayload?.offers || [];

  for (const product of selectedProducts || []) {
    const existing = storeSummaries.get(product.smoke_store)
      || createStoreSummary(product.smoke_store, product.smoke_support_level);
    existing.selected_count += 1;
    existing.selected_product_ids.push(product.id);

    const item = itemsById.get(product.id);
    const failure = failuresById.get(product.id);

    if (item?.status === 'ok' && item.engine_used !== 'carry_forward') {
      const assessment = assessDirectResult(product, item, offers);
      if (assessment.accepted_offer) existing.accepted_offer_count += 1;
      if (assessment.ok) {
        existing.direct_success_count += 1;
        existing.direct_success_product_ids.push(product.id);
      } else {
        existing.identity_failure_count += 1;
        existing.identity_failure_product_ids.push(product.id);
        existing.identity_failure_reasons.push(...assessment.reasons);
      }
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

    existing.status = existing.selected_count > 0
      && existing.direct_success_count === existing.selected_count
      && existing.accepted_offer_count === existing.selected_count
      ? 'pass'
      : 'fail';
    storeSummaries.set(product.smoke_store, existing);
  }

  const stores = [...storeSummaries.values()].map((entry) => ({
    ...entry,
    failure_codes: [...new Set(entry.failure_codes)],
    identity_failure_reasons: [...new Set(entry.identity_failure_reasons)],
  }));
  const ok = stores.length > 0 && stores.every((entry) => entry.status === 'pass');

  return {
    ok,
    overall_status: ok ? 'pass' : 'fail',
    store_results: stores,
  };
}
