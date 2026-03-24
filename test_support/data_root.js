import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

export async function makeTempDataRoot(prefix = 'git-scraper-test-') {
  const root = await mkdtemp(resolve(tmpdir(), prefix));

  await Promise.all([
    mkdir(resolve(root, 'data'), { recursive: true }),
    mkdir(resolve(root, 'docs', 'data'), { recursive: true }),
  ]);

  return root;
}

export async function withDataRoot(dataRoot, callback) {
  const previousDataRoot = process.env.DATA_ROOT;
  process.env.DATA_ROOT = dataRoot;

  try {
    return await callback();
  } finally {
    if (previousDataRoot === undefined) {
      delete process.env.DATA_ROOT;
    } else {
      process.env.DATA_ROOT = previousDataRoot;
    }
  }
}

export async function writeText(dataRoot, relativePath, body) {
  const filePath = resolve(dataRoot, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, body, 'utf8');
  return filePath;
}

export async function writeJson(dataRoot, relativePath, payload) {
  return writeText(dataRoot, relativePath, `${JSON.stringify(payload, null, 2)}\n`);
}

export async function writeProducts(dataRoot, productsBody) {
  const body = typeof productsBody === 'string'
    ? productsBody
    : `${JSON.stringify(productsBody, null, 2)}\n`;

  return writeText(dataRoot, 'data/products.json', body);
}

export async function readText(dataRoot, relativePath) {
  return readFile(resolve(dataRoot, relativePath), 'utf8');
}

export async function readJson(dataRoot, relativePath) {
  return JSON.parse(await readText(dataRoot, relativePath));
}
