import { env } from './config/env.js';
import { pathToFileURL } from 'node:url';
import { runEngine1 } from './engines/engine1_http.js';
import { runEngine2 } from './engines/engine2_browser.js';
import { runEngine3 } from './engines/engine3_hardmode.js';
import { readProducts, toSafeProductReadError } from './io/products.js';
import { persistRunOutputs } from './io/storage.js';
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

function toFailureEntry(trail) {
  const lastErrorAttempt = [...trail.attempts].reverse().find((item) => !item.ok);

  return {
    product_id: trail.product.id,
    url: trail.product.url,
    name: trail.product.name,
    status: 'failed',
    fetched_at: new Date().toISOString(),
    attempts: trail.attempts.map((item) => ({
      engine: item.engine,
      ok: item.ok,
      elapsed_ms: item.elapsed_ms,
      error: item.error || null,
      error_code: item.error_code || null,
      error_detail: item.error_detail || item.error || null,
      source: item.result?.source || null,
      confidence: item.result?.confidence || null,
      price: item.result?.price || null,
      http_status: item.http_status || null,
      final_url: item.final_url || null,
      content_type: item.content_type || null,
      html_size: item.html_size || null,
      artifact_dir: item.artifact_dir || null,
      retry_attempts: Array.isArray(item.retry_attempts) ? item.retry_attempts : undefined,
    })),
    last_error: lastErrorAttempt?.error || 'unknown',
    error_code: lastErrorAttempt?.error_code || 'unexpected_error',
    error_detail: lastErrorAttempt?.error_detail || lastErrorAttempt?.error || 'unknown',
    artifact_dir: lastErrorAttempt?.artifact_dir || null,
  };
}

function registerAttempts(trailsById, successById, attempts) {
  for (const attempt of attempts) {
    const productId = attempt.product.id;
    const trail = trailsById.get(productId);
    trail.attempts.push(attempt);

    if (attempt.ok) {
      successById.set(productId, attempt.result);
    }
  }
}

function findRemainingFailures(products, attempts) {
  const successIds = new Set(attempts.filter((item) => item.ok).map((item) => item.product.id));
  return products.filter((product) => !successIds.has(product.id));
}

function buildEmptySummary(startedAt) {
  return {
    total_products: 0,
    success_count: 0,
    failure_count: 0,
    run_duration_ms: Date.now() - startedAt,
    engines: {
      engine1_http: { attempted: 0, success: 0, failed: 0, avg_time_ms: 0 },
      engine2_browser: { attempted: 0, success: 0, failed: 0, avg_time_ms: 0 },
      engine3_hardmode: { attempted: 0, success: 0, failed: 0, avg_time_ms: 0 },
    },
  };
}

function buildRunPayload({ runId, runDate, generatedAt, summary, results, failures }) {
  return {
    run_id: runId,
    run_date: runDate,
    generated_at: generatedAt,
    currency: 'BRL',
    summary,
    results,
    failures,
  };
}

function buildLatestPayload({ runId, generatedAt, summary, items, failures, runFile }) {
  return {
    run_id: runId,
    generated_at: generatedAt,
    currency: 'BRL',
    summary,
    items,
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
      error_code: fatal.error_code,
      message: fatal.error_detail || fatal.error,
    } : {}),
  };
}

async function persistSuccessRun({ runId, runDate, generatedAt, summary, successes, failures, status = 'success' }) {
  const runPayload = buildRunPayload({
    runId,
    runDate,
    generatedAt,
    summary,
    results: successes,
    failures,
  });

  const { run_file: runFile } = await persistRunOutputs({
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
      failures,
      runFile: `${runId}.json`,
    }),
    status,
  });

  return runFile;
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

export async function runScrape({ runtimeEnv = env, baseLogger = logger } = {}) {
  const startedAt = Date.now();
  const generatedAt = new Date().toISOString();
  const runDate = generatedAt.slice(0, 10);
  const runId = createRunId(generatedAt);

  baseLogger.info('Starting scrape run', {
    run_id: runId,
    run_date: runDate,
    concurrency: runtimeEnv.CONCURRENCY,
    timeout_ms: runtimeEnv.HTTP_TIMEOUT_MS,
    hardmode_proxy: Boolean(runtimeEnv.PROXY_URL),
    has_external_provider_key: Boolean(runtimeEnv.SCRAPING_API_KEY),
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
    baseLogger.error('Could not read products file', { run_id: runId, error: fatal.error_detail });
    throw new Error(fatal.error_detail);
  }

  const activeProducts = products.filter((product) => product.is_active);
  if (activeProducts.length === 0) {
    baseLogger.warn('No active products found, saving empty snapshots', { run_id: runId });

    const summary = buildEmptySummary(startedAt);
    await persistSuccessRun({
      runId,
      runDate,
      generatedAt,
      summary,
      successes: [],
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

  const trailsById = new Map();
  const successById = new Map();

  for (const product of activeProducts) {
    trailsById.set(product.id, {
      product,
      attempts: [],
    });
  }

  const attempts1 = await runEngine1(activeProducts, {
    env: runtimeEnv,
    logger: baseLogger,
    runId,
  });
  registerAttempts(trailsById, successById, attempts1);
  const pendingForEngine2 = findRemainingFailures(activeProducts, attempts1);

  const attempts2 = await runEngine2(pendingForEngine2, {
    env: runtimeEnv,
    logger: baseLogger,
    runId,
  });
  registerAttempts(trailsById, successById, attempts2);
  const pendingForEngine3 = findRemainingFailures(pendingForEngine2, attempts2);

  const attempts3 = await runEngine3(pendingForEngine3, {
    env: runtimeEnv,
    logger: baseLogger,
    runId,
  });
  registerAttempts(trailsById, successById, attempts3);

  const allAttempts = [...attempts1, ...attempts2, ...attempts3];

  const successes = [...successById.values()].sort((a, b) => a.name.localeCompare(b.name));
  const failures = [...trailsById.values()]
    .filter((trail) => !successById.has(trail.product.id))
    .map((trail) => toFailureEntry(trail));

  const summary = {
    total_products: activeProducts.length,
    success_count: successes.length,
    failure_count: failures.length,
    run_duration_ms: Date.now() - startedAt,
    engines: {
      engine1_http: summarizeEngineAttempts(allAttempts, 'engine1_http'),
      engine2_browser: summarizeEngineAttempts(allAttempts, 'engine2_browser'),
      engine3_hardmode: summarizeEngineAttempts(allAttempts, 'engine3_hardmode'),
    },
  };

  await persistSuccessRun({
    runId,
    runDate,
    generatedAt,
    summary,
    successes,
    failures,
    status: failures.length > 0 ? 'partial' : 'success',
  });

  baseLogger.summary('Scrape run completed', {
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
