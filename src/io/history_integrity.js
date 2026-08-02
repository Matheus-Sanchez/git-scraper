import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { mirrorDataDir, primaryDataDir } from './paths.js';
import { inspectRunsIndex } from './storage.js';
import { inferRunDate, inferRunIdFromFileName } from '../utils/run_id.js';
import {
  validateHistoryErrorPayload,
  validateHistoryRunPayload,
  validateLatestHistoryPayload,
} from '../schema/history.js';

function issue(code, file, message) {
  return { code, file, message, severity: 'error' };
}

async function listFiles(directory) {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function readBufferSafe(filePath) {
  try {
    return { buffer: await readFile(filePath), error: null };
  } catch (error) {
    return { buffer: null, error };
  }
}

function schemaMessage(validation) {
  return validation.error.issues
    .map((entry) => `${entry.path.join('.') || '<root>'}: ${entry.message}`)
    .join('; ');
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalizeJson(value[key])]),
    );
  }
  return value;
}

function semanticallyEqual(left, right) {
  return JSON.stringify(canonicalizeJson(left)) === JSON.stringify(canonicalizeJson(right));
}

function relevantSummary(summary) {
  return {
    total_products: summary.total_products,
    success_count: summary.success_count,
    failure_count: summary.failure_count,
  };
}

function latestRunConsistencyIssues({ latest, run, expectedEntry, latestPath }) {
  const comparisons = [
    {
      code: 'latest_payload_generated_at_mismatch',
      label: 'generated_at',
      left: latest.generated_at,
      right: run.generated_at,
    },
    {
      code: 'latest_payload_summary_mismatch',
      label: 'summary counts',
      left: relevantSummary(latest.summary),
      right: relevantSummary(run.summary),
    },
    {
      code: 'latest_payload_items_mismatch',
      label: 'items/results',
      left: latest.items,
      right: run.results,
    },
    {
      code: 'latest_payload_failures_mismatch',
      label: 'failures',
      left: latest.failures,
      right: run.failures,
    },
    {
      code: 'latest_payload_offers_mismatch',
      label: 'offers',
      left: latest.offers,
      right: run.offers,
    },
  ];

  const issues = comparisons
    .filter((comparison) => !semanticallyEqual(comparison.left, comparison.right))
    .map((comparison) => issue(
      comparison.code,
      latestPath,
      `Latest ${comparison.label} differs from canonical run ${expectedEntry.run_id}`,
    ));

  const effectiveRunId = latest.run_id || inferRunIdFromFileName(latest.run_file);
  if (effectiveRunId !== expectedEntry.run_id) {
    issues.push(issue(
      'latest_payload_stale',
      latestPath,
      `Latest payload references ${effectiveRunId || '<unknown>'}; expected ${expectedEntry.run_id}`,
    ));
  }
  if (latest.run_file !== expectedEntry.run_file) {
    issues.push(issue(
      'latest_payload_file_mismatch',
      latestPath,
      `Latest run_file ${latest.run_file || '<missing>'} does not match ${expectedEntry.run_file}`,
    ));
  }

  return issues;
}

function errorRunConsistencyIssues({ errorPayload, run, runId, errorPath }) {
  const issues = [];
  if (errorPayload.generated_at !== run.generated_at) {
    issues.push(issue(
      'error_payload_generated_at_mismatch',
      errorPath,
      `Error generated_at differs from canonical run ${runId}`,
    ));
  }
  if (!semanticallyEqual(errorPayload.errors, run.failures)) {
    issues.push(issue(
      'error_payload_failures_mismatch',
      errorPath,
      `Error records differ from failures in canonical run ${runId}`,
    ));
  }
  return issues;
}

async function validateJsonFile(filePath, validator, code) {
  let parsed;
  try {
    const raw = await readFile(filePath, 'utf8');
    parsed = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch (error) {
    return {
      data: null,
      issues: [issue(`${code}_invalid_json`, filePath, error.message)],
    };
  }

  const validation = validator(parsed);
  return validation.success
    ? { data: validation.data, issues: [] }
    : {
      data: null,
      issues: [issue(`${code}_invalid_schema`, filePath, schemaMessage(validation))],
    };
}

async function compareDirectory(primaryDir, mirrorDir, { include, label }) {
  const primaryFiles = (await listFiles(primaryDir)).filter(include);
  const mirrorFiles = (await listFiles(mirrorDir)).filter(include);
  const primarySet = new Set(primaryFiles);
  const mirrorSet = new Set(mirrorFiles);
  const issues = [];

  for (const file of primaryFiles) {
    if (!mirrorSet.has(file)) {
      issues.push(issue('mirror_file_missing', resolve(mirrorDir, file), `${label} mirror is missing ${file}`));
      continue;
    }

    const [primary, mirror] = await Promise.all([
      readBufferSafe(resolve(primaryDir, file)),
      readBufferSafe(resolve(mirrorDir, file)),
    ]);
    if (primary.error || mirror.error || !primary.buffer.equals(mirror.buffer)) {
      issues.push(issue('mirror_file_mismatch', resolve(mirrorDir, file), `${label} mirror differs for ${file}`));
    }
  }

  for (const file of mirrorFiles) {
    if (!primarySet.has(file)) {
      issues.push(issue('mirror_file_extra', resolve(mirrorDir, file), `${label} mirror has stale file ${file}`));
    }
  }

  return { issues, primaryFiles, mirrorFiles };
}

async function temporaryArtifactIssues(directories) {
  const issues = [];
  for (const directory of directories) {
    const files = await listFiles(directory);
    for (const file of files.filter((name) => name.includes('.tmp-') || name.endsWith('.tmp'))) {
      issues.push(issue('temporary_artifact', resolve(directory, file), 'Interrupted atomic-write artifact remains on disk'));
    }
  }
  return issues;
}

export async function inspectHistoryIntegrity() {
  const primary = primaryDataDir();
  const mirror = mirrorDataDir();
  const indexInspection = await inspectRunsIndex();
  const issues = [...indexInspection.issues];

  const [runsParity, errorsParity, latestParity, productsParity] = await Promise.all([
    compareDirectory(resolve(primary, 'runs'), resolve(mirror, 'runs'), {
      include: (file) => file.endsWith('.json'),
      label: 'run',
    }),
    compareDirectory(resolve(primary, 'errors'), resolve(mirror, 'errors'), {
      include: (file) => file.endsWith('.json'),
      label: 'error',
    }),
    compareDirectory(primary, mirror, {
      include: (file) => file === 'latest.json',
      label: 'latest',
    }),
    compareDirectory(primary, mirror, {
      include: (file) => file === 'products.json',
      label: 'products',
    }),
  ]);
  issues.push(
    ...runsParity.issues,
    ...errorsParity.issues,
    ...latestParity.issues,
    ...productsParity.issues,
  );

  const errorFiles = new Set(errorsParity.primaryFiles);
  const referencedErrorFiles = new Set(indexInspection.manifest.runs.map((entry) => entry.error_file));
  const runEntryByErrorFile = new Map(
    indexInspection.manifest.runs.map((entry) => [entry.error_file, entry]),
  );
  for (const entry of indexInspection.manifest.runs) {
    if (!errorFiles.has(entry.error_file)) {
      issues.push(issue(
        'run_error_file_missing',
        resolve(primary, 'errors', entry.error_file),
        `Run ${entry.run_id} references a missing error payload`,
      ));
    }
  }

  for (const file of errorsParity.primaryFiles) {
    const validation = await validateJsonFile(
      resolve(primary, 'errors', file),
      validateHistoryErrorPayload,
      'error_payload',
    );
    issues.push(...validation.issues);
    if (validation.data) {
      const inferredRunId = inferRunIdFromFileName(file);
      const inferredRunDate = inferRunDate(file);
      if (validation.data.run_id && validation.data.run_id !== inferredRunId) {
        issues.push(issue(
          'error_payload_identity_mismatch',
          resolve(primary, 'errors', file),
          `Payload run_id ${validation.data.run_id} does not match ${file}`,
        ));
      }
      if (inferredRunDate && validation.data.run_date !== inferredRunDate) {
        issues.push(issue(
          'error_payload_date_mismatch',
          resolve(primary, 'errors', file),
          `Payload run_date ${validation.data.run_date} does not match ${file}`,
        ));
      }

      const runEntry = runEntryByErrorFile.get(file);
      if (runEntry) {
        const runValidation = await validateJsonFile(
          resolve(primary, 'runs', runEntry.run_file),
          validateHistoryRunPayload,
          'error_canonical_run',
        );
        issues.push(...runValidation.issues);
        if (runValidation.data) {
          issues.push(...errorRunConsistencyIssues({
            errorPayload: validation.data,
            run: runValidation.data,
            runId: runEntry.run_id,
            errorPath: resolve(primary, 'errors', file),
          }));
        }
      }
    }
    if (!referencedErrorFiles.has(file)) {
      issues.push(issue(
        'error_payload_orphan',
        resolve(primary, 'errors', file),
        `${file} is not referenced by any run`,
      ));
    }
  }

  if (latestParity.primaryFiles.includes('latest.json')) {
    const latestPath = resolve(primary, 'latest.json');
    const latestValidation = await validateJsonFile(
      latestPath,
      validateLatestHistoryPayload,
      'latest_payload',
    );
    issues.push(...latestValidation.issues);
    if (latestValidation.data) {
      const expectedLatest = indexInspection.manifest.runs.find((entry) => entry.status !== 'fatal');
      if (expectedLatest) {
        const runValidation = await validateJsonFile(
          resolve(primary, 'runs', expectedLatest.run_file),
          validateHistoryRunPayload,
          'latest_canonical_run',
        );
        issues.push(...runValidation.issues);
        if (runValidation.data) {
          issues.push(...latestRunConsistencyIssues({
            latest: latestValidation.data,
            run: runValidation.data,
            expectedEntry: expectedLatest,
            latestPath,
          }));
        }
      }
    }
  } else {
    issues.push(issue('latest_missing', resolve(primary, 'latest.json'), 'Primary latest payload is missing'));
  }

  issues.push(...await temporaryArtifactIssues([
    primary,
    resolve(primary, 'runs'),
    resolve(primary, 'errors'),
    mirror,
    resolve(mirror, 'runs'),
    resolve(mirror, 'errors'),
  ]));

  return {
    ok: issues.length === 0,
    issues,
    manifest: indexInspection.manifest,
    stats: {
      ...indexInspection.stats,
      mirrored_run_files: runsParity.mirrorFiles.filter((file) => file !== 'index.json').length,
      error_files: errorsParity.primaryFiles.length,
      mirrored_error_files: errorsParity.mirrorFiles.length,
    },
  };
}
