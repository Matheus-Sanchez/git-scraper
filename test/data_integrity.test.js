import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectHistoryIntegrity } from '../src/io/history_integrity.js';
import { persistRunOutputs, rebuildRunsIndex } from '../src/io/storage.js';
import {
  makeTempDataRoot,
  readJson,
  withDataRoot,
  writeJson,
  writeText,
} from '../test_support/data_root.js';

function persistFixture(
  runId = '2026-03-14T09-50-43-123Z',
  runDate = '2026-03-14',
  generatedAt = '2026-03-14T09:50:43.123Z',
) {
  const summary = {
    total_products: 1,
    success_count: 1,
    failure_count: 0,
  };
  const results = [{ product_id: 'produto-a', price: 199.9, status: 'ok' }];
  return persistRunOutputs({
    runId,
    runDate,
    generatedAt,
    status: 'success',
    runPayload: {
      run_id: runId,
      run_date: runDate,
      generated_at: generatedAt,
      currency: 'BRL',
      summary,
      results,
      failures: [],
    },
    errorPayload: {
      run_id: runId,
      run_date: runDate,
      generated_at: generatedAt,
      engine_summary: {},
      errors: [],
    },
    latestPayload: {
      run_id: runId,
      generated_at: generatedAt,
      currency: 'BRL',
      summary,
      items: results,
      failures: [],
      run_file: `${runId}.json`,
    },
  });
}

test('inspectHistoryIntegrity accepts complete schema-valid mirrored history', async () => {
  const tempRoot = await makeTempDataRoot('git-scraper-integrity-');

  await withDataRoot(tempRoot, async () => {
    await persistFixture();

    const report = await inspectHistoryIntegrity();

    assert.equal(report.ok, true);
    assert.deepEqual(report.issues, []);
    assert.equal(report.stats.valid_runs, 1);
    assert.equal(report.stats.mirrored_run_files, 1);
  });
});

test('inspectHistoryIntegrity reports mirror drift, malformed error payloads, and temp files', async () => {
  const tempRoot = await makeTempDataRoot('git-scraper-integrity-');

  await withDataRoot(tempRoot, async () => {
    const runId = '2026-03-14T09-50-43-123Z';
    await persistFixture(runId);
    await writeJson(tempRoot, `docs/data/runs/${runId}.json`, {
      run_id: runId,
      changed: true,
    });
    const invalidError = {
      run_id: runId,
      run_date: 'not-a-date',
      generated_at: '',
      engine_summary: {},
      errors: [],
    };
    await writeJson(tempRoot, `data/errors/${runId}.json`, invalidError);
    await writeJson(tempRoot, `docs/data/errors/${runId}.json`, invalidError);
    await writeJson(tempRoot, 'data/products.json', [{ id: 'produto-a' }]);
    await writeJson(tempRoot, 'docs/data/products.json', [{ id: 'produto-b' }]);
    await writeText(tempRoot, 'docs/data/runs/index.json.tmp-123', 'pending');

    const report = await inspectHistoryIntegrity();
    const codes = report.issues.map((entry) => entry.code);

    assert.equal(report.ok, false);
    assert.ok(codes.includes('mirror_file_mismatch'));
    assert.ok(report.issues.some((entry) => (
      entry.code === 'mirror_file_mismatch'
      && entry.message.includes('products mirror differs')
    )));
    assert.ok(codes.includes('error_payload_invalid_schema'));
    assert.ok(codes.includes('temporary_artifact'));
  });
});

test('inspectHistoryIntegrity rejects semantically stale manifest metadata', async () => {
  const tempRoot = await makeTempDataRoot('git-scraper-integrity-');

  await withDataRoot(tempRoot, async () => {
    await persistFixture();
    const manifest = await readJson(tempRoot, 'data/runs/index.json');
    manifest.runs[0].success_count = 999;
    manifest.runs[0].failure_count = 0;
    manifest.runs[0].status = 'success';
    manifest.daily = [{
      run_date: '2099-01-01',
      run_ids: [],
      latest_run_id: null,
      total_runs: 0,
    }];
    await writeJson(tempRoot, 'data/runs/index.json', manifest);
    await writeJson(tempRoot, 'docs/data/runs/index.json', manifest);

    const report = await inspectHistoryIntegrity();

    assert.equal(report.ok, false);
    assert.ok(report.issues.some((entry) => entry.code === 'manifest_metadata_mismatch'));
  });
});

test('inspectHistoryIntegrity rejects a schema-valid latest payload for an older run', async () => {
  const tempRoot = await makeTempDataRoot('git-scraper-integrity-');

  await withDataRoot(tempRoot, async () => {
    const firstId = '2026-03-14T09-50-43-123Z';
    await persistFixture(firstId);
    const staleLatest = await readJson(tempRoot, 'data/latest.json');
    await persistFixture(
      '2026-03-15T09-50-43-123Z',
      '2026-03-15',
      '2026-03-15T09:50:43.123Z',
    );
    await writeJson(tempRoot, 'data/latest.json', staleLatest);
    await writeJson(tempRoot, 'docs/data/latest.json', staleLatest);

    const report = await inspectHistoryIntegrity();

    assert.equal(report.ok, false);
    assert.ok(report.issues.some((entry) => entry.code === 'latest_payload_stale'));
  });
});

test('inspectHistoryIntegrity rejects latest prices that differ from the canonical run', async () => {
  const tempRoot = await makeTempDataRoot('git-scraper-integrity-');

  await withDataRoot(tempRoot, async () => {
    await persistFixture();
    const primaryLatest = await readJson(tempRoot, 'data/latest.json');
    primaryLatest.items[0].price = 1.23;
    await writeJson(tempRoot, 'data/latest.json', primaryLatest);
    await writeJson(tempRoot, 'docs/data/latest.json', primaryLatest);

    const report = await inspectHistoryIntegrity();

    assert.equal(report.ok, false);
    assert.ok(report.issues.some((entry) => entry.code === 'latest_payload_items_mismatch'));
  });
});

test('inspectHistoryIntegrity accepts a consistent legacy latest payload without run_id or offers', async () => {
  const tempRoot = await makeTempDataRoot('git-scraper-integrity-');

  await withDataRoot(tempRoot, async () => {
    const runFile = '2026-03-14.json';
    const generatedAt = '2026-03-14T09:50:43.123Z';
    const summary = { total_products: 1, success_count: 1, failure_count: 0 };
    const results = [{ product_id: 'produto-a', price: 199.9, status: 'ok' }];
    const runPayload = {
      run_date: '2026-03-14',
      generated_at: generatedAt,
      currency: 'BRL',
      summary,
      results,
    };
    const errorPayload = {
      run_date: '2026-03-14',
      generated_at: generatedAt,
      engine_summary: {},
      errors: [],
    };
    for (const dataRoot of ['data', 'docs/data']) {
      await writeJson(tempRoot, `${dataRoot}/runs/${runFile}`, runPayload);
      await writeJson(tempRoot, `${dataRoot}/errors/${runFile}`, errorPayload);
    }
    await rebuildRunsIndex();

    const latestPayload = {
      generated_at: generatedAt,
      currency: 'BRL',
      summary,
      items: results,
      run_file: runFile,
    };
    await writeJson(tempRoot, 'data/latest.json', latestPayload);
    await writeJson(tempRoot, 'docs/data/latest.json', latestPayload);

    const report = await inspectHistoryIntegrity();

    assert.equal(report.ok, true);
    assert.deepEqual(report.issues, []);
  });
});

test('inspectHistoryIntegrity rejects error records that differ from the canonical run', async () => {
  const tempRoot = await makeTempDataRoot('git-scraper-integrity-');

  await withDataRoot(tempRoot, async () => {
    const runId = '2026-03-14T09-50-43-123Z';
    await persistFixture(runId);
    const errorPayload = await readJson(tempRoot, `data/errors/${runId}.json`);
    errorPayload.generated_at = '2026-03-14T22:00:00.000Z';
    errorPayload.errors = [{ product_id: 'produto-b', status: 'failed' }];
    await writeJson(tempRoot, `data/errors/${runId}.json`, errorPayload);
    await writeJson(tempRoot, `docs/data/errors/${runId}.json`, errorPayload);

    const report = await inspectHistoryIntegrity();
    const codes = report.issues.map((entry) => entry.code);

    assert.equal(report.ok, false);
    assert.ok(codes.includes('error_payload_generated_at_mismatch'));
    assert.ok(codes.includes('error_payload_failures_mismatch'));
  });
});
