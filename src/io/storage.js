import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { mirrorDataDir, primaryDataDir } from './paths.js';
import { inferRunDate, inferRunIdFromFileName, runFileName } from '../utils/run_id.js';
import { sleep } from '../utils/pool.js';

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

function primaryPaths() {
  return buildStoragePaths(primaryDataDir());
}

function mirrorPaths() {
  return buildStoragePaths(mirrorDataDir());
}

function storagePaths() {
  return [primaryPaths(), mirrorPaths()];
}

function storageLockPath() {
  return resolve(primaryDataDir(), '.storage.lock');
}

function stripBom(text) {
  if (!text) return text;
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
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

  throw new Error(`Could not acquire storage lock: ${lockPath}`);
}

async function withStorageLock(work) {
  const lock = await acquireLock(storageLockPath());

  try {
    return await work();
  } finally {
    await lock.close().catch(() => undefined);
    await rm(storageLockPath(), { force: true }).catch(() => undefined);
  }
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
  await Promise.all(storagePaths().map((paths) => ensureStoragePaths(paths)));
}

function sortFilesDescending(files) {
  return [...new Set(files.filter(Boolean))].sort((a, b) => b.localeCompare(a));
}

function sortRunEntries(entries) {
  return [...entries].sort((left, right) => {
    const leftKey = left.generated_at || left.run_id || left.run_file;
    const rightKey = right.generated_at || right.run_id || right.run_file;
    return String(rightKey).localeCompare(String(leftKey));
  });
}

function normalizeRunEntry(rawEntry) {
  if (!rawEntry || typeof rawEntry !== 'object') return null;

  const runFile = rawEntry.run_file || rawEntry.file || runFileName(rawEntry.run_id || inferRunIdFromFileName(rawEntry.run_file || ''));
  const runId = rawEntry.run_id || inferRunIdFromFileName(runFile);
  const runDate = rawEntry.run_date || inferRunDate(rawEntry.generated_at) || inferRunDate(runId);
  if (!runId || !runFile || !runDate) return null;

  return {
    run_id: runId,
    run_date: runDate,
    generated_at: rawEntry.generated_at || null,
    run_file: runFile,
    error_file: rawEntry.error_file || runFileName(runId),
    success_count: Number.isFinite(Number(rawEntry.success_count)) ? Number(rawEntry.success_count) : null,
    failure_count: Number.isFinite(Number(rawEntry.failure_count)) ? Number(rawEntry.failure_count) : null,
    status: rawEntry.status || 'unknown',
  };
}

function buildDailyEntries(runEntries) {
  const grouped = new Map();

  sortRunEntries(runEntries).forEach((entry) => {
    const bucket = grouped.get(entry.run_date) || [];
    bucket.push(entry);
    grouped.set(entry.run_date, bucket);
  });

  return [...grouped.entries()]
    .sort((left, right) => right[0].localeCompare(left[0]))
    .map(([runDate, entries]) => ({
      run_date: runDate,
      run_ids: entries.map((entry) => entry.run_id),
      latest_run_id: entries[0]?.run_id || null,
      total_runs: entries.length,
    }));
}

function normalizeManifest(parsed) {
  const rawFiles = Array.isArray(parsed?.files) ? parsed.files.filter((item) => typeof item === 'string') : [];
  const rawRuns = Array.isArray(parsed?.runs) ? parsed.runs : [];
  const normalizedRuns = sortRunEntries([
    ...rawRuns.map(normalizeRunEntry).filter(Boolean),
    ...rawFiles
      .map((file) => normalizeRunEntry({
        run_id: inferRunIdFromFileName(file),
        run_date: inferRunDate(file),
        run_file: file,
        error_file: file,
        status: 'unknown',
      }))
      .filter(Boolean),
  ]).filter((entry, index, list) => (
    list.findIndex((candidate) => candidate.run_id === entry.run_id) === index
  ));

  return {
    updated_at: parsed?.updated_at || null,
    files: sortFilesDescending(normalizedRuns.map((entry) => entry.run_file)),
    runs: normalizedRuns,
    daily: buildDailyEntries(normalizedRuns),
  };
}

export async function readRunsIndex() {
  try {
    const raw = await readFile(primaryPaths().runsIndexPath, 'utf8');
    const parsed = JSON.parse(stripBom(raw));
    return normalizeManifest(parsed);
  } catch {
    return {
      updated_at: null,
      files: [],
      runs: [],
      daily: [],
    };
  }
}

async function readJsonSafe(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(stripBom(raw));
  } catch {
    return null;
  }
}

function isUsableHistoricalResult(result) {
  const price = Number(result?.price);
  return Number.isFinite(price) && price > 0;
}

export async function findLatestSuccessfulResults(productIds) {
  const pending = new Set((productIds || []).filter(Boolean));
  const matches = new Map();

  if (pending.size === 0) {
    return matches;
  }

  const manifest = await readRunsIndex();
  for (const entry of manifest.runs) {
    if (pending.size === 0) break;
    if (!entry?.run_file) continue;

    const runPayload = await readJsonSafe(resolve(primaryPaths().runsDir, entry.run_file));
    if (!runPayload || !Array.isArray(runPayload.results)) continue;

    for (const result of runPayload.results) {
      if (!pending.has(result?.product_id) || !isUsableHistoricalResult(result)) {
        continue;
      }

      matches.set(result.product_id, {
        ...result,
        run_id: runPayload.run_id || entry.run_id || inferRunIdFromFileName(entry.run_file),
        run_date: runPayload.run_date || entry.run_date || inferRunDate(entry.run_file),
      });
      pending.delete(result.product_id);
    }
  }

  return matches;
}

export async function persistRunOutputs({
  runId,
  runDate,
  generatedAt,
  runPayload,
  errorPayload,
  latestPayload = null,
  status = 'success',
}) {
  if (!runId || !runDate) {
    throw new Error('persistRunOutputs requires runId and runDate');
  }

  const runFile = runFileName(runId);
  const errorFile = runFileName(runId);

  return withStorageLock(async () => {
    await ensureStorage();
    const pathsList = storagePaths();

    await Promise.all(pathsList.flatMap((paths) => [
      writeJsonAtomic(resolve(paths.runsDir, runFile), runPayload),
      writeJsonAtomic(resolve(paths.errorsDir, errorFile), errorPayload),
      ...(latestPayload ? [writeJsonAtomic(paths.latestPath, latestPayload)] : []),
    ]));

    const current = await readRunsIndex();
    const nextRuns = sortRunEntries([
      {
        run_id: runId,
        run_date: runDate,
        generated_at: generatedAt,
        run_file: runFile,
        error_file: errorFile,
        success_count: Number(runPayload?.summary?.success_count || 0),
        failure_count: Number(runPayload?.summary?.failure_count || 0),
        status,
      },
      ...current.runs.filter((entry) => entry.run_id !== runId),
    ]);

    const manifest = {
      updated_at: new Date().toISOString(),
      files: sortFilesDescending(nextRuns.map((entry) => entry.run_file)),
      runs: nextRuns,
      daily: buildDailyEntries(nextRuns),
    };

    await Promise.all(pathsList.map((paths) => writeJsonAtomic(paths.runsIndexPath, manifest)));
    return {
      manifest,
      run_file: runFile,
      error_file: errorFile,
    };
  });
}
