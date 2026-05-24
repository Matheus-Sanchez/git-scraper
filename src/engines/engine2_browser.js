import { chromium } from 'playwright';
import { extractPriceFromHtml } from '../extract/extract_price.js';
import { runWithPool, sleep } from '../utils/pool.js';
import { normalizeUrl } from '../utils/url.js';
import { getAdapterForUrl } from '../adapters/index.js';
import { getStoreSupportByUrl } from '../config/support_matrix.js';
import { roundTo2 } from '../utils/price_parse.js';
import {
  classifyExtractionFailure,
  classifyPlaywrightFailure,
  mergeFailureMetadata,
} from '../utils/failure.js';
import {
  prepareDebugArtifactPaths,
  writeFailureArtifacts,
} from '../utils/debug_artifacts.js';

const ENGINE_NAME = 'engine2_browser';

function buildSnapshot(product, extraction, adapterId = null) {
  const units = Number(product.units_per_package);
  const unitPrice = Number.isFinite(units) && units > 0 ? roundTo2(extraction.price / units) : null;
  const support = getStoreSupportByUrl(product.url);

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
    adapter: adapterId || support.adapter,
    store_support_level: support.support_level,
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

async function maybeScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let total = 0;
      const step = 500;
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        total += step;
        if (total >= document.body.scrollHeight + 1200) {
          clearInterval(timer);
          resolve();
        }
      }, 130);
    });
  });
}

export async function runEngine2(products, {
  env,
  logger,
  runId,
  sleepFn = sleep,
} = {}) {
  if (products.length === 0) return [];

  const log = logger.child(ENGINE_NAME);
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
    });
  } catch (error) {
    const failure = classifyPlaywrightFailure(error, { stage: 'launch' });
    log.warn('Engine2 browser launch failed', {
      error: failure.error_detail,
      error_code: failure.error_code,
    });
    return products.map((product) => ({
      product,
      engine: ENGINE_NAME,
      ok: false,
      elapsed_ms: 0,
      adapter: getAdapterForUrl(product.url).id,
      store_support_level: getStoreSupportByUrl(product.url).support_level,
      failure_stage: 'browser_launch',
      ...failure,
    }));
  }

  try {
    const attempts = await runWithPool(products, env.CONCURRENCY, async (product) => {
      const startedAt = Date.now();
      let context;
      let page;
      let adapter = null;
      let html = '';
      let responseMetadata = {};

      try {
        const url = normalizeUrl(product.url);
        adapter = getAdapterForUrl(url);
        const support = getStoreSupportByUrl(url);
        const selectors = adapter.getSelectors(product);
        const waitOptions = adapter.getWaitOptions(ENGINE_NAME);

        context = await browser.newContext({
          userAgent: env.USER_AGENT,
          locale: 'pt-BR',
          viewport: { width: 1366, height: 900 },
          timezoneId: 'America/Sao_Paulo',
          extraHTTPHeaders: {
            'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
          },
        });

        page = await context.newPage();
        const response = await page.goto(url, {
          waitUntil: waitOptions.waitUntil,
          timeout: env.HTTP_TIMEOUT_MS + 12000,
        });
        responseMetadata = {
          http_status: Number(response?.status?.() || 0) || undefined,
          final_url: page.url() || url,
          content_type: response?.headers?.()['content-type'] || undefined,
        };

        if (waitOptions.scroll) {
          await maybeScroll(page);
        }

        await sleepFn(waitOptions.postWaitMs || 1200);

        html = await page.content();
        responseMetadata = {
          ...responseMetadata,
          html_size: html.length || undefined,
        };

        if (!html.trim()) {
          const failure = {
            error: 'Post-render DOM is empty',
            error_code: 'empty_post_render_dom',
            error_detail: 'Post-render DOM is empty',
            ...responseMetadata,
          };
          const paths = await prepareDebugArtifactPaths({
            runId,
            productId: product.id,
            engineName: ENGINE_NAME,
          });
          const artifactDir = await writeFailureArtifacts({
            paths,
            html,
            metadata: {
              ...failure,
              product_id: product.id,
              url,
            },
            page,
          });
          const elapsedMs = Date.now() - startedAt;

          return {
            product,
            engine: ENGINE_NAME,
            ok: false,
            elapsed_ms: elapsedMs,
            artifact_dir: artifactDir,
            adapter: adapter.id,
            store_support_level: support.support_level,
            failure_stage: 'post_render',
            ...failure,
          };
        }

        const adapterCandidates = adapter.extractCandidates({ html, product });

        const extraction = extractPriceFromHtml({
          html,
          selectors,
          adapterCandidates,
          adapterName: adapter.id,
        });

        const elapsedMs = Date.now() - startedAt;
        if (!extraction.ok) {
          const failure = mergeFailureMetadata(classifyAdapterFailure(
            adapter,
            { html, product, extraction, engineName: ENGINE_NAME },
            classifyExtractionFailure(extraction, responseMetadata),
          ), {
            adapter: adapter.id,
            store_support_level: support.support_level,
            failure_stage: 'extract',
          });
          const paths = await prepareDebugArtifactPaths({
            runId,
            productId: product.id,
            engineName: ENGINE_NAME,
          });
          const artifactDir = await writeFailureArtifacts({
            paths,
            html,
            metadata: {
              ...failure,
              product_id: product.id,
              url,
              adapter: adapter.id,
            },
            page,
          });

          return {
            product,
            engine: ENGINE_NAME,
            ok: false,
            elapsed_ms: elapsedMs,
            artifact_dir: artifactDir,
            adapter: adapter.id,
            store_support_level: support.support_level,
            ...failure,
          };
        }

        const result = adapter.postProcess(buildSnapshot(product, extraction, adapter.id), {
          html,
          extraction,
          product,
        });

        log.product('info', product, 'Engine2 success', {
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
          adapter: adapter.id,
          store_support_level: support.support_level,
          result,
        };
      } catch (error) {
        const elapsedMs = Date.now() - startedAt;
        const support = getStoreSupportByUrl(product.url);
        const failure = classifyPlaywrightFailure(error, {
          stage: 'navigation',
          metadata: {
            final_url: page?.url?.() || product.url,
            html_size: html.length || undefined,
            ...responseMetadata,
          },
        });
        let artifactDir = null;

        if (page) {
          try {
            const paths = await prepareDebugArtifactPaths({
              runId,
              productId: product.id,
              engineName: ENGINE_NAME,
            });
            artifactDir = await writeFailureArtifacts({
              paths,
              html: html || await page.content().catch(() => ''),
              metadata: {
                ...failure,
                product_id: product.id,
                url: product.url,
                adapter: adapter?.id || null,
              },
              page,
            });
          } catch {
            artifactDir = null;
          }
        }

        log.product('warn', product, 'Engine2 failed', {
          error: failure.error_detail,
          error_code: failure.error_code,
          elapsed_ms: elapsedMs,
        });

        return {
          product,
          engine: ENGINE_NAME,
          ok: false,
          elapsed_ms: elapsedMs,
          artifact_dir: artifactDir,
          adapter: adapter?.id || getAdapterForUrl(product.url).id,
          store_support_level: support.support_level,
          failure_stage: 'navigation',
          ...failure,
        };
      } finally {
        if (context) {
          await context.close().catch(() => undefined);
        }
      }
    });

    return attempts;
  } finally {
    await browser.close();
  }
}
