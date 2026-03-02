const GENERIC_SELECTOR_CANDIDATES = [
  '[data-testid*="price"]',
  '[class*="price"]',
  '[id*="price"]',
  '.price-value',
  '.current-price',
  '.sale-price',
  '.bestPrice',
  '.valor',
  '.preco',
];

export const genericAdapter = {
  id: 'generic',
  matches() {
    return true;
  },
  getSelectors(product) {
    return {
      adapter_price_css: GENERIC_SELECTOR_CANDIDATES,
      price_css: product?.selectors?.price_css || [],
      jsonld_paths: product?.selectors?.jsonld_paths || [
        'offers.price',
        'offers[0].price',
        'price',
        'lowPrice',
      ],
      regex_hints: product?.selectors?.regex_hints || [],
    };
  },
  getWaitOptions(engineName) {
    if (engineName === 'engine2_browser') {
      return {
        waitUntil: 'domcontentloaded',
        postWaitMs: 1200,
        scroll: false,
      };
    }

    return {
      waitUntil: 'domcontentloaded',
      postWaitMs: 2500,
      scroll: true,
    };
  },
  extractCandidates() {
    return [];
  },
  postProcess(result) {
    return result;
  },
};