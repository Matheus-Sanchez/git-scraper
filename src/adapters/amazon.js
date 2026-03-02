import { load } from 'cheerio';
import { parseBRLValue } from '../utils/price_parse.js';

const AMAZON_DOMAINS = ['amazon.com.br', 'amazon.com'];

export const amazonAdapter = {
  id: 'amazon',
  matches(domain) {
    return AMAZON_DOMAINS.some((item) => domain.endsWith(item));
  },
  getSelectors(product) {
    return {
      adapter_price_css: [
        '#corePriceDisplay_desktop_feature_div .a-offscreen',
        '#corePrice_feature_div .a-offscreen',
        '.a-price .a-offscreen',
        '#price_inside_buybox',
        '#priceblock_ourprice',
        '#priceblock_dealprice',
      ],
      price_css: product?.selectors?.price_css || [],
      jsonld_paths: product?.selectors?.jsonld_paths || [
        'offers.price',
        'offers[0].price',
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
      waitUntil: 'load',
      postWaitMs: 3500,
      scroll: true,
    };
  },
  extractCandidates({ html }) {
    const $ = load(String(html || ''));
    const out = [];

    const roots = [
      '#corePriceDisplay_desktop_feature_div',
      '#corePrice_feature_div',
      '#apex_desktop',
      '#apex_offerDisplay_desktop',
      '#desktop_buybox',
    ];

    const rootSelection = roots.join(',');
    const scopedPrices = $(rootSelection).find('.a-price');
    const priceElements = scopedPrices.length > 0 ? scopedPrices : $('.a-price').slice(0, 6);

    priceElements.each((_, element) => {
      const offscreen = $(element).find('.a-offscreen').first().text().trim();
      if (offscreen) {
        out.push({
          raw: offscreen,
          context: `${$(element).closest(rootSelection).attr('id') || 'a-price'} ${$(element).text().slice(0, 180)}`,
        });
      }

      const whole = $(element).find('.a-price-whole').first().text().trim();
      const fraction = $(element).find('.a-price-fraction').first().text().trim();
      if (whole && fraction) {
        const normalized = `${whole.replace(/\./g, '').replace(/,/g, '')},${fraction}`;
        const parsed = parseBRLValue(normalized);
        if (parsed) {
          out.push({
            price: parsed,
            context: `whole+fraction ${whole},${fraction}`,
          });
        }
      }
    });

    return out;
  },
  postProcess(result) {
    return result;
  },
};
