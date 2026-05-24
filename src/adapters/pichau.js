import { load } from 'cheerio';
import {
  classifyCommonStoreFailure,
  pushJsonKeyCandidates,
  pushMetaPriceCandidates,
  pushTextCandidates,
} from './helpers.js';

const PICHAU_DOMAINS = ['pichau.com.br'];

export const pichauAdapter = {
  id: 'pichau',
  matches(domain) {
    return PICHAU_DOMAINS.some((item) => domain.endsWith(item));
  },
  getSelectors(product) {
    return {
      adapter_price_css: [
        '[data-price-type="finalPrice"]',
        '[data-price-amount]',
        '.product-info-price .price',
        '.price-box .price',
        '.final-price',
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
        postWaitMs: 1700,
        scroll: true,
      };
    }

    return {
      waitUntil: 'domcontentloaded',
      postWaitMs: 2800,
      scroll: true,
    };
  },
  extractCandidates({ html }) {
    const $ = load(String(html || ''));
    const out = [];

    pushMetaPriceCandidates($, out, 'pichau current price');
    pushTextCandidates($, [
      '[data-price-type="finalPrice"]',
      '[data-price-amount]',
      '.product-info-price',
      '.price-box',
      '.final-price',
      '.price',
    ], out, 'pichau current price');
    pushJsonKeyCandidates(html, [
      'price',
      'finalPrice',
      'specialPrice',
      'lowPrice',
    ], out, 'pichau current price');

    return out;
  },
  classifyFailure({ html }) {
    const commonFailure = classifyCommonStoreFailure(html, 'Pichau');
    if (commonFailure) return commonFailure;

    const text = String(html || '');
    if (/produto esgotado|notify me|avise-me/i.test(text)) {
      return {
        error_code: 'price_not_found',
        error_detail: 'Pichau page indicates unavailable or out-of-stock state',
      };
    }

    return null;
  },
  postProcess(result) {
    return result;
  },
};
