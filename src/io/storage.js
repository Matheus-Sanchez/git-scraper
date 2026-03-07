import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const PRIMARY_DATA_DIR = resolve(process.cwd(), 'data');
const MIRROR_DATA_DIR = resolve(process.cwd(), 'docs', 'data');

function buildStoragePaths(dataDir) {
  const runsDir = resolve(dataDir, 'runs');
  return {
    dataDir,
    runsDir,
    errorsDir: resolve(dataDir, 'errors'),
    latestPath: resolve(dataDir, 'latest.json'),
    runsIndexPath: resolve(runsDir, 'index.json'),
  };
}

const PRIMARY_PATHS = buildStoragePaths(PRIMARY_DATA_DIR);
const MIRROR_PATHS = buildStoragePaths(MIRROR_DATA_DIR);
const STORAGE_PATHS = [PRIMARY_PATHS, MIRROR_PATHS];

function stripBom(text) {
  if (!text) return text;
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

async function writeJsonAtomic(targetPath, payload) {
  await mkdir(dirname(targetPath), { recursive: true });

  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await rename(tempPath, targetPath);
}

async function ensureStoragePaths(paths) {
  await mkdir(paths.dataDir, { recursive: true });
  await mkdir(paths.runsDir, { recursive: true });
  await mkdir(paths.errorsDir, { recursive: true });
}

export async function ensureStorage() {
  await Promise.all(STORAGE_PATHS.map((paths) => ensureStoragePaths(paths)));
}

export async function saveLatestSnapshot(payload) {
  await ensureStorage();
  await Promise.all(STORAGE_PATHS.map((paths) => writeJsonAtomic(paths.latestPath, payload)));
}

export async function saveDailyRun(runDate, payload) {
  await ensureStorage();
  await Promise.all(
    STORAGE_PATHS.map((paths) => writeJsonAtomic(resolve(paths.runsDir, `${runDate}.json`), payload)),
  );
  return `${runDate}.json`;
}

export async function saveDailyErrors(runDate, payload) {
  await ensureStorage();
  await Promise.all(
    STORAGE_PATHS.map((paths) => writeJsonAtomic(resolve(paths.errorsDir, `${runDate}.json`), payload)),
  );
}

export async function readRunsIndex() {
  try {
    const raw = await readFile(PRIMARY_PATHS.runsIndexPath, 'utf8');
    const parsed = JSON.parse(stripBom(raw));

    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.files)) {
      return { updated_at: null, files: [] };
    }

    return {
      updated_at: parsed.updated_at || null,
      files: parsed.files.filter((item) => typeof item === 'string'),
    };
  } catch {
    return { updated_at: null, files: [] };
  }
}

export async function updateRunsIndex(newRunFile) {
  const current = await readRunsIndex();
  const merged = [newRunFile, ...current.files].filter((item, index, arr) => arr.indexOf(item) === index);
  merged.sort((a, b) => b.localeCompare(a));

  const payload = {
    updated_at: new Date().toISOString(),
    files: merged,
  };

  await ensureStorage();
  await Promise.all(STORAGE_PATHS.map((paths) => writeJsonAtomic(paths.runsIndexPath, payload)));
  return payload;
}
