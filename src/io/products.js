import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { normalizeUrl } from '../utils/url.js';
import { sleep } from '../utils/pool.js';

const PRIMARY_PRODUCTS_PATH = resolve(process.cwd(), 'data', 'products.json');
const MIRROR_PRODUCTS_PATH = resolve(process.cwd(), 'docs', 'data', 'products.json');
const PRODUCTS_TARGET_PATHS = [PRIMARY_PRODUCTS_PATH, MIRROR_PRODUCTS_PATH];

export const PRODUCTS_PATH = PRIMARY_PRODUCTS_PATH;
const PRODUCTS_LOCK_PATH = resolve(process.cwd(), 'data', '.products.lock');

function toErrorMessage(error) {
  if (!error) return 'unknown error';
  if (error instanceof Error) return error.message;
  return String(error);
}

function stripBom(text) {
  if (!text) return text;
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function validateProduct(product, index) {
  if (!product || typeof product !== 'object') {
    throw new Error(`Invalid product at index ${index}: not an object`);
  }

  if (!product.id || typeof product.id !== 'string') {
    throw new Error(`Invalid product at index ${index}: missing id`);
  }

  if (!product.name || typeof product.name !== 'string') {
    throw new Error(`Invalid product at index ${index}: missing name`);
  }

  if (!product.url || typeof product.url !== 'string') {
    throw new Error(`Invalid product at index ${index}: missing url`);
  }

  product.url = normalizeUrl(product.url);

  if (typeof product.is_active !== 'boolean') {
    throw new Error(`Invalid product at index ${index}: is_active must be boolean`);
  }

  if (product.comparison_key !== undefined && product.comparison_key !== null) {
    if (typeof product.comparison_key !== 'string' || !product.comparison_key.trim()) {
      throw new Error(`Invalid product at index ${index}: comparison_key must be a non-empty string`);
    }
    product.comparison_key = product.comparison_key.trim();
  }

  if (product.units_per_package !== undefined && product.units_per_package !== null) {
    const units = Number(product.units_per_package);
    if (!Number.isFinite(units) || units <= 0) {
      throw new Error(`Invalid product at index ${index}: units_per_package must be > 0`);
    }
    product.units_per_package = units;
  }

  if (product.selectors && typeof product.selectors !== 'object') {
    throw new Error(`Invalid product at index ${index}: selectors must be object`);
  }

  return product;
}

async function acquireLock(lockPath, { retries = 25, retryDelayMs = 150 } = {}) {
  await mkdir(dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx');
      return handle;
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }

      await sleep(retryDelayMs);
    }
  }

  throw new Error(`Could not acquire lock: ${lockPath}`);
}

async function writeJsonAtomic(targetPath, payload) {
  await mkdir(dirname(targetPath), { recursive: true });

  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  const body = `${JSON.stringify(payload, null, 2)}\n`;

  await writeFile(tempPath, body, 'utf8');
  await rename(tempPath, targetPath);
}

export async function readProducts() {
  const raw = await readFile(PRIMARY_PRODUCTS_PATH, 'utf8');
  const parsed = JSON.parse(stripBom(raw));

  if (!Array.isArray(parsed)) {
    throw new Error('data/products.json must contain an array');
  }

  const validated = parsed.map((product, index) => validateProduct({ ...product }, index));
  return validated;
}

export async function writeProducts(products) {
  if (!Array.isArray(products)) {
    throw new TypeError('products must be an array');
  }

  const validated = products.map((product, index) => validateProduct({ ...product }, index));
  const lock = await acquireLock(PRODUCTS_LOCK_PATH);

  try {
    await Promise.all(PRODUCTS_TARGET_PATHS.map((targetPath) => writeJsonAtomic(targetPath, validated)));
  } finally {
    await lock.close().catch(() => undefined);
    await rm(PRODUCTS_LOCK_PATH, { force: true }).catch(() => undefined);
  }
}

export function toSafeProductReadError(error) {
  return toErrorMessage(error);
}
