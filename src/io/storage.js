import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DATA_DIR = resolve(process.cwd(), 'data');
const RUNS_DIR = resolve(DATA_DIR, 'runs');
const ERRORS_DIR = resolve(DATA_DIR, 'errors');
const LATEST_PATH = resolve(DATA_DIR, 'latest.json');
const RUNS_INDEX_PATH = resolve(RUNS_DIR, 'index.json');

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

export async function ensureStorage() {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(RUNS_DIR, { recursive: true });
  await mkdir(ERRORS_DIR, { recursive: true });
}

export async function saveLatestSnapshot(payload) {
  await ensureStorage();
  await writeJsonAtomic(LATEST_PATH, payload);
}

export async function saveDailyRun(runDate, payload) {
  await ensureStorage();
  const targetPath = resolve(RUNS_DIR, `${runDate}.json`);
  await writeJsonAtomic(targetPath, payload);
  return `${runDate}.json`;
}

export async function saveDailyErrors(runDate, payload) {
  await ensureStorage();
  const targetPath = resolve(ERRORS_DIR, `${runDate}.json`);
  await writeJsonAtomic(targetPath, payload);
}

export async function readRunsIndex() {
  try {
    const raw = await readFile(RUNS_INDEX_PATH, 'utf8');
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

  await writeJsonAtomic(RUNS_INDEX_PATH, payload);
  return payload;
}
