import axios from 'axios';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { extractPriceFromHtml } from '../extract/extract_price.js';
import { sleep } from '../utils/pool.js';
import { normalizeUrl } from '../utils/url.js';
import { getAdapterForUrl } from '../adapters/index.js';
import { roundTo2 } from '../utils/price_parse.js';

const ENGINE_NAME = 'engine3_hardmode';

function compactErrorMessage(error) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .split('\n')[0]
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
}

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

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function stealthScroll(page) {
  const steps = randomBetween(5, 10);
  for (let i = 0; i < steps; i += 1) {
    const delta = randomBetween(350, 900);
    await page.mouse.wheel(0, delta);
    await sleep(randomBetween(130, 420));
  }
}

async function fetchViaProvider(url, env, logger) {
  if (!env.SCRAPING_API_KEY) return null;

  try {
    const response = await axios.get('https://api.zenrows.com/v1/', {
      timeout: env.HTTP_TIMEOUT_MS + 20000,
      params: {
        apikey: env.SCRAPING_API_KEY,
        url,
        js_render: 'true',
        premium_proxy: 'false',
      },
      headers: {
        'user-agent': env.USER_AGENT,
      },
    });

    if (typeof response.data === 'string' && response.data.length > 120) {
      return response.data;
    }

    return null;
  } catch (error) {
    logger.debug('External provider fallback failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function runSingle(page, product, env, logger) {
  const url = normalizeUrl(product.url);
  const adapter = getAdapterForUrl(url);
  const selectors = adapter.getSelectors(product);
  const waitOptions = adapter.getWaitOptions(ENGINE_NAME);

  await page.goto(url, {
    waitUntil: waitOptions.waitUntil,
    timeout: env.HTTP_TIMEOUT_MS + 25000,
  });

  await sleep(randomBetween(800, 1800));

  if (waitOptions.scroll) {
    await stealthScroll(page);
  }

  await sleep(waitOptions.postWaitMs + randomBetween(800, 1900));

  const html = await page.content();
  const adapterCandidates = adapter.extractCandidates({ html, product });

  const extraction = extractPriceFromHtml({
    html,
    selectors,
    adapterCandidates,
    adapterName: adapter.id,
  });

  if (extraction.ok) {
    return {
      ok: true,
      result: adapter.postProcess(buildSnapshot(product, extraction), {
        html,
        extraction,
        product,
      }),
    };
  }

  const providerHtml = await fetchViaProvider(url, env, logger);
  if (!providerHtml) {
    return {
      ok: false,
      error: extraction.reason || 'price_not_found',
    };
  }

  const providerExtraction = extractPriceFromHtml({
    html: providerHtml,
    selectors,
    adapterCandidates: adapter.extractCandidates({ html: providerHtml, product }),
    adapterName: adapter.id,
  });

  if (!providerExtraction.ok) {
    return {
      ok: false,
      error: providerExtraction.reason || 'provider_price_not_found',
    };
  }

  const snapshot = adapter.postProcess(buildSnapshot(product, providerExtraction), {
    html: providerHtml,
    extraction: providerExtraction,
    product,
  });

  return {
    ok: true,
    result: {
      ...snapshot,
      source: `${snapshot.source}+provider`,
      confidence: Math.min(0.99, roundTo2(snapshot.confidence + 0.03)),
    },
  };
}

export async function runEngine3(products, { env, logger }) {
  if (products.length === 0) return [];

  const log = logger.child(ENGINE_NAME);
  const profileDir = resolve(process.cwd(), '.cache', 'pw-profile');

  await mkdir(profileDir, { recursive: true });

  const launchOptions = {
    headless: true,
    userAgent: env.USER_AGENT,
    locale: 'pt-BR',
    viewport: { width: 1440, height: 920 },
    timezoneId: 'America/Sao_Paulo',
  };

  if (env.PROXY_URL) {
    launchOptions.proxy = { server: env.PROXY_URL };
  }

  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, launchOptions);
  } catch (error) {
    const message = compactErrorMessage(error);
    log.warn('Engine3 persistent context launch failed', { error: message });
    return products.map((product) => ({
      product,
      engine: ENGINE_NAME,
      ok: false,
      elapsed_ms: 0,
      error: `persistent_context_launch_failed: ${message}`,
    }));
  }

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  try {
    const attempts = [];

    for (const product of products) {
      const startedAt = Date.now();
      const page = await context.newPage();

      try {
        const outcome = await runSingle(page, product, env, log);
        const elapsedMs = Date.now() - startedAt;

        if (!outcome.ok) {
          attempts.push({
            product,
            engine: ENGINE_NAME,
            ok: false,
            elapsed_ms: elapsedMs,
            error: outcome.error,
          });

          log.product('warn', product, 'Engine3 failed', {
            error: outcome.error,
            elapsed_ms: elapsedMs,
          });
        } else {
          attempts.push({
            product,
            engine: ENGINE_NAME,
            ok: true,
            elapsed_ms: elapsedMs,
            result: outcome.result,
          });

          log.product('info', product, 'Engine3 success', {
            price: outcome.result.price,
            source: outcome.result.source,
            confidence: outcome.result.confidence,
            elapsed_ms: elapsedMs,
          });
        }
      } catch (error) {
        const elapsedMs = Date.now() - startedAt;
        const message = error instanceof Error ? error.message : String(error);

        attempts.push({
          product,
          engine: ENGINE_NAME,
          ok: false,
          elapsed_ms: elapsedMs,
          error: message,
        });

        log.product('warn', product, 'Engine3 exception', { error: message, elapsed_ms: elapsedMs });
      } finally {
        await page.close().catch(() => undefined);
      }
    }

    return attempts;
  } finally {
    await context.close();
  }
}
