import { load } from 'cheerio';
import { roundTo2 } from '../utils/price_parse.js';
import {
  classifyCommonStoreFailure,
  pushJsonKeyCandidates,
  pushMetaPriceCandidates,
  pushTextCandidates,
} from './helpers.js';

const SHOPEE_DOMAINS = ['shopee.com.br'];

function parseShopeeScaledPrice(raw) {
  const numeric = Number(String(raw || '').replace(',', '.'));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  if (numeric >= 100000) return roundTo2(numeric / 100000);
  return null;
}

export const shopeeAdapter = {
  id: 'shopee',
  matches(domain) {
    return SHOPEE_DOMAINS.some((item) => domain.endsWith(item));
  },
  getSelectors(product) {
    return {
      adapter_price_css: [
        '[data-testid="lblPDPDetailProductPrice"]',
        '[data-testid*="ProductPrice"]',
        '[class*="product-price"]',
        '[class*="ProductPrice"]',
        '[class*="price"]',
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
        postWaitMs: 2600,
        scroll: true,
      };
    }

    return {
      waitUntil: 'networkidle',
      postWaitMs: 4200,
      scroll: true,
    };
  },
  extractCandidates({ html }) {
    const $ = load(String(html || ''));
    const out = [];

    pushMetaPriceCandidates($, out, 'shopee current price');
    pushTextCandidates($, [
      '[data-testid="lblPDPDetailProductPrice"]',
      '[data-testid*="ProductPrice"]',
      '[class*="ProductPrice"]',
      '[class*="product-price"]',
      '[class*="price"]',
    ], out, 'shopee current price', { limit: 10 });
    pushJsonKeyCandidates(html, [
      'price',
      'price_min',
      'price_max',
      'price_before_discount',
    ], out, 'shopee current price', {
      scale: parseShopeeScaledPrice,
      limit: 20,
    });

    return out;
  },
  classifyFailure({ html }) {
    const commonFailure = classifyCommonStoreFailure(html, 'Shopee');
    if (commonFailure) return commonFailure;

    const text = String(html || '');
    if (/produto foi removido|item n[aã]o existe|n[aã]o encontramos este produto/i.test(text)) {
      return {
        error_code: 'product_unavailable',
        error_detail: 'Shopee product was removed or is unavailable',
      };
    }

    return null;
  },
  postProcess(result) {
    return result;
  },
};
