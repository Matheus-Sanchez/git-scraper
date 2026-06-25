import { env } from './config/env.js';
import { pathToFileURL } from 'node:url';
import { runSearchEngine } from './engines/engine_search.js';
import { readProducts, toSafeProductReadError } from './io/products.js';
import { findLatestSuccessfulResults, persistRunOutputs } from './io/storage.js';
import { buildFatalFailure } from './utils/failure.js';
import { createLogger } from './utils/logger.js';
import { createRunId } from './utils/run_id.js';

const logger = createLogger({ debug: env.DEBUG, scope: 'scrape' });

function summarizeEngineAttempts(allAttempts, engineName) {
  const attempts = allAttempts.filter((item) => item.engine === engineName);
  const successCount = attempts.filter((item) => item.ok).length;
  const failCount = attempts.length - successCount;
  const totalMs = attempts.reduce((sum, item) => sum + (item.elapsed_ms || 0), 0);

  return {
    attempted: attempts.length,
    success: successCount,
    failed: failCount,
    avg_time_ms: attempts.length > 0 ? Math.round(totalMs / attempts.length) : 0,
  };
}

function buildEngineSummary(attempts) {
  return {
    lightpanda_search: summarizeEngineAttempts(attempts, 'lightpanda_search'),
    chromium_search: summarizeEngineAttempts(attempts, 'chromium_search'),
  };
}

function buildEmptySummary(startedAt) {
  return {
    total_products: 0,
    success_count: 0,
    failure_count: 0,
    run_duration_ms: Date.now() - startedAt,
    engines: buildEngineSummary([]),
  };
}

function toFailureEntry(intent, attempts) {
  const lastErrorAttempt = [...attempts].reverse().find((item) => !item.ok);
  const lastAttempt = attempts[attempts.length - 1];

  return {
    product_id: intent.id,
    intent_id: intent.id,
    name: intent.name,
    characteristics: intent.characteristics || '',
    status: 'failed',
    fetched_at: new Date().toISOString(),
    attempts: attempts.map((item) => ({
      engine: item.engine,
      ok: item.ok,
      elapsed_ms: item.elapsed_ms,
      error: item.error || null,
      error_code: item.error_code || null,
      error_detail: item.error_detail || item.error || null,
      stores_checked: item.stores_checked || null,
      offers_checked: item.offers_checked || null,
      rejected_offers: item.rejected_offers || null,
      store_errors: Array.isArray(item.store_errors) ? item.store_errors : undefined,
      result: item.ok ? item.result : undefined,
    })),
    engine: lastErrorAttempt?.engine || lastAttempt?.engine || null,
    last_error: lastErrorAttempt?.error || 'unknown',
    error_code: lastErrorAttempt?.error_code || 'unexpected_error',
    error_detail: lastErrorAttempt?.error_detail || lastErrorAttempt?.error || 'unknown',
    stores_checked: lastErrorAttempt?.stores_checked || null,
    offers_checked: lastErrorAttempt?.offers_checked || null,
    rejected_offers: lastErrorAttempt?.rejected_offers || null,
    store_errors: Array.isArray(lastErrorAttempt?.store_errors) ? lastErrorAttempt.store_errors : undefined,
  };
}

function buildRunPayload({ runId, runDate, generatedAt, summary, results, offers, failures }) {
  return {
    run_id: runId,
    run_date: runDate,
    generated_at: generatedAt,
    currency: 'BRL',
    summary,
    results,
    offers,
    failures,
  };
}

function buildLatestPayload({ runId, generatedAt, summary, items, offers, failures, runFile }) {
  return {
    run_id: runId,
    generated_at: generatedAt,
    currency: 'BRL',
    summary,
    items,
    offers,
    failures,
    run_file: runFile,
  };
}

function buildErrorPayload({ runId, runDate, generatedAt, engineSummary, errors, fatal = null }) {
  return {
    run_id: runId,
    run_date: runDate,
    generated_at: generatedAt,
    engine_summary: engineSummary,
    errors,
    ...(fatal ? {
      fatal: true,
      phase: fatal.phase,
      engine: fatal.engine || null,
      error_code: fatal.error_code,
      error_detail: fatal.error_detail || fatal.error || fatal.message || null,
      message: fatal.error_detail || fatal.error,
    } : {}),
  };
}

function isUsablePrice(value) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0;
}

function toCarriedForwardResult(failure, previousResult, generatedAt) {
  if (!failure || !previousResult || !isUsablePrice(previousResult.price)) {
    return null;
  }

  return {
    product_id: failure.product_id,
    intent_id: failure.intent_id || failure.product_id,
    name: failure.name || previousResult.name,
    characteristics: failure.characteristics || previousResult.characteristics || '',
    title: previousResult.title || previousResult.name,
    url: previousResult.url || null,
    store_id: previousResult.store_id || null,
    store: previousResult.store || null,
    price: Number(previousResult.price),
    currency: previousResult.currency || 'BRL',
    unit_price: isUsablePrice(previousResult.unit_price) ? Number(previousResult.unit_price) : null,
    unit_basis: previousResult.unit_basis || null,
    normalized_quantity: previousResult.normalized_quantity || null,
    attributes: previousResult.attributes || {},
    match_score: Number.isFinite(Number(previousResult.match_score)) ? Number(previousResult.match_score) : null,
    priority_score: Number.isFinite(Number(previousResult.priority_score)) ? Number(previousResult.priority_score) : null,
    engine_used: 'carry_forward',
    fetched_at: failure.fetched_at || generatedAt,
    source: previousResult.source || 'carry_forward',
    confidence: Number.isFinite(Number(previousResult.confidence)) ? Number(previousResult.confidence) : null,
    status: 'carried_forward',
    carried_forward_reason: failure.error_code || 'search_failed',
    carried_forward_from: {
      run_id: previousResult.run_id || null,
      run_date: previousResult.run_date || null,
      fetched_at: previousResult.fetched_at || null,
      engine_used: previousResult.engine_used || null,
      source: previousResult.source || null,
      status: previousResult.status || 'ok',
    },
  };
}

async function buildCarriedForwardResults({ failures, generatedAt, lookupPreviousResults, baseLogger, runId }) {
  if (!Array.isArray(failures) || failures.length === 0) {
    return [];
  }

  const previousByProductId = await lookupPreviousResults(failures.map((failure) => failure.product_id));
  const carriedForward = failures
    .map((failure) => toCarriedForwardResult(failure, previousByProductId.get(failure.product_id), generatedAt))
    .filter(Boolean);

  if (carriedForward.length > 0) {
    baseLogger.info('Carried forward previous offers after search failures', {
      run_id: runId,
      carried_forward_count: carriedForward.length,
      product_ids: carriedForward.map((item) => item.product_id),
    });
  }

  return carriedForward;
}

async function persistSuccessRun({
  runId,
  runDate,
  generatedAt,
  summary,
  successes,
  offers,
  failures,
  status = 'success',
}) {
  const runPayload = buildRunPayload({
    runId,
    runDate,
    generatedAt,
    summary,
    results: successes,
    offers,
    failures,
  });

  return persistRunOutputs({
    runId,
    runDate,
    generatedAt,
    runPayload,
    errorPayload: buildErrorPayload({
      runId,
      runDate,
      generatedAt,
      engineSummary: summary.engines,
      errors: failures,
    }),
    latestPayload: buildLatestPayload({
      runId,
      generatedAt,
      summary,
      items: successes,
      offers,
      failures,
      runFile: `${runId}.json`,
    }),
    status,
  });
}

async function persistFatalRun({ runId, runDate, generatedAt, summary, fatal }) {
  return persistRunOutputs({
    runId,
    runDate,
    generatedAt,
    runPayload: buildRunPayload({
      runId,
      runDate,
      generatedAt,
      summary,
      results: [],
      offers: [],
      failures: [],
    }),
    errorPayload: buildErrorPayload({
      runId,
      runDate,
      generatedAt,
      engineSummary: summary.engines,
      errors: [],
      fatal,
    }),
    latestPayload: null,
    status: 'fatal',
  });
}

function finalSuccessAttempts(attempts) {
  const out = new Map();
  for (const attempt of attempts) {
    if (attempt.ok) {
      out.set(attempt.product.id, attempt);
    }
  }
  return out;
}

export async function runScrape({
  runtimeEnv = env,
  baseLogger = logger,
  engineRunners = {},
  lookupPreviousResults = findLatestSuccessfulResults,
} = {}) {
  const startedAt = Date.now();
  const generatedAt = new Date().toISOString();
  const runDate = generatedAt.slice(0, 10);
  const runId = createRunId(generatedAt);
  const searchRunner = engineRunners.runSearchEngine || runSearchEngine;

  baseLogger.info('Starting search scrape run', {
    run_id: runId,
    run_date: runDate,
    concurrency: runtimeEnv.CONCURRENCY,
    timeout_ms: runtimeEnv.HTTP_TIMEOUT_MS,
    lightpanda_cdp_url: runtimeEnv.LIGHTPANDA_CDP_URL,
    top_n_per_store: runtimeEnv.SEARCH_TOP_N_PER_STORE,
    chromium_fallback: true,
  });

  let products;
  try {
    products = await readProducts();
  } catch (error) {
    const fatal = buildFatalFailure({
      phase: 'read_products',
      errorCode: 'unexpected_error',
      message: toSafeProductReadError(error),
    });
    const summary = buildEmptySummary(startedAt);
    await persistFatalRun({
      runId,
      runDate,
      generatedAt,
      summary,
      fatal,
    });
    baseLogger.error('Could not read search intent catalog', { run_id: runId, error: fatal.error_detail });
    throw new Error(fatal.error_detail);
  }

  const activeProducts = products.filter((product) => product.is_active);
  if (activeProducts.length === 0) {
    baseLogger.warn('No active search intents found, saving empty snapshots', { run_id: runId });
    const summary = buildEmptySummary(startedAt);
    await persistSuccessRun({
      runId,
      runDate,
      generatedAt,
      summary,
      successes: [],
      offers: [],
      failures: [],
      status: 'success',
    });

    return {
      run_id: runId,
      run_date: runDate,
      summary,
      success: true,
      status: 'success',
    };
  }

  const attempts = await searchRunner(activeProducts, {
    env: runtimeEnv,
    logger: baseLogger,
    runId,
  });
  const successAttempts = finalSuccessAttempts(attempts);
  const attemptsByProductId = new Map();
  for (const attempt of attempts) {
    const bucket = attemptsByProductId.get(attempt.product.id) || [];
    bucket.push(attempt);
    attemptsByProductId.set(attempt.product.id, bucket);
  }

  const successes = [...successAttempts.values()]
    .map((attempt) => attempt.result)
    .sort((a, b) => a.name.localeCompare(b.name));
  const offers = attempts
    .flatMap((attempt) => attempt.offers || [])
    .sort((a, b) => {
      if (a.intent_id !== b.intent_id) return a.intent_id.localeCompare(b.intent_id);
      if (a.store_id !== b.store_id) return a.store_id.localeCompare(b.store_id);
      return Number(a.rank || 0) - Number(b.rank || 0);
    });
  const failures = activeProducts
    .filter((product) => !successAttempts.has(product.id))
    .map((product) => toFailureEntry(product, attemptsByProductId.get(product.id) || []));
  const carriedForward = await buildCarriedForwardResults({
    failures,
    generatedAt,
    lookupPreviousResults,
    baseLogger,
    runId,
  });
  const persistedResults = [...successes, ...carriedForward]
    .sort((a, b) => a.name.localeCompare(b.name));

  const summary = {
    total_products: activeProducts.length,
    success_count: successes.length,
    failure_count: failures.length,
    run_duration_ms: Date.now() - startedAt,
    engines: buildEngineSummary(attempts),
  };

  await persistSuccessRun({
    runId,
    runDate,
    generatedAt,
    summary,
    successes: persistedResults,
    offers,
    failures,
    status: failures.length > 0 ? 'partial' : 'success',
  });

  baseLogger.summary('Search scrape run completed', {
    run_id: runId,
    run_date: runDate,
    success_count: summary.success_count,
    failure_count: summary.failure_count,
    run_duration_ms: summary.run_duration_ms,
    engines: summary.engines,
  });

  return {
    run_id: runId,
    run_date: runDate,
    summary,
    success: true,
    status: failures.length > 0 ? 'partial' : 'success',
  };
}

export async function main() {
  return runScrape();
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  main().catch((error) => {
    logger.error('Unhandled scraper error', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
}
