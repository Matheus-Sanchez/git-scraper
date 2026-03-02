import { chromium } from 'playwright';
import { extractPriceFromHtml } from '../extract/extract_price.js';
import { runWithPool, sleep } from '../utils/pool.js';
import { normalizeUrl } from '../utils/url.js';
import { getAdapterForUrl } from '../adapters/index.js';
import { roundTo2 } from '../utils/price_parse.js';

const ENGINE_NAME = 'engine2_browser';

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

export async function runEngine2(products, { env, logger }) {
  if (products.length === 0) return [];

  const log = logger.child(ENGINE_NAME);
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn('Engine2 browser launch failed', { error: message });
    return products.map((product) => ({
      product,
      engine: ENGINE_NAME,
      ok: false,
      elapsed_ms: 0,
      error: `browser_launch_failed: ${message}`,
    }));
  }

  try {
    const attempts = await runWithPool(products, env.CONCURRENCY, async (product) => {
      const startedAt = Date.now();
      let context;

      try {
        const url = normalizeUrl(product.url);
        const adapter = getAdapterForUrl(url);
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

        const page = await context.newPage();
        await page.goto(url, {
          waitUntil: waitOptions.waitUntil,
          timeout: env.HTTP_TIMEOUT_MS + 12000,
        });

        if (waitOptions.scroll) {
          await maybeScroll(page);
        }

        await sleep(waitOptions.postWaitMs || 1200);

        const html = await page.content();
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
          result,
        };
      } catch (error) {
        const elapsedMs = Date.now() - startedAt;
        const message = error instanceof Error ? error.message : String(error);

        log.product('warn', product, 'Engine2 failed', { error: message, elapsed_ms: elapsedMs });

        return {
          product,
          engine: ENGINE_NAME,
          ok: false,
          elapsed_ms: elapsedMs,
          error: message,
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
