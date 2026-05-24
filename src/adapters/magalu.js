import { load } from 'cheerio';
import {
  classifyCommonStoreFailure,
  pushJsonKeyCandidates,
  pushMetaPriceCandidates,
  pushTextCandidates,
} from './helpers.js';

const MAGALU_DOMAINS = ['magazineluiza.com.br', 'magalu.com'];

export const magaluAdapter = {
  id: 'magalu',
  matches(domain) {
    return MAGALU_DOMAINS.some((item) => domain.endsWith(item));
  },
  getSelectors(product) {
    return {
      adapter_price_css: [
        '[data-testid="price-value"]',
        '[data-testid="product-price"]',
        '[data-testid="price-original"] + *',
        '.price-template__text',
        '[class*="Price"] [class*="price"]',
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

    pushMetaPriceCandidates($, out, 'magalu current price');
    pushTextCandidates($, [
      '[data-testid="price-value"]',
      '[data-testid="product-price"]',
      '[data-testid="price-box"]',
      '.price-template__text',
      '[class*="ProductPrice"]',
      '[class*="price-value"]',
    ], out, 'magalu current price');
    pushJsonKeyCandidates(html, [
      'price',
      'bestPrice',
      'priceValue',
      'salePrice',
      'cashPrice',
      'fullPrice',
      'lowPrice',
    ], out, 'magalu current price');

    return out;
  },
  classifyFailure({ html }) {
    const commonFailure = classifyCommonStoreFailure(html, 'Magalu');
    if (commonFailure) return commonFailure;

    const text = String(html || '');
    if (/avise-me|produto sem pre[cç]o|pre[cç]o indispon[ií]vel/i.test(text)) {
      return {
        error_code: 'price_not_found',
        error_detail: 'Magalu page does not expose a current purchasable price',
      };
    }

    return null;
  },
  postProcess(result) {
    return result;
  },
};
