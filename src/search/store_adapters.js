import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { extractNumericTokens, parseBRLValue } from '../utils/price_parse.js';
import { getStoreSupportById } from '../config/support_matrix.js';
import { slugifyQuery } from './text.js';

function shortHash(value) {
  return createHash('sha1').update(String(value || '')).digest('hex').slice(0, 10);
}

function absoluteUrl(baseUrl, href) {
  const rawHref = String(href || '').trim();
  if (!rawHref || rawHref === '#' || /^javascript:/i.test(rawHref)) return '';

  try {
    return new URL(rawHref, baseUrl).toString();
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

function firstPrice($root, selectors) {
  for (const selector of selectors) {
    const text = compactText($root.find(selector).first().text());
    const content = $root.find(selector).first().attr('content') || '';
    const parsed = parsePriceFromText(content || text);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  const parsed = parsePriceFromText(compactText($root.text(), 800));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parsePriceFromText(text) {
  const tokens = extractNumericTokens(text);
  for (const token of tokens) {
    const parsed = parseBRLValue(token);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return parseBRLValue(text);
}

function isLikelyProductUrl(url, { domains, productUrlPattern }) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    if (!domains.some((domain) => hostname.endsWith(domain))) return false;
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

    const container = $anchor.closest('article,li,div,section');
    const context = container.length > 0 ? container.text() : $anchor.parent().text();
    const title = compactText($anchor.text()) || compactText(context, 120);
    const price = parsePriceFromText(context);
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
      if (/captcha|robot|access denied|acesso negado|cloudflare|verifica[cç][aã]o|unusual traffic/i.test(text)) {
        return {
          error_code: 'captcha_or_block',
          error_detail: `${getStoreSupportById(config.id).store} search blocked or anti-bot page detected`,
        };
      }
      if (/nenhum produto|n[aã]o encontramos|sem resultado|0 produtos encontrados/i.test(text)) {
        return {
          error_code: 'no_search_results',
          error_detail: `${getStoreSupportById(config.id).store} search returned no products`,
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
