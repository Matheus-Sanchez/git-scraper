import axios from 'axios';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { extractPriceFromHtml } from '../extract/extract_price.js';
import { sleep } from '../utils/pool.js';
import { normalizeUrl } from '../utils/url.js';
import { getAdapterForUrl } from '../adapters/index.js';
import { roundTo2 } from '../utils/price_parse.js';
import {
  classifyAxiosFailure,
  classifyExtractionFailure,
  classifyPlaywrightFailure,
  mergeFailureMetadata,
} from '../utils/failure.js';
import {
  prepareDebugArtifactPaths,
  writeFailureArtifacts,
} from '../utils/debug_artifacts.js';
import { cacheDir } from '../io/paths.js';

const ENGINE_NAME = 'engine3_hardmode';

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

async function stealthScrollWithControls(page, { sleepFn, randomBetweenFn }) {
  const steps = randomBetweenFn(5, 10);
  for (let i = 0; i < steps; i += 1) {
    const delta = randomBetweenFn(350, 900);
    await page.mouse.wheel(0, delta);
    await sleepFn(randomBetweenFn(130, 420));
  }
}

async function fetchViaProvider(url, env, logger) {
  if (!env.SCRAPING_API_KEY) {
    return { html: null, metadata: null, failure: null };
  }

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

    const html = typeof response.data === 'string' ? response.data : '';
    if (html.length <= 120) {
      return {
        html: null,
        metadata: {
          provider: 'zenrows',
          provider_html_size: html.length || undefined,
        },
        failure: {
          error: 'Provider returned insufficient HTML',
          error_code: 'empty_html',
          error_detail: 'Provider returned insufficient HTML',
        },
      };
    }

    return {
      html,
      metadata: {
        provider: 'zenrows',
        http_status: Number(response.status || 0) || undefined,
        final_url: url,
        content_type: response.headers?.['content-type'] || undefined,
        html_size: html.length || undefined,
      },
      failure: null,
    };
  } catch (error) {
    const failure = classifyAxiosFailure(error, { final_url: url, provider: 'zenrows' });
    logger.debug('External provider fallback failed', {
      error: failure.error_detail,
      error_code: failure.error_code,
    });

    return {
      html: null,
      metadata: null,
      failure,
    };
  }
}

async function startTraceIfEnabled(context, enabled) {
  if (!enabled) return false;

  try {
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
    });
    return true;
  } catch {
    return false;
  }
}

async function stopTrace(context, { enabled, path } = {}) {
  if (!enabled) return false;

  try {
    if (path) {
      await context.tracing.stop({ path });
    } else {
      await context.tracing.stop();
    }
    return true;
  } catch {
    return false;
  }
}

async function buildFailureArtifacts({
  runId,
  product,
  page,
  html,
  metadata,
  saveTrace = false,
  context = null,
  traceEnabled = false,
}) {
  const paths = await prepareDebugArtifactPaths({
    runId,
    productId: product.id,
    engineName: ENGINE_NAME,
  });
  let traceStopped = false;

  if (saveTrace && context) {
    traceStopped = await stopTrace(context, {
      enabled: traceEnabled,
      path: paths.tracePath,
    });
    if (traceStopped) {
      metadata.trace_path = `${paths.artifact_dir}/trace.zip`;
    }
  }

  const artifactDir = await writeFailureArtifacts({
    paths,
    html,
    metadata,
    page,
  });

  return {
    artifactDir,
    traceStopped,
  };
}

export async function runEngine3(products, {
  env,
  logger,
  runId,
  sleepFn = sleep,
  randomBetweenFn = randomBetween,
} = {}) {
  if (products.length === 0) return [];

  const log = logger.child(ENGINE_NAME);
  const profileDir = resolve(cacheDir(), 'pw-profile');

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
    const failure = classifyPlaywrightFailure(error, { stage: 'launch' });
    log.warn('Engine3 persistent context launch failed', {
      error: failure.error_detail,
      error_code: failure.error_code,
    });

    return products.map((product) => ({
      product,
      engine: ENGINE_NAME,
      ok: false,
      elapsed_ms: 0,
      ...failure,
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
      const traceEnabled = await startTraceIfEnabled(context, Boolean(env.DEBUG));
      let traceStopped = false;
      let adapter = null;
      let html = '';
      let responseMetadata = {};

      try {
        const url = normalizeUrl(product.url);
        adapter = getAdapterForUrl(url);
        const selectors = adapter.getSelectors(product);
        const waitOptions = adapter.getWaitOptions(ENGINE_NAME);

        const response = await page.goto(url, {
          waitUntil: waitOptions.waitUntil,
          timeout: env.HTTP_TIMEOUT_MS + 25000,
        });

        responseMetadata = {
          http_status: Number(response?.status?.() || 0) || undefined,
          final_url: page.url() || url,
          content_type: response?.headers?.()['content-type'] || undefined,
        };

        await sleepFn(randomBetweenFn(800, 1800));

        if (waitOptions.scroll) {
          await stealthScrollWithControls(page, {
            sleepFn,
            randomBetweenFn,
          });
        }

        await sleepFn((waitOptions.postWaitMs || 2500) + randomBetweenFn(800, 1900));

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

          const artifactResult = await buildFailureArtifacts({
            runId,
            product,
            page,
            html,
            metadata: {
              ...failure,
              product_id: product.id,
              url,
              adapter: adapter.id,
            },
            saveTrace: Boolean(env.DEBUG),
            context,
            traceEnabled,
          });
          traceStopped = artifactResult.traceStopped;

          attempts.push({
            product,
            engine: ENGINE_NAME,
            ok: false,
            elapsed_ms: Date.now() - startedAt,
            artifact_dir: artifactResult.artifactDir,
            ...failure,
          });
          continue;
        }

        const adapterCandidates = adapter.extractCandidates({ html, product });
        const extraction = extractPriceFromHtml({
          html,
          selectors,
          adapterCandidates,
          adapterName: adapter.id,
        });

        if (extraction.ok) {
          const result = adapter.postProcess(buildSnapshot(product, extraction), {
            html,
            extraction,
            product,
          });

          log.product('info', product, 'Engine3 success', {
            price: result.price,
            source: result.source,
            confidence: result.confidence,
            elapsed_ms: Date.now() - startedAt,
          });

          traceStopped = await stopTrace(context, { enabled: traceEnabled });

          attempts.push({
            product,
            engine: ENGINE_NAME,
            ok: true,
            elapsed_ms: Date.now() - startedAt,
            result,
          });
          continue;
        }

        let failure = classifyAdapterFailure(
          adapter,
          { html, product, extraction, engineName: ENGINE_NAME },
          classifyExtractionFailure(extraction, responseMetadata),
        );

        const providerOutcome = await fetchViaProvider(url, env, log);
        if (providerOutcome.html) {
          const providerExtraction = extractPriceFromHtml({
            html: providerOutcome.html,
            selectors,
            adapterCandidates: adapter.extractCandidates({ html: providerOutcome.html, product }),
            adapterName: adapter.id,
          });

          if (providerExtraction.ok) {
            const snapshot = adapter.postProcess(buildSnapshot(product, providerExtraction), {
              html: providerOutcome.html,
              extraction: providerExtraction,
              product,
            });

            log.product('info', product, 'Engine3 success via provider', {
              price: snapshot.price,
              source: snapshot.source,
              confidence: snapshot.confidence,
              elapsed_ms: Date.now() - startedAt,
            });

            traceStopped = await stopTrace(context, { enabled: traceEnabled });

            attempts.push({
              product,
              engine: ENGINE_NAME,
              ok: true,
              elapsed_ms: Date.now() - startedAt,
              result: {
                ...snapshot,
                source: `${snapshot.source}+provider`,
                confidence: Math.min(0.99, roundTo2(snapshot.confidence + 0.03)),
              },
            });
            continue;
          }

          failure = classifyAdapterFailure(
            adapter,
            {
              html: providerOutcome.html,
              product,
              extraction: providerExtraction,
              engineName: ENGINE_NAME,
            },
            classifyExtractionFailure(providerExtraction, {
              ...providerOutcome.metadata,
              provider: providerOutcome.metadata?.provider || 'zenrows',
            }),
          );

          html = providerOutcome.html;
          responseMetadata = {
            ...responseMetadata,
            ...providerOutcome.metadata,
          };
        } else if (providerOutcome.failure) {
          failure = mergeFailureMetadata(failure, providerOutcome.failure);
        }

        const artifactResult = await buildFailureArtifacts({
          runId,
          product,
          page,
          html,
          metadata: {
            ...failure,
            ...responseMetadata,
            product_id: product.id,
            url,
            adapter: adapter.id,
          },
          saveTrace: Boolean(env.DEBUG),
          context,
          traceEnabled,
        });
        traceStopped = artifactResult.traceStopped;

        attempts.push({
          product,
          engine: ENGINE_NAME,
          ok: false,
          elapsed_ms: Date.now() - startedAt,
          artifact_dir: artifactResult.artifactDir,
          ...failure,
        });

        log.product('warn', product, 'Engine3 failed', {
          error: failure.error_detail,
          error_code: failure.error_code,
          elapsed_ms: Date.now() - startedAt,
        });
      } catch (error) {
        const failure = classifyPlaywrightFailure(error, {
          stage: 'runtime',
          metadata: {
            final_url: page.url() || product.url,
            html_size: html.length || undefined,
            ...responseMetadata,
          },
        });

        const artifactResult = await buildFailureArtifacts({
          runId,
          product,
          page,
          html: html || await page.content().catch(() => ''),
          metadata: {
            ...failure,
            product_id: product.id,
            url: product.url,
            adapter: adapter?.id || null,
          },
          saveTrace: Boolean(env.DEBUG),
          context,
          traceEnabled,
        }).catch(() => ({ artifactDir: null, traceStopped: false }));
        traceStopped = artifactResult.traceStopped;

        attempts.push({
          product,
          engine: ENGINE_NAME,
          ok: false,
          elapsed_ms: Date.now() - startedAt,
          artifact_dir: artifactResult.artifactDir,
          ...failure,
        });

        log.product('warn', product, 'Engine3 exception', {
          error: failure.error_detail,
          error_code: failure.error_code,
          elapsed_ms: Date.now() - startedAt,
        });
      } finally {
        if (!traceStopped) {
          await stopTrace(context, { enabled: traceEnabled });
        }
        await page.close().catch(() => undefined);
      }
    }

    return attempts;
  } finally {
    await context.close();
  }
}
