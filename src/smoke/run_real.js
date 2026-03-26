import { dirname, resolve } from 'node:path';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { env } from '../config/env.js';
import { readProducts } from '../io/products.js';
import { runScrape } from '../scrape.js';
import {
  parseSmokeProductIds,
  selectSmokeProducts,
  summarizeSmokeRun,
} from './real.js';

const smokeRoot = resolve(process.cwd(), '.cache', 'smoke-real');
const smokeWorkspace = resolve(smokeRoot, 'workspace');

function parseMaxProductsPerStore(rawValue) {
  const parsed = Number.parseInt(String(rawValue || '1'), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return parsed;
}

async function writeJson(filePath, payload) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function prepareWorkspace(selectedProducts) {
  await rm(smokeRoot, { recursive: true, force: true });
  await mkdir(resolve(smokeWorkspace, 'data'), { recursive: true });
  await mkdir(resolve(smokeWorkspace, 'docs', 'data'), { recursive: true });
  await writeJson(
    resolve(smokeWorkspace, 'data', 'products.json'),
    selectedProducts.map(({ smoke_store: _smokeStore, smoke_support_level: _smokeSupportLevel, ...product }) => product),
  );
}

function buildSelectedProductsReport(selectedProducts) {
  return selectedProducts.map((product) => ({
    id: product.id,
    name: product.name,
    url: product.url,
    store: product.smoke_store,
    support_level: product.smoke_support_level,
  }));
}

async function main() {
  const products = await readProducts();
  const selectedProducts = selectSmokeProducts(products, {
    productIds: parseSmokeProductIds(process.env.SMOKE_PRODUCT_IDS),
    maxProductsPerStore: parseMaxProductsPerStore(process.env.SMOKE_MAX_PRODUCTS_PER_STORE),
  });

  if (selectedProducts.length === 0) {
    throw new Error('No active smoke-eligible products found in data/products.json');
  }

  await prepareWorkspace(selectedProducts);

  const previousDataRoot = process.env.DATA_ROOT;
  process.env.DATA_ROOT = smokeWorkspace;

  try {
    const runResult = await runScrape({ runtimeEnv: env });
    const latestPayload = await readJson(resolve(smokeWorkspace, 'data', 'latest.json'));
    const smokeAssessment = summarizeSmokeRun({
      selectedProducts,
      latestPayload,
    });

    const report = {
      generated_at: new Date().toISOString(),
      overall_status: smokeAssessment.overall_status,
      selected_products: buildSelectedProductsReport(selectedProducts),
      run: {
        run_id: runResult.run_id,
        run_date: runResult.run_date,
        status: runResult.status,
        summary: runResult.summary,
      },
      store_results: smokeAssessment.store_results,
      artifact_root: '.cache/smoke-real/workspace/.cache/debug',
    };

    await writeJson(resolve(smokeRoot, 'summary.json'), report);
    console.log(JSON.stringify(report, null, 2));

    if (!smokeAssessment.ok) {
      process.exitCode = 1;
    }
  } finally {
    if (previousDataRoot === undefined) {
      delete process.env.DATA_ROOT;
    } else {
      process.env.DATA_ROOT = previousDataRoot;
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
