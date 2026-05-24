import { parseBRLValue, roundTo2 } from '../utils/price_parse.js';

function compactContext(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 220);
}

function addCandidate(out, { price, raw, context }) {
  const parsedPrice = Number.isFinite(price) ? roundTo2(price) : parseBRLValue(raw);
  if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) return;

  out.push({
    price: parsedPrice,
    raw,
    context: compactContext(context),
  });
}

export function pushTextCandidates($, selectors, out, contextPrefix, { limit = 6 } = {}) {
  for (const selector of selectors) {
    let elements;
    try {
      elements = $(selector).slice(0, limit);
    } catch {
      continue;
    }

    elements.each((_, element) => {
      const text = $(element).text().trim();
      const content = $(element).attr('content') || $(element).attr('value') || $(element).attr('data-price-amount') || '';
      const context = `${contextPrefix} ${selector} ${$(element).parent().text().slice(0, 180)} ${text}`;

      addCandidate(out, {
        raw: content || text,
        context,
      });
    });
  }
}

export function pushMetaPriceCandidates($, out, contextPrefix) {
  pushTextCandidates($, [
    'meta[property="product:price:amount"]',
    'meta[property="og:price:amount"]',
    'meta[name="price"]',
    'meta[name="price:amount"]',
    'meta[itemprop="price"]',
  ], out, contextPrefix);
}

export function pushJsonKeyCandidates(html, keys, out, contextPrefix, {
  scale = null,
  limit = 16,
} = {}) {
  const source = String(html || '');
  if (!source.trim() || !Array.isArray(keys) || keys.length === 0) return;

  const escapedKeys = keys.map((key) => String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const pattern = new RegExp(`["'](?:${escapedKeys})["']\\s*:\\s*["']?(-?\\d+(?:[.,]\\d+)?)["']?`, 'gi');
  let count = 0;

  for (const match of source.matchAll(pattern)) {
    if (count >= limit) break;
    const raw = match[1];
    const scaled = typeof scale === 'function' ? scale(raw) : null;
    addCandidate(out, {
      raw,
      price: scaled,
      context: `${contextPrefix} structured key ${match[0].slice(0, 80)}`,
    });
    count += 1;
  }
}

export function classifyCommonStoreFailure(html, storeName) {
  const text = String(html || '');

  if (/captcha|robot|access denied|acesso negado|cloudflare|verifica[cç][aã]o|unusual traffic/i.test(text)) {
    return {
      error_code: 'captcha_or_block',
      error_detail: `${storeName} anti-bot or blocked page detected`,
    };
  }

  if (/produto indispon[ií]vel|fora de estoque|sem estoque|esgotad[oa]|n[aã]o dispon[ií]vel/i.test(text)) {
    return {
      error_code: 'price_not_found',
      error_detail: `${storeName} page indicates unavailable or out-of-stock state`,
    };
  }

  if (/produto n[aã]o encontrado|p[aá]gina n[aã]o encontrada|an[uú]ncio finalizado|an[uú]ncio pausado/i.test(text)) {
    return {
      error_code: 'product_unavailable',
      error_detail: `${storeName} page indicates the product listing is unavailable`,
    };
  }

  if (/selecione|escolha|varia[cç][aã]o|tamanho|cor/i.test(text) && /pre[cç]o|comprar|produto/i.test(text)) {
    return {
      error_code: 'variation_required',
      error_detail: `${storeName} page may require selecting a variation before price is final`,
    };
  }

  return null;
}
