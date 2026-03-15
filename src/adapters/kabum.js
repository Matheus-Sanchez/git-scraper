import { load } from 'cheerio';
import { parseBRLValue } from '../utils/price_parse.js';

const KABUM_DOMAINS = ['kabum.com.br'];

export const kabumAdapter = {
  id: 'kabum',
  matches(domain) {
    return KABUM_DOMAINS.some((item) => domain.endsWith(item));
  },
  getSelectors(product) {
    return {
      adapter_price_css: [
        '[data-testid="price-current"]',
        '.finalPrice',
        '.priceCard',
        '.priceArea',
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
        postWaitMs: 1500,
        scroll: true,
      };
    }

    return {
      waitUntil: 'domcontentloaded',
      postWaitMs: 2200,
      scroll: true,
    };
  },
  extractCandidates({ html }) {
    const $ = load(String(html || ''));
    const out = [];

    [
      '[data-testid="price-current"]',
      '.finalPrice',
      '.priceCard',
    ].forEach((selector) => {
      $(selector).slice(0, 5).each((_, element) => {
        const text = $(element).text().trim();
        const parsed = parseBRLValue(text);
        if (parsed) {
          out.push({
            price: parsed,
            context: `${selector} ${text}`.slice(0, 220),
          });
        }
      });
    });

    return out;
  },
  classifyFailure({ html }) {
    const text = String(html || '');

    if (/indisponivel|produto indisponivel|esgotado/i.test(text)) {
      return {
        error_code: 'price_not_found',
        error_detail: 'Kabum page indicates unavailable or out-of-stock state',
      };
    }

    return null;
  },
  postProcess(result) {
    return result;
  },
};
