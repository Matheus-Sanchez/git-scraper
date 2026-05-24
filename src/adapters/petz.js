import { load } from 'cheerio';
import {
  classifyCommonStoreFailure,
  pushJsonKeyCandidates,
  pushMetaPriceCandidates,
  pushTextCandidates,
} from './helpers.js';

const PETZ_DOMAINS = ['petz.com.br'];

export const petzAdapter = {
  id: 'petz',
  matches(domain) {
    return PETZ_DOMAINS.some((item) => domain.endsWith(item));
  },
  getSelectors(product) {
    return {
      adapter_price_css: [
        '[data-testid="product-price"]',
        '[data-cy="product-price"]',
        '.current-price',
        '.product-price',
        '.price',
      ],
      price_css: product?.selectors?.price_css || [],
      jsonld_paths: product?.selectors?.jsonld_paths || [
        'offers.price',
        'offers[0].price',
        'price',
      ],
      regex_hints: product?.selectors?.regex_hints || [],
    };
  },
  getWaitOptions(engineName) {
    if (engineName === 'engine2_browser') {
      return {
        waitUntil: 'domcontentloaded',
        postWaitMs: 1800,
        scroll: true,
      };
    }

    return {
      waitUntil: 'networkidle',
      postWaitMs: 3200,
      scroll: true,
    };
  },
  extractCandidates({ html }) {
    const $ = load(String(html || ''));
    const out = [];

    pushMetaPriceCandidates($, out, 'petz current price');
    pushTextCandidates($, [
      '[data-testid="product-price"]',
      '[data-cy="product-price"]',
      '[class*="ProductPrice"]',
      '.current-price',
      '.product-price',
      '.price',
    ], out, 'petz current price');
    pushJsonKeyCandidates(html, [
      'price',
      'bestPrice',
      'salePrice',
      'lowPrice',
    ], out, 'petz current price');

    return out;
  },
  classifyFailure({ html }) {
    const commonFailure = classifyCommonStoreFailure(html, 'Petz');
    if (commonFailure) return commonFailure;

    const text = String(html || '');
    if (/produto indispon[ií]vel|n[aã]o temos este produto|avise-me/i.test(text)) {
      return {
        error_code: 'price_not_found',
        error_detail: 'Petz page indicates unavailable or out-of-stock state',
      };
    }

    return null;
  },
  postProcess(result) {
    return result;
  },
};
