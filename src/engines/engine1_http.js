import axios from 'axios';
import { extractPriceFromHtml } from '../extract/extract_price.js';
import { runWithPool } from '../utils/pool.js';
import { normalizeUrl } from '../utils/url.js';
import { getAdapterForUrl } from '../adapters/index.js';
import { roundTo2 } from '../utils/price_parse.js';

const ENGINE_NAME = 'engine1_http';

function buildSnapshot(product, extraction) {
  const units = Number(product.units_per_package);
  const unitPrice = Number.isFinite(units) && units > 0 ? roundTo2(extraction.price / units) : null;

  return {
    product_id: product.id,
    url: product.url,
    name: product.name,
    price: extraction.price,
    currency: 'BRL',
    unit_price: unitPrice,
    engine_used: ENGINE_NAME,
    fetched_at: new Date().toISOString(),
    source: extraction.source,
    confidence: extraction.confidence,
    status: 'ok',
  };
}

export async function runEngine1(products, { env, logger }) {
  const log = logger.child(ENGINE_NAME);

  const attempts = await runWithPool(products, env.CONCURRENCY, async (product) => {
    const startedAt = Date.now();

    try {
      const url = normalizeUrl(product.url);
      const adapter = getAdapterForUrl(url);
      const selectors = adapter.getSelectors(product);

      log.product('debug', product, 'Engine1 fetching product', { adapter: adapter.id });

      const response = await axios.get(url, {
        timeout: env.HTTP_TIMEOUT_MS,
        headers: {
          'user-agent': env.USER_AGENT,
          'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        maxRedirects: 5,
        validateStatus: (status) => status >= 200 && status < 400,
      });

      const html = String(response.data || '');
      const adapterCandidates = adapter.extractCandidates({ html, product });
      const extraction = extractPriceFromHtml({
        html,
        selectors,
        adapterCandidates,
        adapterName: adapter.id,
      });

      const elapsedMs = Date.now() - startedAt;
      if (!extraction.ok) {
        return {
          product,
          engine: ENGINE_NAME,
          ok: false,
          elapsed_ms: elapsedMs,
          error: extraction.reason || 'price_not_found',
        };
      }

      const result = adapter.postProcess(buildSnapshot(product, extraction), {
        html,
        extraction,
        product,
      });

      log.product('info', product, 'Engine1 success', {
        price: result.price,
        source: result.source,
        confidence: result.confidence,
        elapsed_ms: elapsedMs,
      });

      return {
        product,
        engine: ENGINE_NAME,
        ok: true,
        elapsed_ms: elapsedMs,
        result,
      };
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);

      log.product('warn', product, 'Engine1 failed', { error: message, elapsed_ms: elapsedMs });

      return {
        product,
        engine: ENGINE_NAME,
        ok: false,
        elapsed_ms: elapsedMs,
        error: message,
      };
    }
  });

  return attempts;
}