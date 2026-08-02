import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { parseBRLValue } from '../utils/price_parse.js';
import { getStoreSupportById } from '../config/support_matrix.js';
import { slugifyQuery } from './text.js';

function shortHash(value) {
  return createHash('sha1').update(String(value || '')).digest('hex').slice(0, 10);
}

function normalizedHostname(value) {
  return String(value || '').replace(/^www\./i, '').toLowerCase();
}

function isAmazonDomain(hostname) {
  const normalized = normalizedHostname(hostname);
  return normalized === 'amazon.com.br'
    || normalized.endsWith('.amazon.com.br')
    || normalized === 'amazon.com'
    || normalized.endsWith('.amazon.com');
}

function unwrapAmazonSponsoredUrl(resolvedUrl) {
  try {
    const source = new URL(resolvedUrl);
    if (!isAmazonDomain(source.hostname) || !/^\/sspa\/click\/?$/i.test(source.pathname)) {
      return resolvedUrl;
    }

    const targetValue = source.searchParams.get('url');
    if (!targetValue) return resolvedUrl;
    const target = new URL(targetValue, source.origin);
    return isAmazonDomain(target.hostname) ? target.toString() : resolvedUrl;
  } catch {
    return resolvedUrl;
  }
}

function absoluteUrl(baseUrl, href) {
  const rawHref = String(href || '').trim();
  if (!rawHref || rawHref === '#' || /^javascript:/i.test(rawHref)) return '';

  try {
    return unwrapAmazonSponsoredUrl(new URL(rawHref, baseUrl).toString());
  } catch {
    return '';
  }
}

function compactText(value, max = 260) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function firstText($root, selectors) {
  for (const selector of selectors) {
    const text = compactText($root.find(selector).first().text());
    if (text) return text;
  }
  return '';
}

function firstHref($root, selectors, baseUrl) {
  for (const selector of selectors) {
    const href = $root.find(selector).first().attr('href') || '';
    const resolved = absoluteUrl(baseUrl, href);
    if (resolved) return resolved;
  }
  const fallback = absoluteUrl(baseUrl, $root.find('a[href]').first().attr('href') || '');
  return fallback;
}

const NON_CURRENT_PRICE_HINT = /(?:a[-_\s]?text[-_\s]?price|old|original|previous|list[-_\s]?price|strike|scratch|installment|parcel|rating|avaliacao|discount|saving|economize|^del$|^s$)/i;
const NON_CURRENT_PRICE_ANCESTOR_HINT = /(?:a[-_\s]?text[-_\s]?price|old|original|previous|list[-_\s]?price|strike|scratch|^del$|^s$)/i;
const GENERIC_PRICE_SELECTORS = [
  '[data-testid*="price"]',
  '[itemprop="price"]',
  '[class*="currentPrice"]',
  '[class*="current-price"]',
  '[class*="finalPrice"]',
  '[class*="final-price"]',
  '[class*="price"]',
  '[class*="Price"]',
];

function priceElementMetadata($element) {
  return [
    $element.get(0)?.tagName,
    $element.attr('class'),
    $element.attr('id'),
    $element.attr('data-testid'),
    $element.attr('aria-label'),
  ].filter(Boolean).join(' ');
}

function isNonCurrentPriceElement($element) {
  if (NON_CURRENT_PRICE_HINT.test(priceElementMetadata($element))) return true;

  let $ancestor = $element.parent();
  for (let depth = 0; depth < 2 && $ancestor.length > 0; depth += 1) {
    if (NON_CURRENT_PRICE_ANCESTOR_HINT.test(priceElementMetadata($ancestor))) return true;
    $ancestor = $ancestor.parent();
  }
  return false;
}

function currencyCandidates(text) {
  const input = String(text || '');
  const pattern = /R\$\s*(?:\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+(?:[.,]\d{2})?)(?![\d.,])/gi;
  return [...input.matchAll(pattern)]
    .map((match) => {
      const price = parsePriceToken(match[0]);
      if (!Number.isFinite(price) || price <= 0) return null;

      const index = match.index || 0;
      const before = input.slice(Math.max(0, index - 48), index).toLowerCase();
      const after = input.slice(index + match[0].length, index + match[0].length + 32).toLowerCase();
      let score = 0;

      if (/(?:\bpor|agora|a vista|à vista|no pix|via pix)\s*:?-?\s*$/.test(before)) score += 8;
      if (/(?:\bde|era|pre[cç]o antigo|pre[cç]o original)\s*:?-?\s*$/.test(before)) score -= 8;
      if (/(?:\d{1,2}\s*x(?:\s+de)?|parcela(?:s)?(?:\s+de)?)\s*:?-?\s*$/.test(before)) score -= 10;
      if (/(?:economize|desconto de)\s*:?-?\s*$/.test(before)) score -= 10;
      if (/^\s*(?:por\s+m[eê]s|cada\s+parcela)/.test(after)) score -= 6;

      return { price, score, index };
    })
    .filter(Boolean);
}

function parsePriceToken(value) {
  const numericText = String(value || '')
    .replace(/R\$/gi, '')
    .replace(/\s+/g, '');
  if (/^\d{1,3}(?:\.\d{3})+$/.test(numericText)) {
    return parseBRLValue(numericText.replace(/\./g, ''));
  }
  return parseBRLValue(value);
}

function firstPositivePrice(...values) {
  for (const value of values) {
    const parsed = parseBRLValue(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function decodeHtmlText(value) {
  return compactText(load(String(value || ''), null, false).text());
}

function parseJsonScript($, selector) {
  const text = $(selector).first().text().trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isSchemaInStock(availability) {
  return /(?:^|\/)InStock$/i.test(String(availability || '').trim());
}

function buildKabumStructuredOffer({
  title,
  url,
  price,
  position,
  source,
  searchUrl,
}) {
  const support = getStoreSupportById('kabum');
  const resolvedUrl = absoluteUrl(searchUrl, url);
  const normalizedTitle = decodeHtmlText(title);
  const normalizedPrice = firstPositivePrice(price);
  if (!normalizedTitle || !resolvedUrl || !normalizedPrice || !isLikelyProductUrl(resolvedUrl, {
    domains: support.domains,
    productUrlPattern: /\/produto\//i,
  })) return null;

  return {
    offer_id: `kabum:${shortHash(resolvedUrl)}`,
    store_id: 'kabum',
    store: support.store,
    title: normalizedTitle,
    url: resolvedUrl,
    price: normalizedPrice,
    position,
    source,
  };
}

function extractKabumNextData($, searchUrl) {
  const payload = parseJsonScript($, '#__NEXT_DATA__');
  const products = payload?.props?.pageProps?.data?.catalogServer?.data;
  if (!Array.isArray(products)) return [];

  return products.flatMap((product, index) => {
    if (product?.available !== true || product?.code === undefined || product?.code === null) return [];
    const friendlyName = String(product.friendlyName || slugifyQuery(product.name || '')).trim();
    const url = `/produto/${encodeURIComponent(String(product.code))}${friendlyName ? `/${friendlyName}` : ''}`;
    const offer = buildKabumStructuredOffer({
      title: product.name,
      url,
      price: firstPositivePrice(
        product.priceWithDiscount,
        product.offer?.priceWithDiscount,
        product.price,
        product.offer?.price,
      ),
      position: index + 1,
      source: 'search-next-data',
      searchUrl,
    });
    return offer ? [offer] : [];
  });
}

function extractKabumJsonLd($, searchUrl) {
  const payload = parseJsonScript($, '#productSchema');
  const products = Array.isArray(payload) ? payload : payload ? [payload] : [];

  return products.flatMap((product, index) => {
    if (product?.['@type'] !== 'Product') return [];
    const offers = Array.isArray(product.offers) ? product.offers : [product.offers].filter(Boolean);
    const inStockOffer = offers.find((offer) => isSchemaInStock(offer?.availability));
    if (!inStockOffer) return [];

    const offer = buildKabumStructuredOffer({
      title: product.name,
      url: inStockOffer.url || product.url,
      price: firstPositivePrice(
        inStockOffer.price,
        inStockOffer.lowPrice,
        inStockOffer.priceSpecification?.price,
      ),
      position: index + 1,
      source: 'search-json-ld',
      searchUrl,
    });
    return offer ? [offer] : [];
  });
}

function extractKabumStructuredResults({ html, searchUrl, limit = 40 }) {
  const $ = load(String(html || ''));
  const results = [...extractKabumNextData($, searchUrl), ...extractKabumJsonLd($, searchUrl)];
  const seen = new Set();
  return results.filter((offer) => {
    if (seen.has(offer.url) || seen.size >= limit) return false;
    seen.add(offer.url);
    return true;
  });
}

function firstPrice($root, selectors) {
  for (const selector of selectors) {
    const elements = $root.find(selector);
    for (let index = 0; index < elements.length; index += 1) {
      const $element = elements.eq(index);
      if (isNonCurrentPriceElement($element)) continue;

      const machineValue = $element.attr('content')
        || $element.attr('data-price')
        || $element.attr('value')
        || '';
      const parsedMachineValue = parsePriceFromText(machineValue, { allowBare: true });
      if (Number.isFinite(parsedMachineValue) && parsedMachineValue > 0) return parsedMachineValue;

      const parsedText = parsePriceFromText(compactText($element.text()));
      if (Number.isFinite(parsedText) && parsedText > 0) return parsedText;
    }
  }

  const parsed = parsePriceFromText(compactText($root.text(), 800));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parsePriceFromText(text, { allowBare = false } = {}) {
  const candidates = currencyCandidates(text)
    .sort((left, right) => right.score - left.score || right.index - left.index);
  if (candidates.length > 0) return candidates[0].price;

  if (allowBare && /^\s*(?:\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+(?:[.,]\d{2})?)\s*$/.test(String(text || ''))) {
    return parsePriceToken(text);
  }

  return null;
}

function isLikelyProductUrl(url, { domains, productUrlPattern }) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const hostname = normalizedHostname(parsed.hostname);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const belongsToSupportedDomain = domains.some((domain) => {
      const normalizedDomain = normalizedHostname(domain);
      return hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`);
    });
    if (!belongsToSupportedDomain) return false;
    if (productUrlPattern && !productUrlPattern.test(parsed.toString())) return false;
    return true;
  } catch {
    return false;
  }
}

function extractByCards({
  html,
  searchUrl,
  storeId,
  cardSelectors,
  titleSelectors,
  urlSelectors,
  priceSelectors,
  productUrlPattern,
  limit = 40,
}) {
  const $ = load(String(html || ''));
  const support = getStoreSupportById(storeId);
  const out = [];
  const seen = new Set();
  const selector = cardSelectors.join(',');

  $(selector).each((_, element) => {
    if (out.length >= limit) return false;

    const $card = $(element);
    const url = firstHref($card, urlSelectors, searchUrl);
    const title = firstText($card, titleSelectors) || compactText($card.find('a[href]').first().text());
    const price = firstPrice($card, priceSelectors);

    if (!title || !url || !isLikelyProductUrl(url, {
      domains: support.domains,
      productUrlPattern,
    })) return undefined;
    const key = `${title}:${url}`;
    if (seen.has(key)) return undefined;
    seen.add(key);

    out.push({
      offer_id: `${storeId}:${shortHash(url)}`,
      store_id: storeId,
      store: support.store,
      title,
      url,
      price,
      position: out.length + 1,
      source: 'search-card',
    });
    return undefined;
  });

  return out;
}

function extractGenericAnchors({ html, searchUrl, storeId, productUrlPattern, limit = 40 }) {
  const $ = load(String(html || ''));
  const support = getStoreSupportById(storeId);
  const out = [];
  const seen = new Set();

  $('a[href]').each((_, element) => {
    if (out.length >= limit) return false;

    const $anchor = $(element);
    const url = absoluteUrl(searchUrl, $anchor.attr('href') || '');
    if (!isLikelyProductUrl(url, {
      domains: support.domains,
      productUrlPattern,
    })) return undefined;

    const structuredContainer = $anchor.closest([
      'article',
      'li',
      '[data-testid*="product"]',
      '[class*="product"]',
      '[class*="Product"]',
      '[class*="card"]',
      '[class*="Card"]',
    ].join(','));
    const container = structuredContainer.length > 0 ? structuredContainer : $anchor.parent();
    const context = compactText(container.text(), 800);
    const title = compactText($anchor.text()) || compactText(context, 120);
    const price = firstPrice(container, GENERIC_PRICE_SELECTORS);
    if (!title || !Number.isFinite(price) || price <= 0) return undefined;

    const key = `${title}:${url}`;
    if (seen.has(key)) return undefined;
    seen.add(key);

    out.push({
      offer_id: `${storeId}:${shortHash(url)}`,
      store_id: storeId,
      store: support.store,
      title,
      url,
      price,
      position: out.length + 1,
      source: 'search-anchor',
    });
    return undefined;
  });

  return out;
}

function makeAdapter(config) {
  return {
    id: config.id,
    buildSearchUrl(query) {
      return config.buildSearchUrl(query);
    },
    extractSearchResults({ html, searchUrl }) {
      const structuredResults = config.extractStructured?.({ html, searchUrl }) || [];
      if (structuredResults.length > 0) return structuredResults;
      const cardResults = extractByCards({
        html,
        searchUrl,
        storeId: config.id,
        ...config.extract,
      });
      if (cardResults.length > 0) return cardResults;
      return extractGenericAnchors({
        html,
        searchUrl,
        storeId: config.id,
        productUrlPattern: config.extract.productUrlPattern,
      });
    },
    classifySearchFailure(html) {
      const text = String(html || '');
      const blockMarker = [
        /\bcaptcha\b/i,
        /\brobot\s+check\b/i,
        /\baccess denied\b/i,
        /\bacesso negado\b/i,
        /\bunusual traffic\b/i,
        /\bjust a moment\b/i,
        /\bverifique (?:se |que )?voc[eê] (?:é|e) humano\b/i,
        /\b(?:human|security) verification\b/i,
        /(?:cf-chl-|challenge-platform|cloudflare ray id)/i,
        /(?:[?&]|\b)bm-verify=/i,
      ].map((pattern) => text.match(pattern)?.[0]).find(Boolean);
      if (blockMarker) {
        const normalizedBlockMarker = blockMarker.replace(/^[?&]/, '');
        return {
          error_code: 'captcha_or_block',
          error_detail: `${getStoreSupportById(config.id).store} search blocked or anti-bot page detected (${normalizedBlockMarker})`,
          block_marker: normalizedBlockMarker.toLowerCase(),
        };
      }
      const emptyMarker = text.match(/nenhum produto|n[aã]o encontramos|sem resultado|0 produtos encontrados/i)?.[0];
      if (emptyMarker) {
        return {
          error_code: 'no_search_results',
          error_detail: `${getStoreSupportById(config.id).store} search returned no products (${emptyMarker})`,
          empty_result_marker: emptyMarker.toLowerCase(),
        };
      }
      return null;
    },
  };
}

const configs = [
  {
    id: 'amazon',
    buildSearchUrl: (query) => `https://www.amazon.com.br/s?k=${encodeURIComponent(query)}`,
    extract: {
      cardSelectors: ['[data-component-type="s-search-result"]', '[data-asin][data-index]'],
      titleSelectors: ['h2 span', '.a-size-base-plus', '.a-text-normal'],
      urlSelectors: ['h2 a[href]', 'a.a-link-normal.s-no-outline[href]', 'a[href*="/dp/"]'],
      priceSelectors: ['.a-price .a-offscreen', '.a-offscreen'],
      productUrlPattern: /\/(?:dp|gp\/product)\//i,
    },
  },
  {
    id: 'kabum',
    buildSearchUrl: (query) => `https://www.kabum.com.br/busca/${slugifyQuery(query)}`,
    extractStructured: extractKabumStructuredResults,
    extract: {
      cardSelectors: ['[data-testid="product-card"]', 'article', '.productCard', '.sc-product-card'],
      titleSelectors: ['[data-testid="product-card-name"]', '.nameCard', 'h2', 'h3'],
      urlSelectors: ['a[href*="/produto/"]', 'a[href]'],
      priceSelectors: ['[data-testid="price-current"]', '.finalPrice', '.priceCard', '[class*="price"]'],
      productUrlPattern: /\/produto\//i,
    },
  },
  {
    id: 'mercadolivre',
    buildSearchUrl: (query) => `https://lista.mercadolivre.com.br/${slugifyQuery(query)}`,
    extract: {
      cardSelectors: ['.ui-search-result__wrapper', '.ui-search-result', 'li.ui-search-layout__item'],
      titleSelectors: ['.poly-component__title', '.ui-search-item__title', 'h2', 'h3'],
      urlSelectors: ['a.poly-component__title[href]', 'a.ui-search-link[href]', 'a[href*="/MLB-"]', 'a[href]'],
      priceSelectors: ['.andes-money-amount', '.price-tag', '[class*="price"]'],
      productUrlPattern: /(?:\/MLB-\d+|\/p\/MLB\w+)/i,
    },
  },
  {
    id: 'magalu',
    buildSearchUrl: (query) => `https://www.magazineluiza.com.br/busca/${encodeURIComponent(query).replace(/%20/g, '+')}/`,
    extract: {
      cardSelectors: ['[data-testid="product-card"]', '[data-testid="mod-product-card"]', 'li', 'article'],
      titleSelectors: ['[data-testid="product-title"]', 'h2', 'h3', '[class*="Title"]'],
      urlSelectors: ['a[href*="/p/"]', 'a[href*="/produto/"]', 'a[href]'],
      priceSelectors: ['[data-testid="price-value"]', '[data-testid="product-price"]', '[class*="Price"]'],
      productUrlPattern: /\/(?:p|produto)\//i,
    },
  },
  {
    id: 'shopee',
    buildSearchUrl: (query) => `https://shopee.com.br/search?keyword=${encodeURIComponent(query)}`,
    extract: {
      cardSelectors: ['[data-sqe="item"]', '.shopee-search-item-result__item', 'li', 'article'],
      titleSelectors: ['[data-sqe="name"]', '.line-clamp-2', 'h2', 'h3'],
      urlSelectors: ['a[href*="-i."]', 'a[href]'],
      priceSelectors: ['[class*="price"]', '[data-sqe="price"]'],
      productUrlPattern: /-i\.\d+\.\d+/i,
    },
  },
  {
    id: 'pichau',
    buildSearchUrl: (query) => `https://www.pichau.com.br/search?q=${encodeURIComponent(query)}`,
    extract: {
      cardSelectors: ['[data-testid="product-card"]', '.product-item', '.productCard', 'li', 'article'],
      titleSelectors: ['h2', 'h3', '[class*="name"]', '[class*="title"]'],
      urlSelectors: ['a[href*=".html"]', 'a[href*="/produto"]', 'a[href]'],
      priceSelectors: ['[class*="price"]', '.price'],
      productUrlPattern: /(?:\.html|\/produto)/i,
    },
  },
  {
    id: 'petz',
    buildSearchUrl: (query) => `https://www.petz.com.br/busca?q=${encodeURIComponent(query)}`,
    extract: {
      cardSelectors: ['.product-item', '.shelf-item', '[data-testid="product-card"]', 'li', 'article'],
      titleSelectors: ['h2', 'h3', '[class*="name"]', '[class*="title"]'],
      urlSelectors: ['a[href*="/produto/"]', 'a[href]'],
      priceSelectors: ['[class*="price"]', '.price'],
      productUrlPattern: /\/produto\//i,
    },
  },
];

export const searchStoreAdapters = Object.freeze(configs.map((config) => makeAdapter(config)));

export function getSearchStoreAdapter(storeId) {
  const adapter = searchStoreAdapters.find((item) => item.id === String(storeId || '').trim().toLowerCase());
  if (!adapter) {
    throw new Error(`Unsupported search store: ${storeId}`);
  }
  return adapter;
}
