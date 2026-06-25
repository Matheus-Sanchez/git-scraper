import { roundTo2 } from '../utils/price_parse.js';
import { extractOfferAttributes, computeUnitPrice, quantityForUnitRule } from './unit.js';
import {
  includesNormalized,
  normalizeSearchText,
  tokenizeSearchText,
} from './text.js';

const MATCH_THRESHOLD = 0.8;

function requiredTerms(intent) {
  if (Array.isArray(intent?.required_terms)) {
    return intent.required_terms;
  }
  return tokenizeSearchText(intent?.name || '');
}

function excludedTerms(intent) {
  return Array.isArray(intent?.excluded_terms) ? intent.excluded_terms : [];
}

function preferredTerms(intent) {
  return Array.isArray(intent?.preferred_terms) ? intent.preferred_terms : [];
}

function hasAllRequiredTerms(title, terms) {
  return terms.every((term) => includesNormalized(title, term));
}

function hasExcludedTerms(title, terms) {
  return terms.some((term) => includesNormalized(title, term));
}

function scoreOffer(intent, offer, required) {
  const title = normalizeSearchText(offer.title);
  const queryTokens = tokenizeSearchText(`${intent.name || ''} ${intent.characteristics || ''}`);
  if (queryTokens.length === 0 && required.length === 0) return 1;

  const queryHits = queryTokens.filter((token) => title.includes(token)).length;
  const requiredHits = required.filter((term) => includesNormalized(title, term)).length;
  const queryRatio = queryTokens.length > 0 ? queryHits / queryTokens.length : 1;
  const requiredRatio = required.length > 0 ? requiredHits / required.length : 1;

  return roundTo2((requiredRatio * 0.75) + (queryRatio * 0.25));
}

function attributeMatches(actual, expected) {
  if (expected === undefined || expected === null || expected === '') return true;
  if (actual === undefined || actual === null || actual === '') return false;

  if (typeof expected === 'number') {
    const actualNumber = Number(actual);
    return Number.isFinite(actualNumber) && actualNumber === expected;
  }

  if (typeof expected === 'boolean') {
    return Boolean(actual) === expected;
  }

  return normalizeSearchText(actual) === normalizeSearchText(expected);
}

function missingRequiredAttributes(attributes, rules = {}) {
  return Object.entries(rules || {})
    .filter(([key, expected]) => !attributeMatches(attributes?.[key], expected))
    .map(([key]) => key);
}

function preferredAttributeScore(attributes, rules = {}) {
  const entries = Object.entries(rules || {});
  if (entries.length === 0) return 0;
  const matches = entries.filter(([key, expected]) => attributeMatches(attributes?.[key], expected)).length;
  return matches / entries.length;
}

function preferredTermScore(title, terms) {
  if (!terms || terms.length === 0) return 0;
  const hits = terms.filter((term) => includesNormalized(title, term)).length;
  return hits / terms.length;
}

function priorityScore(intent, rawOffer, attributes) {
  const termScore = preferredTermScore(rawOffer?.title, preferredTerms(intent));
  const attrScore = preferredAttributeScore(attributes, intent?.preferred_attributes);
  const hasTerms = preferredTerms(intent).length > 0;
  const hasAttrs = Object.keys(intent?.preferred_attributes || {}).length > 0;

  if (!hasTerms && !hasAttrs) return 0;
  if (hasTerms && hasAttrs) return roundTo2((termScore * 0.5) + (attrScore * 0.5));
  return roundTo2(hasTerms ? termScore : attrScore);
}

export function decorateOfferForIntent(intent, rawOffer, { rank = 0 } = {}) {
  const price = Number(rawOffer?.price);
  const attributes = extractOfferAttributes(rawOffer?.title);
  const unitPrice = computeUnitPrice(price, attributes, intent?.unit_rule);
  const normalizedQuantity = quantityForUnitRule(attributes, intent?.unit_rule);
  const required = requiredTerms(intent);
  const excluded = excludedTerms(intent);
  const matchScore = scoreOffer(intent, rawOffer, required);
  const requiredAttributesMissing = missingRequiredAttributes(attributes, intent?.required_attributes);
  const offerPriorityScore = priorityScore(intent, rawOffer, attributes);
  const rejectedReasons = [];

  if (!rawOffer?.title) rejectedReasons.push('missing_title');
  if (!rawOffer?.url) rejectedReasons.push('missing_url');
  if (!Number.isFinite(price) || price <= 0) rejectedReasons.push('missing_price');
  if (!hasAllRequiredTerms(rawOffer?.title, required)) rejectedReasons.push('missing_required_terms');
  if (requiredAttributesMissing.length > 0) rejectedReasons.push(`missing_required_attributes:${requiredAttributesMissing.join(',')}`);
  if (hasExcludedTerms(rawOffer?.title, excluded)) rejectedReasons.push('excluded_term');
  if (matchScore < MATCH_THRESHOLD) rejectedReasons.push('low_match_score');

  return {
    offer_id: rawOffer.offer_id || `${rawOffer.store_id}:${rank || rawOffer.position || 0}`,
    intent_id: intent.id,
    product_id: intent.id,
    store_id: rawOffer.store_id,
    store: rawOffer.store,
    title: rawOffer.title,
    url: rawOffer.url,
    price,
    currency: 'BRL',
    unit_price: unitPrice,
    unit_basis: intent?.unit_rule?.basis || null,
    normalized_quantity: Number.isFinite(Number(normalizedQuantity)) ? Number(normalizedQuantity) : null,
    attributes,
    match_score: matchScore,
    priority_score: offerPriorityScore,
    rank,
    position: rawOffer.position || rank,
    source: rawOffer.source || 'search-result',
    engine_used: rawOffer.engine_used,
    fetched_at: rawOffer.fetched_at,
    rejected: rejectedReasons.length > 0,
    rejected_reasons: rejectedReasons,
  };
}

function compareOffers(intent) {
  return (left, right) => {
    if (right.priority_score !== left.priority_score) {
      return right.priority_score - left.priority_score;
    }

    const useUnitPrice = Boolean(intent?.unit_rule);
    if (useUnitPrice) {
      const leftHasUnit = Number.isFinite(Number(left.unit_price));
      const rightHasUnit = Number.isFinite(Number(right.unit_price));
      if (leftHasUnit !== rightHasUnit) return leftHasUnit ? -1 : 1;
      if (leftHasUnit && rightHasUnit && left.unit_price !== right.unit_price) {
        return left.unit_price - right.unit_price;
      }
    }

    if (left.price !== right.price) return left.price - right.price;
    if (right.match_score !== left.match_score) return right.match_score - left.match_score;
    return String(left.title || '').localeCompare(String(right.title || ''));
  };
}

export function rankOffersForIntent(intent, rawOffers, { topPerStore = 5 } = {}) {
  const decorated = (rawOffers || [])
    .map((offer, index) => decorateOfferForIntent(intent, offer, { rank: index + 1 }));

  const accepted = decorated
    .filter((offer) => !offer.rejected)
    .sort(compareOffers(intent));

  const topOffers = [];
  const byStore = new Map();
  for (const offer of decorated.sort(compareOffers(intent))) {
    const bucket = byStore.get(offer.store_id) || [];
    if (bucket.length >= topPerStore) continue;
    bucket.push(offer);
    byStore.set(offer.store_id, bucket);
  }

  for (const bucket of byStore.values()) {
    topOffers.push(...bucket);
  }

  return {
    best: accepted[0] || null,
    accepted,
    offers: topOffers.sort((left, right) => {
      if (left.store_id !== right.store_id) return String(left.store_id).localeCompare(String(right.store_id));
      return compareOffers(intent)(left, right);
    }),
    rejected_count: decorated.filter((offer) => offer.rejected).length,
    checked_count: decorated.length,
  };
}
