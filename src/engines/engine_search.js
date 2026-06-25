import { chromium } from 'playwright';
import { runWithPool, sleep } from '../utils/pool.js';
import { classifyPlaywrightFailure, mergeFailureMetadata } from '../utils/failure.js';
import { getSearchStoreAdapter } from '../search/store_adapters.js';
import { buildSearchQuery } from '../search/text.js';
import { rankOffersForIntent } from '../search/ranking.js';

const LIGHTPANDA_ENGINE = 'lightpanda_search';
const CHROMIUM_ENGINE = 'chromium_search';

function toFailure(errorCode, errorDetail, metadata = {}) {
  return {
    error: errorDetail,
    error_code: errorCode,
    error_detail: errorDetail,
    ...Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined && value !== null && value !== '')),
  };
}

function buildBestResult(intent, bestOffer, engineName) {
  return {
    product_id: intent.id,
    intent_id: intent.id,
    name: intent.name,
    characteristics: intent.characteristics || '',
    category: intent.category || null,
    store_id: bestOffer.store_id,
    store: bestOffer.store,
    title: bestOffer.title,
    url: bestOffer.url,
    price: bestOffer.price,
    currency: 'BRL',
    unit_price: bestOffer.unit_price,
    unit_basis: bestOffer.unit_basis,
    normalized_quantity: bestOffer.normalized_quantity,
    attributes: bestOffer.attributes,
    match_score: bestOffer.match_score,
    priority_score: bestOffer.priority_score,
    engine_used: engineName,
    fetched_at: bestOffer.fetched_at,
    source: bestOffer.source,
    confidence: bestOffer.match_score,
    status: 'ok',
  };
}

async function newPage(browser, { env, engineName }) {
  const contextOptions = {
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: {
      'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  };

  if (engineName === CHROMIUM_ENGINE && env.USER_AGENT) {
    contextOptions.userAgent = env.USER_AGENT;
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  return { context, page };
}

async function fetchStoreOffers({ browser, intent, storeId, env, engineName, sleepFn }) {
  const adapter = getSearchStoreAdapter(storeId);
  const query = buildSearchQuery(intent);
  const searchUrl = adapter.buildSearchUrl(query);
  const fetchedAt = new Date().toISOString();
  let context;
  let page;

  try {
    ({ context, page } = await newPage(browser, { env, engineName }));
    const response = await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: env.HTTP_TIMEOUT_MS + 10000,
    });
    await sleepFn(900);
    const html = await page.content();

    if (!html.trim()) {
      return {
        offers: [],
        failure: toFailure('empty_search_dom', 'Search page rendered an empty DOM', {
          store_id: storeId,
          search_url: searchUrl,
          http_status: Number(response?.status?.() || 0) || undefined,
        }),
      };
    }

    const rawOffers = adapter.extractSearchResults({ html, searchUrl })
      .map((offer) => ({
        ...offer,
        engine_used: engineName,
        fetched_at: fetchedAt,
      }));

    if (rawOffers.length === 0) {
      const classified = adapter.classifySearchFailure(html);
      return {
        offers: [],
        failure: classified
          ? mergeFailureMetadata(classified, { store_id: storeId, search_url: searchUrl })
          : toFailure('no_search_offers', 'No usable offers were found in the search results', {
            store_id: storeId,
            search_url: searchUrl,
          }),
      };
    }

    return {
      offers: rawOffers,
      failure: null,
    };
  } catch (error) {
    return {
      offers: [],
      failure: mergeFailureMetadata(classifyPlaywrightFailure(error, {
        stage: 'navigation',
        metadata: {
          store_id: storeId,
          search_url: searchUrl,
          final_url: page?.url?.() || searchUrl,
        },
      }), {
        failure_stage: 'search_navigation',
      }),
    };
  } finally {
    if (context) {
      await context.close().catch(() => undefined);
    }
  }
}

async function runWithBrowser(intents, {
  env,
  logger,
  engineName,
  browserFactory,
  sleepFn = sleep,
}) {
  if (intents.length === 0) return [];

  const log = logger.child(engineName);
  let browser;
  try {
    browser = await browserFactory();
  } catch (error) {
    const failure = mergeFailureMetadata(classifyPlaywrightFailure(error, { stage: 'launch' }), {
      failure_stage: 'browser_launch',
    });
    log.warn('Search browser unavailable', {
      engine: engineName,
      error_code: failure.error_code,
      error_detail: failure.error_detail,
    });
    return intents.map((intent) => ({
      product: intent,
      engine: engineName,
      ok: false,
      elapsed_ms: 0,
      ...failure,
    }));
  }

  try {
    const results = await runWithPool(intents, env.CONCURRENCY, async (intent) => {
      const startedAt = Date.now();
      const storeErrors = [];
      const rawOffers = [];

      log.product('debug', intent, 'Searching intent across stores', {
        stores: intent.stores,
      });

      for (const storeId of intent.stores || []) {
        const storeOutcome = await fetchStoreOffers({
          browser,
          intent,
          storeId,
          env,
          engineName,
          sleepFn,
        });

        rawOffers.push(...storeOutcome.offers);
        if (storeOutcome.failure) {
          storeErrors.push(storeOutcome.failure);
        }
      }

      const ranking = rankOffersForIntent(intent, rawOffers, {
        topPerStore: env.SEARCH_TOP_N_PER_STORE,
      });
      const elapsedMs = Date.now() - startedAt;

      if (!ranking.best) {
        return {
          product: intent,
          engine: engineName,
          ok: false,
          elapsed_ms: elapsedMs,
          failure_stage: 'search_rank',
          stores_checked: (intent.stores || []).length,
          offers_checked: ranking.checked_count,
          rejected_offers: ranking.rejected_count,
          store_errors: storeErrors,
          offers: ranking.offers,
          ...toFailure(
            rawOffers.length > 0 ? 'no_matching_offers' : 'no_search_offers',
            rawOffers.length > 0
              ? 'Search returned offers, but none matched the required filters'
              : 'Search did not return usable offers',
          ),
        };
      }

      const result = buildBestResult(intent, ranking.best, engineName);

      log.product('info', intent, 'Search success', {
        store_id: result.store_id,
        price: result.price,
        unit_price: result.unit_price,
        match_score: result.match_score,
        priority_score: result.priority_score,
        elapsed_ms: elapsedMs,
      });

      return {
        product: intent,
        engine: engineName,
        ok: true,
        elapsed_ms: elapsedMs,
        stores_checked: (intent.stores || []).length,
        offers_checked: ranking.checked_count,
        rejected_offers: ranking.rejected_count,
        store_errors: storeErrors,
        result,
        offers: ranking.offers,
      };
    });
    return results;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export async function runSearchEngine(intents, {
  env,
  logger,
  sleepFn = sleep,
  browserFactories = {},
} = {}) {
  const lightpandaAttempts = await runWithBrowser(intents, {
    env,
    logger,
    engineName: LIGHTPANDA_ENGINE,
    sleepFn,
    browserFactory: browserFactories.lightpanda || (() => chromium.connectOverCDP(env.LIGHTPANDA_CDP_URL)),
  });

  const failedIntents = lightpandaAttempts
    .filter((attempt) => !attempt.ok)
    .map((attempt) => attempt.product);

  if (failedIntents.length === 0) {
    return lightpandaAttempts;
  }

  const chromiumAttempts = await runWithBrowser(failedIntents, {
    env,
    logger,
    engineName: CHROMIUM_ENGINE,
    sleepFn,
    browserFactory: browserFactories.chromium || (() => chromium.launch({ headless: true })),
  });

  return [...lightpandaAttempts, ...chromiumAttempts];
}
