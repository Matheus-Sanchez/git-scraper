import { load } from 'cheerio';
import { parseBRLValue } from '../utils/price_parse.js';
import {
  classifyCommonStoreFailure,
  pushJsonKeyCandidates,
  pushMetaPriceCandidates,
  pushTextCandidates,
} from './helpers.js';

const MERCADOLIVRE_DOMAINS = ['mercadolivre.com.br'];

function pushMoneyAmountCandidates($, out) {
  const roots = [
    '.ui-pdp-price__second-line .andes-money-amount',
    '.ui-pdp-price__main-container .andes-money-amount',
    '[data-testid="price-part"] .andes-money-amount',
    '.andes-money-amount',
  ];

  for (const selector of roots) {
    $(selector).slice(0, 8).each((_, element) => {
      const $element = $(element);
      const fraction = $element.find('.andes-money-amount__fraction').first().text().trim();
      const cents = $element.find('.andes-money-amount__cents').first().text().trim();
      const text = $element.text().trim();
      const raw = fraction
        ? `${fraction}${cents ? `,${cents}` : ''}`
        : text;
      const parsed = parseBRLValue(raw);

      if (parsed) {
        out.push({
          price: parsed,
          context: `mercadolivre current price ${selector} ${$element.parent().text().slice(0, 180) || text}`,
        });
      }
    });
  }
}

export const mercadolivreAdapter = {
  id: 'mercadolivre',
  matches(domain) {
    return MERCADOLIVRE_DOMAINS.some((item) => domain.endsWith(item));
  },
  getSelectors(product) {
    return {
      adapter_price_css: [
        '.ui-pdp-price__second-line .andes-money-amount',
        '.ui-pdp-price__main-container .andes-money-amount',
        '[data-testid="price-part"] .andes-money-amount',
        '[itemprop="price"]',
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
      waitUntil: 'domcontentloaded',
      postWaitMs: 2800,
      scroll: true,
    };
  },
  extractCandidates({ html }) {
    const $ = load(String(html || ''));
    const out = [];

    pushMetaPriceCandidates($, out, 'mercadolivre current price');
    pushTextCandidates($, [
      '[data-testid="price-part"]',
      '.ui-pdp-price__second-line',
      '.ui-pdp-price__main-container',
      '.ui-pdp-container__row--price',
    ], out, 'mercadolivre current price');
    pushMoneyAmountCandidates($, out);
    pushJsonKeyCandidates(html, [
      'price',
      'priceAmount',
      'amount',
      'value',
      'lowPrice',
    ], out, 'mercadolivre current price');

    return out;
  },
  classifyFailure({ html }) {
    const commonFailure = classifyCommonStoreFailure(html, 'Mercado Livre');
    if (commonFailure) return commonFailure;

    const text = String(html || '');
    if (/an[uú]ncio pausado|publica[cç][aã]o finalizada|pausamos este an[uú]ncio/i.test(text)) {
      return {
        error_code: 'product_unavailable',
        error_detail: 'Mercado Livre listing is paused or finished',
      };
    }

    return null;
  },
  postProcess(result) {
    return result;
  },
};
