import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { mirrorDataDir, primaryDataDir } from './paths.js';
import {
  validateHistoryErrorPayload,
  validateHistoryManifestPayload,
  validateHistoryRunPayload,
  validateLatestHistoryPayload,
} from '../schema/history.js';
import { inferRunDate, inferRunIdFromFileName, runFileName } from '../utils/run_id.js';
import { runWithPool, sleep } from '../utils/pool.js';

const STORAGE_SCAN_CONCURRENCY = 16;
const STORAGE_LOCK_STALE_MS = 30 * 60 * 1000;

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
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      const handle = await open(lockPath, 'wx');
      try {
        await handle.writeFile(`${JSON.stringify({
          pid: process.pid,
          token,
          acquired_at: new Date().toISOString(),
        })}\n`, 'utf8');
      } catch (error) {
        await handle.close().catch(() => undefined);
        await rm(lockPath, { force: true }).catch(() => undefined);
        throw error;
      }
      return { handle, token };
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }

      if (await removeAbandonedLock(lockPath)) {
        continue;
      }
      await sleep(retryDelayMs);
    }
  }

  throw new Error(`Could not acquire storage lock: ${lockPath}`);
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    return true;
  }
}

async function readLockSnapshot(lockPath) {
  try {
    const [body, metadata] = await Promise.all([
      readFile(lockPath, 'utf8'),
      stat(lockPath),
    ]);
    let parsed = null;
    try {
      parsed = JSON.parse(stripBom(body));
    } catch {
      // An interrupted legacy lock is handled by its file age below.
    }
    return { parsed, metadata };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function removeAbandonedLock(lockPath) {
  const snapshot = await readLockSnapshot(lockPath);
  if (!snapshot) return true;

  const acquiredAt = Date.parse(snapshot.parsed?.acquired_at || '');
  const ageAnchor = Number.isFinite(acquiredAt) ? acquiredAt : snapshot.metadata.mtimeMs;
  const oldEnough = Date.now() - ageAnchor > STORAGE_LOCK_STALE_MS;
  const ownerAlive = processIsAlive(Number(snapshot.parsed?.pid));
  const abandoned = ownerAlive === false || (ownerAlive === null && oldEnough);
  if (!abandoned) return false;

  const confirmation = await readLockSnapshot(lockPath);
  if (!confirmation) return true;
  if ((confirmation.parsed?.token || null) !== (snapshot.parsed?.token || null)
    || confirmation.metadata.mtimeMs !== snapshot.metadata.mtimeMs
    || confirmation.metadata.size !== snapshot.metadata.size) {
    return false;
  }

  await rm(lockPath, { force: true });
  return true;
}

async function releaseLock(lockPath, lock) {
  await lock.handle.close().catch(() => undefined);
  const snapshot = await readLockSnapshot(lockPath).catch(() => null);
  if (snapshot?.parsed?.token === lock.token) {
    await rm(lockPath, { force: true }).catch(() => undefined);
  }
}

async function withStorageLock(work) {
  const lockPath = storageLockPath();
  const lock = await acquireLock(lockPath);

  try {
    return await work();
  } finally {
    await releaseLock(lockPath, lock);
  }
}

async function writeJsonAtomic(targetPath, payload) {
  await mkdir(dirname(targetPath), { recursive: true });

  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, serializeJsonPayload(payload));
  await rename(tempPath, targetPath);
}

function serializeJsonPayload(payload) {
  return Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function writeBufferAtomic(targetPath, payload) {
  await mkdir(dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, payload);
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

function toFiniteNumberOrNull(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
    success_count: toFiniteNumberOrNull(rawEntry.success_count),
    failure_count: toFiniteNumberOrNull(rawEntry.failure_count),
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

function emptyManifest() {
  return {
    updated_at: null,
    files: [],
    runs: [],
    daily: [],
  };
}

function toIssue({ code, file, message, severity = 'error' }) {
  return { code, file, message, severity };
}

function deriveRunStatus(runPayload, errorPayload, manifestEntry) {
  if (errorPayload?.fatal === true) return 'fatal';

  const failureCount = toFiniteNumberOrNull(runPayload?.summary?.failure_count);
  if (failureCount !== null) {
    return failureCount > 0 ? 'partial' : 'success';
  }

  return manifestEntry?.status || 'unknown';
}

function formatSchemaIssues(validation) {
  return validation.error.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
}

async function readManifestSource(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(stripBom(raw));
    const validation = validateHistoryManifestPayload(parsed);
    return {
      parsed,
      manifest: normalizeManifest(parsed),
      issue: validation.success
        ? null
        : toIssue({
          code: 'manifest_invalid_schema',
          file: filePath,
          message: `Runs manifest is invalid: ${formatSchemaIssues(validation)}`,
          severity: 'warning',
        }),
    };
  } catch (error) {
    const missing = error?.code === 'ENOENT';
    return {
      parsed: null,
      manifest: emptyManifest(),
      issue: toIssue({
        code: missing ? 'manifest_missing' : 'manifest_invalid',
        file: filePath,
        message: missing
          ? 'Runs manifest is missing; run files will be used as the source of truth'
          : `Runs manifest could not be parsed: ${error.message}`,
        severity: 'warning',
      }),
    };
  }
}

async function listRunFiles(runsDir) {
  try {
    return (await readdir(runsDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'index.json')
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function buildRunEntryFromFile(paths, fileName, manifestByRunId) {
  const filePath = resolve(paths.runsDir, fileName);
  let rawPayload;

  try {
    rawPayload = JSON.parse(stripBom(await readFile(filePath, 'utf8')));
  } catch (error) {
    return {
      entry: null,
      issue: toIssue({
        code: 'run_invalid_json',
        file: filePath,
        message: `Run payload could not be parsed: ${error.message}`,
      }),
    };
  }

  const validation = validateHistoryRunPayload(rawPayload);
  if (!validation.success) {
    return {
      entry: null,
      issue: toIssue({
        code: 'run_invalid_schema',
        file: filePath,
        message: `Run payload is invalid: ${formatSchemaIssues(validation)}`,
      }),
    };
  }

  const runPayload = validation.data;
  const inferredRunId = inferRunIdFromFileName(fileName);
  const inferredRunDate = inferRunDate(fileName);
  const runId = runPayload.run_id || inferredRunId;
  if (runPayload.run_id && runPayload.run_id !== inferredRunId) {
    return {
      entry: null,
      issue: toIssue({
        code: 'run_identity_mismatch',
        file: filePath,
        message: `Payload run_id ${runPayload.run_id} does not match file ${fileName}`,
      }),
    };
  }
  if (inferredRunDate && runPayload.run_date !== inferredRunDate) {
    return {
      entry: null,
      issue: toIssue({
        code: 'run_date_mismatch',
        file: filePath,
        message: `Payload run_date ${runPayload.run_date} does not match file ${fileName}`,
      }),
    };
  }

  const manifestEntry = manifestByRunId.get(runId);
  const errorFile = runFileName(runId);
  const errorPayload = await readJsonSafe(resolve(paths.errorsDir, errorFile));

  return {
    entry: {
      run_id: runId,
      run_date: runPayload.run_date || inferRunDate(runPayload.generated_at) || inferRunDate(runId),
      generated_at: runPayload.generated_at || null,
      run_file: fileName,
      error_file: errorFile,
      success_count: toFiniteNumberOrNull(runPayload.summary?.success_count),
      failure_count: toFiniteNumberOrNull(runPayload.summary?.failure_count),
      status: deriveRunStatus(runPayload, errorPayload, manifestEntry),
    },
    issue: null,
  };
}

async function scanRunEntries(paths, manifest) {
  const files = await listRunFiles(paths.runsDir);
  const manifestByRunId = new Map(manifest.runs.map((entry) => [entry.run_id, entry]));
  const entries = [];
  const issues = [];
  const seenRunIds = new Map();

  const scanResults = await runWithPool(
    files,
    STORAGE_SCAN_CONCURRENCY,
    (fileName) => buildRunEntryFromFile(paths, fileName, manifestByRunId),
  );

  for (let index = 0; index < files.length; index += 1) {
    const fileName = files[index];
    const result = scanResults[index];
    if (result?.unhandled) {
      issues.push(toIssue({
        code: 'run_read_failed',
        file: resolve(paths.runsDir, fileName),
        message: result.error,
      }));
      continue;
    }
    if (result.issue) {
      issues.push(result.issue);
      continue;
    }

    const previousFile = seenRunIds.get(result.entry.run_id);
    if (previousFile) {
      issues.push(toIssue({
        code: 'run_duplicate_id',
        file: resolve(paths.runsDir, fileName),
        message: `Run id ${result.entry.run_id} is also present in ${previousFile}`,
      }));
      continue;
    }

    seenRunIds.set(result.entry.run_id, fileName);
    entries.push(result.entry);
  }

  return { entries: sortRunEntries(entries), files, issues };
}

function declaredManifestProjection(parsed) {
  return {
    files: Array.isArray(parsed?.files) ? parsed.files : [],
    runs: Array.isArray(parsed?.runs)
      ? parsed.runs.map(normalizeRunEntry).filter(Boolean)
      : [],
    daily: Array.isArray(parsed?.daily)
      ? parsed.daily.map((entry) => ({
        run_date: entry?.run_date || null,
        run_ids: Array.isArray(entry?.run_ids) ? entry.run_ids : [],
        latest_run_id: entry?.latest_run_id || null,
        total_runs: toFiniteNumberOrNull(entry?.total_runs),
      }))
      : [],
  };
}

function manifestDifferenceIssues(paths, sourceManifest, sourceParsed, discoveredEntries) {
  const issues = [];
  const sourceFiles = new Set(sourceManifest.files);
  const discoveredFiles = new Set(discoveredEntries.map((entry) => entry.run_file));
  const missingFromManifest = [...discoveredFiles].filter((file) => !sourceFiles.has(file));
  const missingFromDisk = [...sourceFiles].filter((file) => !discoveredFiles.has(file));

  if (missingFromManifest.length > 0) {
    issues.push(toIssue({
      code: 'manifest_incomplete',
      file: paths.runsIndexPath,
      message: `Manifest omits ${missingFromManifest.length} run file(s) present on disk`,
      severity: 'warning',
    }));
  }

  if (missingFromDisk.length > 0) {
    issues.push(toIssue({
      code: 'manifest_stale',
      file: paths.runsIndexPath,
      message: `Manifest references ${missingFromDisk.length} run file(s) missing from disk`,
      severity: 'warning',
    }));
  }

  const discoveredManifest = {
    files: sortFilesDescending(discoveredEntries.map((entry) => entry.run_file)),
    runs: sortRunEntries(discoveredEntries),
    daily: buildDailyEntries(discoveredEntries),
  };
  const sourceCanonical = declaredManifestProjection(sourceParsed);
  if (JSON.stringify(sourceCanonical) !== JSON.stringify(discoveredManifest)) {
    issues.push(toIssue({
      code: 'manifest_metadata_mismatch',
      file: paths.runsIndexPath,
      message: 'Manifest runs or daily metadata differs from the canonical run payloads',
      severity: 'warning',
    }));
  }

  return issues;
}

async function listErrorFiles(errorsDir) {
  try {
    return (await readdir(errorsDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function readOptionalBuffer(filePath) {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function inspectImmutablePersistTargets({
  pathsList,
  runFile,
  errorFile,
  runPayload,
  errorPayload,
}) {
  const specs = [
    {
      kind: 'run',
      fileName: runFile,
      payload: runPayload,
      targetPath: (paths) => resolve(paths.runsDir, runFile),
    },
    {
      kind: 'error',
      fileName: errorFile,
      payload: errorPayload,
      targetPath: (paths) => resolve(paths.errorsDir, errorFile),
    },
  ];
  const issues = [];
  const existingKinds = new Set();

  for (const spec of specs) {
    const expected = serializeJsonPayload(spec.payload);
    for (const paths of pathsList) {
      const filePath = spec.targetPath(paths);
      const existing = await readOptionalBuffer(filePath);
      if (!existing) continue;

      existingKinds.add(spec.kind);
      if (!existing.equals(expected)) {
        issues.push(toIssue({
          code: `${spec.kind}_immutable_conflict`,
          file: filePath,
          message: `${spec.fileName} already exists with different bytes; historical payloads are immutable`,
        }));
      }
    }
  }

  return { issues, existingKinds };
}

function validateMirroredPayload({ kind, fileName, buffer, filePath }) {
  let parsed;
  try {
    parsed = JSON.parse(stripBom(buffer.toString('utf8')));
  } catch (error) {
    return {
      parsed: null,
      issue: toIssue({
        code: `${kind}_invalid_json`,
        file: filePath,
        message: `${kind === 'run' ? 'Run' : 'Error'} payload could not be parsed: ${error.message}`,
      }),
    };
  }

  const validation = kind === 'run'
    ? validateHistoryRunPayload(parsed)
    : validateHistoryErrorPayload(parsed);
  if (!validation.success) {
    return {
      parsed: null,
      issue: toIssue({
        code: `${kind}_invalid_schema`,
        file: filePath,
        message: `${kind === 'run' ? 'Run' : 'Error'} payload is invalid: ${formatSchemaIssues(validation)}`,
      }),
    };
  }

  const payload = validation.data;
  const inferredRunId = inferRunIdFromFileName(fileName);
  const inferredRunDate = inferRunDate(fileName);
  if (payload.run_id && payload.run_id !== inferredRunId) {
    return {
      parsed: null,
      issue: toIssue({
        code: `${kind}_identity_mismatch`,
        file: filePath,
        message: `Payload run_id ${payload.run_id} does not match file ${fileName}`,
      }),
    };
  }
  if (inferredRunDate && payload.run_date !== inferredRunDate) {
    return {
      parsed: null,
      issue: toIssue({
        code: `${kind}_date_mismatch`,
        file: filePath,
        message: `Payload run_date ${payload.run_date} does not match file ${fileName}`,
      }),
    };
  }

  return { parsed: payload, issue: null };
}

async function planPayloadReconciliation() {
  const primary = primaryPaths();
  const mirror = mirrorPaths();
  const [primaryRunFiles, mirrorRunFiles, primaryErrorFiles, mirrorErrorFiles] = await Promise.all([
    listRunFiles(primary.runsDir),
    listRunFiles(mirror.runsDir),
    listErrorFiles(primary.errorsDir),
    listErrorFiles(mirror.errorsDir),
  ]);
  const specs = [
    ...[...new Set([...primaryRunFiles, ...mirrorRunFiles])].sort().map((fileName) => ({
      kind: 'run',
      fileName,
      primaryPath: resolve(primary.runsDir, fileName),
      mirrorPath: resolve(mirror.runsDir, fileName),
    })),
    ...[...new Set([...primaryErrorFiles, ...mirrorErrorFiles])].sort().map((fileName) => ({
      kind: 'error',
      fileName,
      primaryPath: resolve(primary.errorsDir, fileName),
      mirrorPath: resolve(mirror.errorsDir, fileName),
    })),
  ];

  const inspected = await runWithPool(specs, STORAGE_SCAN_CONCURRENCY, async (spec) => {
    const [primaryBuffer, mirrorBuffer] = await Promise.all([
      readOptionalBuffer(spec.primaryPath),
      readOptionalBuffer(spec.mirrorPath),
    ]);
    if (primaryBuffer && mirrorBuffer && !primaryBuffer.equals(mirrorBuffer)) {
      return {
        spec,
        issue: toIssue({
          code: `${spec.kind}_mirror_conflict`,
          file: spec.mirrorPath,
          message: `${spec.fileName} differs between primary and mirror data roots`,
        }),
      };
    }

    const buffer = primaryBuffer || mirrorBuffer;
    const filePath = primaryBuffer ? spec.primaryPath : spec.mirrorPath;
    const validation = validateMirroredPayload({
      kind: spec.kind,
      fileName: spec.fileName,
      buffer,
      filePath,
    });
    return {
      spec,
      buffer,
      payload: validation.parsed,
      issue: validation.issue,
      missingPath: primaryBuffer ? (mirrorBuffer ? null : spec.mirrorPath) : spec.primaryPath,
    };
  });

  const issues = [];
  const copies = [];
  const runIds = new Set();
  const errorIds = new Set();
  inspected.forEach((result, index) => {
    if (result?.unhandled) {
      issues.push(toIssue({
        code: 'mirror_reconciliation_failed',
        file: specs[index].primaryPath,
        message: result.error,
      }));
      return;
    }
    if (result.issue) {
      issues.push(result.issue);
      return;
    }
    const runId = result.payload.run_id || inferRunIdFromFileName(result.spec.fileName);
    if (result.spec.kind === 'run') runIds.add(runId);
    else errorIds.add(runId);
    if (result.missingPath) {
      copies.push({ targetPath: result.missingPath, buffer: result.buffer });
    }
  });

  for (const runId of runIds) {
    if (!errorIds.has(runId)) {
      issues.push(toIssue({
        code: 'run_error_file_missing',
        file: resolve(primary.errorsDir, runFileName(runId)),
        message: `Run ${runId} has no matching error payload in either data root`,
      }));
    }
  }
  for (const errorId of errorIds) {
    if (!runIds.has(errorId)) {
      issues.push(toIssue({
        code: 'error_payload_orphan',
        file: resolve(primary.errorsDir, runFileName(errorId)),
        message: `Error payload ${errorId} has no matching run in either data root`,
      }));
    }
  }

  return { issues, copies };
}

async function applyReconciliationCopies(copies) {
  const results = await runWithPool(
    copies,
    STORAGE_SCAN_CONCURRENCY,
    ({ targetPath, buffer }) => writeBufferAtomic(targetPath, buffer),
  );
  const issues = results.flatMap((result, index) => (result?.unhandled ? [toIssue({
    code: 'mirror_recovery_write_failed',
    file: copies[index].targetPath,
    message: result.error,
  })] : []));
  if (issues.length > 0) {
    throw new HistoryIntegrityError(issues, emptyManifest());
  }
}

export class HistoryIntegrityError extends Error {
  constructor(issues, manifest) {
    const details = issues.map((issue) => `${issue.code}: ${issue.message}`).join(' | ');
    super(`Run history integrity check failed: ${details}`);
    this.name = 'HistoryIntegrityError';
    this.issues = issues;
    this.manifest = manifest;
  }
}

export async function inspectRunsIndex() {
  const paths = primaryPaths();
  const source = await readManifestSource(paths.runsIndexPath);
  const scanned = await scanRunEntries(paths, source.manifest);
  const issues = [
    ...(source.issue ? [source.issue] : []),
    ...scanned.issues,
    ...manifestDifferenceIssues(paths, source.manifest, source.parsed, scanned.entries),
  ];
  const manifest = {
    updated_at: source.manifest.updated_at,
    files: sortFilesDescending(scanned.entries.map((entry) => entry.run_file)),
    runs: scanned.entries,
    daily: buildDailyEntries(scanned.entries),
  };

  return {
    manifest,
    issues,
    stats: {
      discovered_run_files: scanned.files.length,
      valid_runs: scanned.entries.length,
      manifest_runs: source.manifest.runs.length,
    },
  };
}

export async function readRunsIndex() {
  const inspection = await inspectRunsIndex();
  const errors = inspection.issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) {
    throw new HistoryIntegrityError(errors, inspection.manifest);
  }

  if (inspection.issues.length > 0) {
    Object.defineProperty(inspection.manifest, 'diagnostics', {
      enumerable: false,
      value: inspection.issues,
    });
  }

  return inspection.manifest;
}

export async function rebuildRunsIndex() {
  return withStorageLock(async () => {
    await ensureStorage();
    const reconciliation = await planPayloadReconciliation();
    if (reconciliation.issues.length > 0) {
      throw new HistoryIntegrityError(reconciliation.issues, emptyManifest());
    }
    await applyReconciliationCopies(reconciliation.copies);

    const inspection = await inspectRunsIndex();
    const errors = inspection.issues.filter((issue) => issue.severity === 'error');
    if (errors.length > 0) {
      throw new HistoryIntegrityError(errors, inspection.manifest);
    }

    const manifest = {
      ...inspection.manifest,
      updated_at: new Date().toISOString(),
    };
    await Promise.all(storagePaths().map((paths) => writeJsonAtomic(paths.runsIndexPath, manifest)));

    return {
      manifest,
      issues: inspection.issues,
      stats: {
        ...inspection.stats,
        recovered_payloads: reconciliation.copies.length,
      },
    };
  });
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
  const carriedForward = result?.status === 'carried_forward'
    || result?.engine_used === 'carry_forward';
  return !carriedForward && Number.isFinite(price) && price > 0;
}

function assertPayloadValidation(label, payload, validator) {
  const validation = validator(payload);
  if (!validation.success) {
    throw new TypeError(`${label} is invalid: ${formatSchemaIssues(validation)}`);
  }
  return validation.data;
}

function assertIdentity(label, actual, expected) {
  if (actual !== expected) {
    throw new TypeError(`${label} must be ${expected}; received ${actual ?? 'null'}`);
  }
}

function assertMatchingSummary(runSummary, latestSummary) {
  for (const field of ['total_products', 'success_count', 'failure_count']) {
    if (runSummary[field] !== latestSummary[field]) {
      throw new TypeError(`latestPayload.summary.${field} must match runPayload.summary.${field}`);
    }
  }
}

function assertMatchingCollection(label, left, right) {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new TypeError(`${label} must match runPayload`);
  }
}

function validatePersistInput({
  runId,
  runDate,
  generatedAt,
  runFile,
  runPayload,
  errorPayload,
  latestPayload,
  status,
}) {
  const run = assertPayloadValidation('runPayload', runPayload, validateHistoryRunPayload);
  const error = assertPayloadValidation('errorPayload', errorPayload, validateHistoryErrorPayload);
  const latest = latestPayload === null
    ? null
    : assertPayloadValidation('latestPayload', latestPayload, validateLatestHistoryPayload);

  assertIdentity('runPayload.run_id', run.run_id, runId);
  assertIdentity('runPayload.run_date', run.run_date, runDate);
  assertIdentity('runPayload.generated_at', run.generated_at, generatedAt);
  assertIdentity('errorPayload.run_id', error.run_id, runId);
  assertIdentity('errorPayload.run_date', error.run_date, runDate);
  assertIdentity('errorPayload.generated_at', error.generated_at, generatedAt);
  if (latest) {
    assertIdentity('latestPayload.run_id', latest.run_id, runId);
    assertIdentity('latestPayload.generated_at', latest.generated_at, generatedAt);
    assertIdentity('latestPayload.run_file', latest.run_file, runFile);
    assertMatchingSummary(run.summary, latest.summary);
    assertMatchingCollection('latestPayload.items', latest.items, run.results);
    assertMatchingCollection('latestPayload.failures', latest.failures, run.failures);
    assertMatchingCollection('latestPayload.offers', latest.offers, run.offers);
  }
  assertMatchingCollection('errorPayload.errors', error.errors, run.failures);

  const derivedStatus = deriveRunStatus(run, error, null);
  if (status !== derivedStatus) {
    throw new TypeError(`status must be ${derivedStatus}; received ${status}`);
  }

  return {
    runPayload: run,
    errorPayload: error,
    latestPayload: latest,
  };
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
  const validated = validatePersistInput({
    runId,
    runDate,
    generatedAt,
    runFile,
    runPayload,
    errorPayload,
    latestPayload,
    status,
  });

  return withStorageLock(async () => {
    await ensureStorage();
    const pathsList = storagePaths();
    const immutableTargets = await inspectImmutablePersistTargets({
      pathsList,
      runFile,
      errorFile,
      runPayload: validated.runPayload,
      errorPayload: validated.errorPayload,
    });
    if (immutableTargets.issues.length > 0) {
      throw new HistoryIntegrityError(immutableTargets.issues, emptyManifest());
    }

    const reconciliation = await planPayloadReconciliation();
    if (reconciliation.issues.length > 0) {
      throw new HistoryIntegrityError(reconciliation.issues, emptyManifest());
    }
    await applyReconciliationCopies(reconciliation.copies);

    await Promise.all(pathsList.flatMap((paths) => [
      ...(immutableTargets.existingKinds.has('run')
        ? []
        : [writeJsonAtomic(resolve(paths.runsDir, runFile), validated.runPayload)]),
      ...(immutableTargets.existingKinds.has('error')
        ? []
        : [writeJsonAtomic(resolve(paths.errorsDir, errorFile), validated.errorPayload)]),
      ...(validated.latestPayload ? [writeJsonAtomic(paths.latestPath, validated.latestPayload)] : []),
    ]));

    const current = await readRunsIndex();
    const nextRuns = sortRunEntries([
      {
        run_id: runId,
        run_date: runDate,
        generated_at: generatedAt,
        run_file: runFile,
        error_file: errorFile,
        success_count: Number(validated.runPayload.summary.success_count),
        failure_count: Number(validated.runPayload.summary.failure_count),
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
