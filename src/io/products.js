import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ZodError } from 'zod';
import { mirrorDataDir, primaryDataDir } from './paths.js';
import { parseStoredProducts } from '../schema/catalog.js';
import { sleep } from '../utils/pool.js';

function primaryProductsPath() {
  return resolve(primaryDataDir(), 'products.json');
}

function mirrorProductsPath() {
  return resolve(mirrorDataDir(), 'products.json');
}

function productsTargetPaths() {
  return [primaryProductsPath(), mirrorProductsPath()];
}

function productsLockPath() {
  return resolve(primaryDataDir(), '.products.lock');
}

export function productsPath() {
  return primaryProductsPath();
}

function toErrorMessage(error) {
  if (!error) return 'unknown error';
  if (error instanceof Error) return error.message;
  return String(error);
}

function stripBom(text) {
  if (!text) return text;
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function schemaErrorToMessage(error) {
  if (!(error instanceof ZodError)) {
    return toErrorMessage(error);
  }

  return error.issues
    .map((issue) => {
      const location = issue.path.length > 0 ? issue.path.join('.') : 'root';
      return `${location}: ${issue.message}`;
    })
    .join('; ');
}

async function acquireLock(lockPath, { retries = 40, retryDelayMs = 150 } = {}) {
  await mkdir(dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await open(lockPath, 'wx');
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }

      await sleep(retryDelayMs);
    }
  }

  throw new Error(`Could not acquire products lock after retries: ${lockPath}`);
}

async function writeJsonAtomic(targetPath, payload) {
  await mkdir(dirname(targetPath), { recursive: true });

  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  const body = `${JSON.stringify(payload, null, 2)}\n`;

  await writeFile(tempPath, body, 'utf8');
  await rename(tempPath, targetPath);
}

export async function readProducts() {
  const raw = await readFile(primaryProductsPath(), 'utf8');
  const parsed = JSON.parse(stripBom(raw));

  if (!Array.isArray(parsed)) {
    throw new Error('data/products.json must contain an array');
  }

  return parseStoredProducts(parsed);
}

export async function writeProducts(products) {
  if (!Array.isArray(products)) {
    throw new TypeError('products must be an array');
  }

  const validated = parseStoredProducts(products);
  const lock = await acquireLock(productsLockPath());

  try {
    await Promise.all(productsTargetPaths().map((targetPath) => writeJsonAtomic(targetPath, validated)));
  } finally {
    await lock.close().catch(() => undefined);
    await rm(productsLockPath(), { force: true }).catch(() => undefined);
  }
}

export function toSafeProductReadError(error) {
  return schemaErrorToMessage(error);
}
