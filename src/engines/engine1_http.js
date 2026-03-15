import axios from 'axios';
import { extractPriceFromHtml } from '../extract/extract_price.js';
import { runWithPool, sleep } from '../utils/pool.js';
import { normalizeUrl } from '../utils/url.js';
import { getAdapterForUrl } from '../adapters/index.js';
import { roundTo2 } from '../utils/price_parse.js';
import {
  classifyAxiosFailure,
  classifyExtractionFailure,
  isRetryableFailure,
  mergeFailureMetadata,
} from '../utils/failure.js';

const ENGINE_NAME = 'engine1_http';
const MAX_HTTP_RETRIES = 2;

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

function buildResponseMetadata(response, fallbackUrl) {
  const html = typeof response?.data === 'string' ? response.data : '';
  return {
    http_status: Number(response?.status || 0) || undefined,
    final_url: response?.request?.res?.responseUrl || fallbackUrl,
    content_type: response?.headers?.['content-type'] || undefined,
    html_size: html.length || undefined,
  };
}

function classifyAdapterFailure(adapter, context, fallbackFailure) {
  if (typeof adapter?.classifyFailure !== 'function') {
    return fallbackFailure;
  }

  const adapterFailure = adapter.classifyFailure(context);
  if (!adapterFailure) {
    return fallbackFailure;
  }

  return mergeFailureMetadata(fallbackFailure, {
    error_code: adapterFailure.error_code || fallbackFailure.error_code,
    error_detail: adapterFailure.error_detail || fallbackFailure.error_detail,
    error: adapterFailure.error_detail || fallbackFailure.error,
  });
}

function retryDelayMs(attemptNumber) {
  const base = 280 * (attemptNumber + 1);
  const jitter = Math.floor(Math.random() * 220);
  return base + jitter;
}

export async function runEngine1(products, { env, logger }) {
  const log = logger.child(ENGINE_NAME);

  const attempts = await runWithPool(products, env.CONCURRENCY, async (product) => {
    const startedAt = Date.now();
    const retryAttempts = [];
    let finalFailure = null;

    const url = normalizeUrl(product.url);
    const adapter = getAdapterForUrl(url);
    const selectors = adapter.getSelectors(product);

    log.product('debug', product, 'Engine1 fetching product', { adapter: adapter.id });

    for (let attemptIndex = 0; attemptIndex <= MAX_HTTP_RETRIES; attemptIndex += 1) {
      try {
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
        const responseMetadata = buildResponseMetadata(response, url);
        const adapterCandidates = adapter.extractCandidates({ html, product });
        const extraction = extractPriceFromHtml({
          html,
          selectors,
          adapterCandidates,
          adapterName: adapter.id,
        });

        if (!extraction.ok) {
          finalFailure = classifyAdapterFailure(
            adapter,
            { html, product, extraction, engineName: ENGINE_NAME },
            classifyExtractionFailure(extraction, responseMetadata),
          );
          retryAttempts.push({
            attempt: attemptIndex + 1,
            ...finalFailure,
          });
        } else {
          const elapsedMs = Date.now() - startedAt;
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
            retries: attemptIndex,
          });

          return {
            product,
            engine: ENGINE_NAME,
            ok: true,
            elapsed_ms: elapsedMs,
            retry_attempts: retryAttempts,
            result,
          };
        }
      } catch (error) {
        finalFailure = classifyAxiosFailure(error, { final_url: url });
        retryAttempts.push({
          attempt: attemptIndex + 1,
          ...finalFailure,
        });
      }

      if (!isRetryableFailure(finalFailure) || attemptIndex === MAX_HTTP_RETRIES) {
        break;
      }

      await sleep(retryDelayMs(attemptIndex));
    }

    const elapsedMs = Date.now() - startedAt;
    const failure = finalFailure || {
      error: 'unexpected_error',
      error_code: 'unexpected_error',
      error_detail: 'unexpected_error',
    };

    log.product('warn', product, 'Engine1 failed', {
      error: failure.error_detail || failure.error,
      error_code: failure.error_code,
      elapsed_ms: elapsedMs,
      retries: retryAttempts.length > 1 ? retryAttempts.length - 1 : 0,
    });

    return {
      product,
      engine: ENGINE_NAME,
      ok: false,
      elapsed_ms: elapsedMs,
      retry_attempts: retryAttempts,
      ...failure,
    };
  });

  return attempts;
}
