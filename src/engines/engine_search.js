import { chromium } from 'playwright';
import { runWithPool, sleep } from '../utils/pool.js';
import { classifyPlaywrightFailure, mergeFailureMetadata } from '../utils/failure.js';
import { getSearchStoreAdapter } from '../search/store_adapters.js';
import { buildSearchQuery } from '../search/text.js';
import { rankOffersForIntent } from '../search/ranking.js';
import {
  getStoreSupportById,
  isKnownStoreId,
  isSearchEnabledStoreId,
} from '../config/support_matrix.js';

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

function classifyBrowserAvailabilityFailure(error) {
  const detail = error instanceof Error ? error.message : String(error);
  if (/connectOverCDP|WebSocket error|ECONNREFUSED|connection refused/i.test(detail)) {
    return toFailure('browser_connection_failed', detail, { failure_stage: 'browser_connect' });
  }
  return mergeFailureMetadata(classifyPlaywrightFailure(error, { stage: 'launch' }), {
    failure_stage: 'browser_launch',
  });
}

function buildBestResult(intent, bestOffer, engineName, storeOutcomes = []) {
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
    store_outcomes: storeOutcomes,
  };
}

function proxyConfig(rawUrl) {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    const proxy = { server: `${parsed.protocol}//${parsed.host}` };
    if (parsed.username) proxy.username = decodeURIComponent(parsed.username);
    if (parsed.password) proxy.password = decodeURIComponent(parsed.password);
    return proxy;
  } catch {
    return null;
  }
}

function contextOptions({ env, engineName }) {
  const options = {
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: {
      'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  };

  if (engineName === CHROMIUM_ENGINE && env.USER_AGENT) {
    options.userAgent = env.USER_AGENT;
  }
  const proxy = engineName === CHROMIUM_ENGINE ? proxyConfig(env.PROXY_URL) : null;
  if (proxy) options.proxy = proxy;
  return options;
}

async function newPage(browser, { env, engineName, sharedContext = null }) {
  const context = sharedContext || await browser.newContext(contextOptions({ env, engineName }));
  const ownsContext = !sharedContext;

  const page = await context.newPage();
  return { context, page, ownsContext };
}

async function acquireSingleContext(browser, { env, engineName }) {
  const existingContexts = typeof browser.contexts === 'function'
    ? await Promise.resolve(browser.contexts())
    : [];
  if (Array.isArray(existingContexts) && existingContexts.length > 0) {
    return { context: existingContexts[0], ownsContext: false };
  }

  return {
    context: await browser.newContext(contextOptions({ env, engineName })),
    ownsContext: true,
  };
}

export async function checkBrowserReadiness(browser, { timeoutMs = 5000, context: suppliedContext = null } = {}) {
  let context = suppliedContext;
  let ownsContext = false;
  let page;
  try {
    if (!context) {
      context = await browser.newContext({ locale: 'pt-BR' });
      ownsContext = true;
    }
    page = await context.newPage();
    const marker = 'git-scraper-browser-ready';
    await page.goto(`data:text/html,<title>${marker}</title><main>${marker}</main>`, {
      waitUntil: 'domcontentloaded',
      timeout: Math.max(1000, Math.min(Number(timeoutMs) || 5000, 5000)),
    });
    const html = await page.content();
    if (!String(html || '').includes(marker)) {
      throw new Error('Browser readiness page did not render the expected marker');
    }
    return true;
  } finally {
    if (page?.close) await page.close().catch(() => undefined);
    if (ownsContext && context) await context.close().catch(() => undefined);
  }
}

function enabledStoresForIntent(intent, allowedStoreIds) {
  const explicitAllowlist = Array.isArray(allowedStoreIds)
    ? new Set(allowedStoreIds
      .map((storeId) => String(storeId || '').trim().toLowerCase())
      .filter((storeId) => isKnownStoreId(storeId)))
    : null;
  return [...new Set((intent?.stores || []).filter((storeId) => (
    explicitAllowlist ? explicitAllowlist.has(storeId) : isSearchEnabledStoreId(storeId)
  )))];
}

function unavailableStoreOutcomes(intent, allowedStoreIds, failure, engineName) {
  return enabledStoresForIntent(intent, allowedStoreIds).map((storeId) => ({
    store_id: storeId,
    store: getStoreSupportById(storeId).store,
    status: 'hard_failure',
    engine_used: engineName,
    offers_checked: 0,
    accepted_offer_count: 0,
    rejected_offer_count: 0,
    error_code: failure.error_code,
    error_detail: failure.error_detail,
  }));
}

function buildStoreOutcomes({ enabledStores, rawOffers, storeErrors, ranking, engineName }) {
  return enabledStores.map((storeId) => {
    const storeOffers = rawOffers.filter((offer) => offer.store_id === storeId);
    const acceptedOffers = ranking.accepted.filter((offer) => offer.store_id === storeId);
    const storeFailure = storeErrors.find((failure) => failure?.store_id === storeId);
    const accepted = acceptedOffers.length > 0;
    const errorCode = accepted
      ? null
      : (storeFailure?.error_code || (storeOffers.length > 0 ? 'no_matching_offers' : 'no_search_offers'));
    const errorDetail = accepted
      ? null
      : (storeFailure?.error_detail || (storeOffers.length > 0
        ? 'Search returned offers, but none matched the required filters'
        : 'Search did not return usable offers'));

    return {
      store_id: storeId,
      store: getStoreSupportById(storeId).store,
      status: accepted ? 'fresh_success' : 'hard_failure',
      engine_used: engineName,
      offers_checked: storeOffers.length,
      accepted_offer_count: acceptedOffers.length,
      rejected_offer_count: Math.max(0, storeOffers.length - acceptedOffers.length),
      ...(errorCode ? { error_code: errorCode, error_detail: errorDetail } : {}),
    };
  });
}

function primaryRankingFailure(rawOffers, storeErrors) {
  if (rawOffers.length > 0) {
    return toFailure('no_matching_offers', 'Search returned offers, but none matched the required filters');
  }
  const storeFailure = storeErrors.find((failure) => failure?.error_code);
  if (storeFailure) {
    return toFailure(storeFailure.error_code, storeFailure.error_detail || 'Store search failed', {
      primary_store_error: storeFailure,
    });
  }
  return toFailure('no_search_offers', 'Search did not return usable offers');
}

async function fetchStoreOffers({
  browser,
  intent,
  storeId,
  env,
  engineName,
  sleepFn,
  sharedContext = null,
}) {
  const adapter = getSearchStoreAdapter(storeId);
  const query = buildSearchQuery(intent);
  const searchUrl = adapter.buildSearchUrl(query);
  const fetchedAt = new Date().toISOString();
  let context;
  let page;
  let ownsContext = false;

  try {
    ({ context, page, ownsContext } = await newPage(browser, { env, engineName, sharedContext }));
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
      const httpStatus = Number(response?.status?.() || 0) || undefined;
      return {
        offers: [],
        failure: classified
          ? mergeFailureMetadata(classified, { store_id: storeId, search_url: searchUrl, http_status: httpStatus })
          : toFailure('no_search_offers', 'No usable offers were found in the search results', {
            store_id: storeId,
            search_url: searchUrl,
            http_status: httpStatus,
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
    if (page?.close) {
      await page.close().catch(() => undefined);
    }
    if (ownsContext && context) {
      await context.close().catch(() => undefined);
    }
  }
}

async function runWithBrowser(intents, {
  env,
  logger,
  engineName,
  browserFactory,
  probeReadiness = false,
  allowedStoreIds,
  sleepFn = sleep,
}) {
  if (intents.length === 0) return [];

  const log = logger.child(engineName);
  let browser;
  let sharedContext;
  try {
    browser = await browserFactory();
  } catch (error) {
    const failure = classifyBrowserAvailabilityFailure(error);
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
      store_outcomes: unavailableStoreOutcomes(intent, allowedStoreIds, failure, engineName),
      ...failure,
    }));
  }

  try {
    if (engineName === LIGHTPANDA_ENGINE) {
      try {
        sharedContext = await acquireSingleContext(browser, { env, engineName });
      } catch (error) {
        const failure = mergeFailureMetadata(classifyPlaywrightFailure(error, { stage: 'launch' }), {
          failure_stage: 'browser_context',
        });
        log.warn('Search browser could not create a reusable context', {
          engine: engineName,
          error_code: failure.error_code,
          error_detail: failure.error_detail,
        });
        return intents.map((intent) => ({
          product: intent,
          engine: engineName,
          ok: false,
          elapsed_ms: 0,
          store_outcomes: unavailableStoreOutcomes(intent, allowedStoreIds, failure, engineName),
          ...failure,
        }));
      }
    }

    if (probeReadiness) {
      try {
        await checkBrowserReadiness(browser, {
          timeoutMs: env.HTTP_TIMEOUT_MS,
          context: sharedContext?.context || null,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const failure = toFailure('browser_readiness_failed', `Browser readiness check failed: ${detail}`, {
          failure_stage: 'browser_readiness',
        });
        log.warn('Search browser failed readiness check', {
          engine: engineName,
          error_code: failure.error_code,
          error_detail: failure.error_detail,
        });
        return intents.map((intent) => ({
          product: intent,
          engine: engineName,
          ok: false,
          elapsed_ms: 0,
          store_outcomes: unavailableStoreOutcomes(intent, allowedStoreIds, failure, engineName),
          ...failure,
        }));
      }
    }

    const results = await runWithPool(intents, env.CONCURRENCY, async (intent) => {
      const startedAt = Date.now();
      const storeErrors = [];
      const rawOffers = [];
      const enabledStores = enabledStoresForIntent(intent, allowedStoreIds);

      log.product('debug', intent, 'Searching intent across stores', {
        stores: enabledStores,
        disabled_stores: (intent.stores || []).filter((storeId) => !enabledStores.includes(storeId)),
      });

      for (const storeId of enabledStores) {
        const storeOutcome = await fetchStoreOffers({
          browser,
          intent,
          storeId,
          env,
          engineName,
          sleepFn,
          sharedContext: sharedContext?.context || null,
        });

        rawOffers.push(...storeOutcome.offers);
        if (storeOutcome.failure) {
          storeErrors.push(storeOutcome.failure);
        }
      }

      const ranking = rankOffersForIntent(intent, rawOffers, {
        topPerStore: env.SEARCH_TOP_N_PER_STORE,
      });
      const storeOutcomes = buildStoreOutcomes({
        enabledStores,
        rawOffers,
        storeErrors,
        ranking,
        engineName,
      });
      const elapsedMs = Date.now() - startedAt;

      if (!ranking.best) {
        return {
          product: intent,
          engine: engineName,
          ok: false,
          elapsed_ms: elapsedMs,
          failure_stage: 'search_rank',
          stores_checked: enabledStores.length,
          offers_checked: ranking.checked_count,
          rejected_offers: ranking.rejected_count,
          store_errors: storeErrors,
          store_outcomes: storeOutcomes,
          offers: ranking.offers,
          ...primaryRankingFailure(rawOffers, storeErrors),
        };
      }

      const result = buildBestResult(intent, ranking.best, engineName, storeOutcomes);

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
        stores_checked: enabledStores.length,
        offers_checked: ranking.checked_count,
        rejected_offers: ranking.rejected_count,
        store_errors: storeErrors,
        store_outcomes: storeOutcomes,
        result,
        offers: ranking.offers,
      };
    });
    return results;
  } finally {
    if (sharedContext?.ownsContext && sharedContext.context) {
      await sharedContext.context.close().catch(() => undefined);
    }
    await browser.close().catch(() => undefined);
  }
}

export async function runSearchEngine(intents, {
  env,
  logger,
  sleepFn = sleep,
  browserFactories = {},
  allowedStoreIds,
} = {}) {
  const lightpandaAttempts = await runWithBrowser(intents, {
    env,
    logger,
    engineName: LIGHTPANDA_ENGINE,
    sleepFn,
    browserFactory: browserFactories.lightpanda || (() => chromium.connectOverCDP(env.LIGHTPANDA_CDP_URL)),
    probeReadiness: true,
    allowedStoreIds,
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
    browserFactory: browserFactories.chromium || (() => chromium.launch({
      headless: true,
      ...(proxyConfig(env.PROXY_URL) ? { proxy: proxyConfig(env.PROXY_URL) } : {}),
    })),
    allowedStoreIds,
  });

  const failuresByProductId = new Map(lightpandaAttempts
    .filter((attempt) => !attempt.ok)
    .map((attempt) => [attempt.product.id, attempt]));
  const annotatedChromiumAttempts = chromiumAttempts.map((attempt) => {
    const lightpandaFailure = failuresByProductId.get(attempt.product.id);
    const storeFailure = lightpandaFailure?.store_errors?.find((failure) => failure?.error_code);
    const fallback = {
      fallback_from: LIGHTPANDA_ENGINE,
      fallback_reason: storeFailure?.error_code || lightpandaFailure?.error_code || 'lightpanda_failed',
    };
    return {
      ...attempt,
      ...fallback,
      ...(attempt.result ? { result: { ...attempt.result, ...fallback } } : {}),
    };
  });

  return [...lightpandaAttempts, ...annotatedChromiumAttempts];
}
