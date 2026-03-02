import { env } from './config/env.js';
import { runEngine1 } from './engines/engine1_http.js';
import { runEngine2 } from './engines/engine2_browser.js';
import { runEngine3 } from './engines/engine3_hardmode.js';
import { readProducts, toSafeProductReadError } from './io/products.js';
import {
  saveDailyErrors,
  saveDailyRun,
  saveLatestSnapshot,
  updateRunsIndex,
} from './io/storage.js';
import { createLogger } from './utils/logger.js';

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
      source: item.result?.source || null,
      confidence: item.result?.confidence || null,
      price: item.result?.price || null,
    })),
    last_error: lastErrorAttempt?.error || 'unknown',
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

async function main() {
  const startedAt = Date.now();
  const generatedAt = new Date().toISOString();
  const runDate = generatedAt.slice(0, 10);

  logger.info('Starting scrape run', {
    run_date: runDate,
    concurrency: env.CONCURRENCY,
    timeout_ms: env.HTTP_TIMEOUT_MS,
    hardmode_proxy: Boolean(env.PROXY_URL),
    has_external_provider_key: Boolean(env.SCRAPING_API_KEY),
  });

  let products;
  try {
    products = await readProducts();
  } catch (error) {
    logger.error('Could not read products file', { error: toSafeProductReadError(error) });
    return;
  }

  const activeProducts = products.filter((product) => product.is_active);
  if (activeProducts.length === 0) {
    logger.warn('No active products found, saving empty snapshots');

    const summary = {
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

    const daily = {
      run_date: runDate,
      generated_at: generatedAt,
      currency: 'BRL',
      summary,
      results: [],
      failures: [],
    };

    const runFile = await saveDailyRun(runDate, daily);
    await updateRunsIndex(runFile);

    await saveLatestSnapshot({
      generated_at: generatedAt,
      currency: 'BRL',
      summary,
      items: [],
      failures: [],
      run_file: runFile,
    });

    await saveDailyErrors(runDate, {
      run_date: runDate,
      generated_at: generatedAt,
      engine_summary: summary.engines,
      errors: [],
    });

    return;
  }

  const trailsById = new Map();
  const successById = new Map();

  for (const product of activeProducts) {
    trailsById.set(product.id, {
      product,
      attempts: [],
    });
  }

  const attempts1 = await runEngine1(activeProducts, { env, logger });
  registerAttempts(trailsById, successById, attempts1);
  const pendingForEngine2 = findRemainingFailures(activeProducts, attempts1);

  const attempts2 = await runEngine2(pendingForEngine2, { env, logger });
  registerAttempts(trailsById, successById, attempts2);
  const pendingForEngine3 = findRemainingFailures(pendingForEngine2, attempts2);

  const attempts3 = await runEngine3(pendingForEngine3, { env, logger });
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

  const dailyPayload = {
    run_date: runDate,
    generated_at: generatedAt,
    currency: 'BRL',
    summary,
    results: successes,
    failures,
  };

  const runFile = await saveDailyRun(runDate, dailyPayload);
  await updateRunsIndex(runFile);

  await saveLatestSnapshot({
    generated_at: generatedAt,
    currency: 'BRL',
    summary,
    items: successes,
    failures,
    run_file: runFile,
  });

  await saveDailyErrors(runDate, {
    run_date: runDate,
    generated_at: generatedAt,
    engine_summary: summary.engines,
    errors: failures,
  });

  logger.summary('Scrape run completed', {
    run_date: runDate,
    success_count: summary.success_count,
    failure_count: summary.failure_count,
    run_duration_ms: summary.run_duration_ms,
    engines: summary.engines,
  });
}

main().catch((error) => {
  logger.error('Unhandled scraper error', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 0;
});