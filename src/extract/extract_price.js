import { load } from 'cheerio';
import { extractNumericTokens, parseBRLValue, roundTo2 } from '../utils/price_parse.js';
import {
  clampConfidence,
  confidenceBaseBySource,
  contextAdjustment,
  hasCurrentPriceContext,
  hasInstallmentContext,
  hasOldPriceContext,
  isCandidatePricePlausible,
  priorityBySource,
} from './heuristics.js';

const DEFAULT_SELECTOR_CANDIDATES = [
  '[itemprop="price"]',
  '[data-price]',
  '.price',
  '.product-price',
  '.sale-price',
  '.current-price',
  '.best-price',
  '.valor',
  '.preco',
  '.preco-por',
  '.price-current',
  '.a-price .a-offscreen',
];

function readPath(input, path) {
  if (!path) return undefined;

  const tokens = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);

  let current = input;
  for (const token of tokens) {
    if (current === null || current === undefined) return undefined;
    current = current[token];
  }

  return current;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function coerceText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

function addCandidate(candidates, {
  price,
  raw,
  source,
  context = '',
}) {
  const parsedPrice = Number.isFinite(price) ? roundTo2(price) : parseBRLValue(raw);
  if (!isCandidatePricePlausible(parsedPrice)) return;

  const key = `${source}:${parsedPrice}`;
  const existing = candidates.find((item) => item.key === key);
  if (existing) {
    if (context.length > existing.context.length) {
      existing.context = context;
    }
    return;
  }

  candidates.push({
    key,
    price: parsedPrice,
    source,
    context: context.slice(0, 220),
  });
}

function walkForPrices(node, candidates, fallbackSource = 'json-ld') {
  if (node === null || node === undefined) return;

  if (Array.isArray(node)) {
    for (const item of node) walkForPrices(item, candidates, fallbackSource);
    return;
  }

  if (typeof node !== 'object') return;

  const serialized = coerceText(node);

  const directPrice = node.price ?? node.lowPrice ?? node.highPrice;
  if (directPrice !== undefined) {
    addCandidate(candidates, {
      raw: directPrice,
      source: fallbackSource,
      context: serialized,
    });
  }

  if (node.offers) {
    if (Array.isArray(node.offers)) {
      for (const offer of node.offers) {
        if (offer?.price !== undefined) {
          addCandidate(candidates, {
            raw: offer.price,
            source: fallbackSource,
            context: coerceText(offer),
          });
        }
      }
    } else if (typeof node.offers === 'object' && node.offers.price !== undefined) {
      addCandidate(candidates, {
        raw: node.offers.price,
        source: fallbackSource,
        context: coerceText(node.offers),
      });
    }
  }

  for (const value of Object.values(node)) {
    walkForPrices(value, candidates, fallbackSource);
  }
}

function extractJsonLdCandidates($, jsonldPaths, candidates) {
  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).contents().text().trim();
    if (!raw) return;

    const parsed = safeJsonParse(raw);
    if (!parsed) return;

    walkForPrices(parsed, candidates, 'json-ld');

    for (const path of jsonldPaths) {
      const value = readPath(parsed, path);
      if (value !== undefined) {
        addCandidate(candidates, {
          raw: value,
          source: 'json-ld',
          context: `path:${path}`,
        });
      }
    }
  });
}

function extractMetaCandidates($, candidates) {
  const selectors = [
    'meta[property="product:price:amount"]',
    'meta[property="og:price:amount"]',
    'meta[name="twitter:data1"]',
    'meta[itemprop="price"]',
    'meta[name="price"]',
    'meta[name="price:amount"]',
  ];

  for (const selector of selectors) {
    $(selector).each((_, element) => {
      const content = $(element).attr('content') || $(element).attr('value') || '';
      if (!content) return;
      addCandidate(candidates, {
        raw: content,
        source: 'meta',
        context: `${selector} ${content}`,
      });
    });
  }
}

function extractSelectorCandidates($, selectorEntries, candidates) {
  for (const entry of selectorEntries) {
    const selector = entry.selector;
    const source = entry.source;

    if (!selector) continue;

    $(selector).slice(0, 8).each((_, element) => {
      const text = $(element).text().trim();
      const content = $(element).attr('content') || '';
      const context = `${$(element).parent().text().slice(0, 180)} ${text}`;

      const tokens = [content, text, ...extractNumericTokens(text)];
      for (const token of tokens) {
        addCandidate(candidates, {
          raw: token,
          source,
          context,
        });
      }
    });
  }
}

function extractRegexCandidates(html, regexHints, candidates) {
  const text = String(html || '');
  const baseTokens = extractNumericTokens(text);
  for (const token of baseTokens) {
    addCandidate(candidates, {
      raw: token,
      source: 'regex',
      context: token,
    });
  }

  for (const hint of regexHints || []) {
    try {
      const pattern = new RegExp(hint, 'gi');
      const matches = text.match(pattern) || [];
      for (const match of matches) {
        addCandidate(candidates, {
          raw: match,
          source: 'regex',
          context: `hint:${hint} ${match}`,
        });
      }
    } catch {
      // ignore invalid hint regex
    }
  }
}

function hasConvergingSources(candidate, allCandidates) {
  return allCandidates.some((other) => {
    if (other === candidate) return false;
    if (other.source === candidate.source) return false;

    const delta = Math.abs(other.price - candidate.price);
    const ratio = delta / candidate.price;
    return ratio <= 0.02;
  });
}

function scoreCandidate(candidate, candidates) {
  if (hasInstallmentContext(candidate.context)) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = priorityBySource(candidate.source) * 100;
  if (hasCurrentPriceContext(candidate.context)) score += 12;
  if (hasOldPriceContext(candidate.context) && !hasCurrentPriceContext(candidate.context)) score -= 12;

  // If both "de" and "por" appear, favor the lower plausible one.
  if (/(\bde\b).*(\bpor\b)/i.test(candidate.context)) {
    const lowerCount = candidates.filter((item) => item.price >= candidate.price).length;
    score += 5 + Math.min(4, lowerCount);
  }

  return score;
}

export function extractPriceFromHtml({
  html,
  selectors = {},
  adapterCandidates = [],
  adapterName = 'generic',
}) {
  const safeHtml = String(html || '');
  const $ = load(safeHtml);
  const candidates = [];

  extractJsonLdCandidates($, selectors.jsonld_paths || [], candidates);
  extractMetaCandidates($, candidates);

  const adapterSelectors = (selectors.adapter_price_css || []).map((selector) => ({
    selector,
    source: 'adapter',
  }));

  const customSelectors = (selectors.price_css || []).map((selector) => ({
    selector,
    source: 'selector',
  }));

  const fallbackSelectors = DEFAULT_SELECTOR_CANDIDATES.map((selector) => ({
    selector,
    source: 'selector',
  }));

  extractSelectorCandidates($, [...adapterSelectors, ...customSelectors, ...fallbackSelectors], candidates);

  for (const adapterCandidate of adapterCandidates) {
    addCandidate(candidates, {
      raw: adapterCandidate.raw ?? adapterCandidate.price,
      price: adapterCandidate.price,
      source: 'adapter',
      context: adapterCandidate.context || adapterName,
    });
  }

  extractRegexCandidates(safeHtml, selectors.regex_hints || [], candidates);

  const valid = candidates
    .filter((candidate) => isCandidatePricePlausible(candidate.price))
    .map((candidate) => ({
      ...candidate,
      score: scoreCandidate(candidate, candidates),
    }))
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.price - b.price;
    });

  if (valid.length === 0) {
    return {
      ok: false,
      reason: 'No plausible price candidates',
      candidates_checked: candidates.length,
    };
  }

  const chosen = valid[0];
  const converged = hasConvergingSources(chosen, valid);

  let confidence = confidenceBaseBySource(chosen.source) + contextAdjustment(chosen.context);
  if (converged) confidence += 0.05;
  confidence = clampConfidence(confidence);

  return {
    ok: true,
    price: chosen.price,
    source: chosen.source,
    confidence: roundTo2(confidence),
    candidates_checked: candidates.length,
  };
}