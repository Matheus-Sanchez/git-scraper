import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findLatestSuccessfulResults,
  persistRunOutputs,
  readRunsIndex,
} from '../src/io/storage.js';
import {
  makeTempDataRoot,
  readJson,
  withDataRoot,
  writeJson,
} from '../test_support/data_root.js';

function buildPersistInput({
  runId,
  runDate,
  generatedAt,
  status = 'success',
  results = [],
  failures = [],
  successCount = results.length,
  failureCount = failures.length,
}) {
  return {
    runId,
    runDate,
    generatedAt,
    status,
    runPayload: {
      run_id: runId,
      run_date: runDate,
      generated_at: generatedAt,
      currency: 'BRL',
      summary: {
        total_products: successCount + failureCount,
        success_count: successCount,
        failure_count: failureCount,
      },
      results,
      failures,
    },
    errorPayload: {
      run_id: runId,
      run_date: runDate,
      generated_at: generatedAt,
      engine_summary: {},
      errors: failures,
    },
    latestPayload: {
      run_id: runId,
      generated_at: generatedAt,
      currency: 'BRL',
      summary: {
        total_products: successCount + failureCount,
        success_count: successCount,
        failure_count: failureCount,
      },
      items: results,
      failures,
      run_file: `${runId}.json`,
    },
  };
}

test('persistRunOutputs mirrors latest, run, error, and manifest artifacts', async () => {
  const tempRoot = await makeTempDataRoot('git-scraper-storage-');

  await withDataRoot(tempRoot, async () => {
    const generatedAt = '2026-03-14T09:50:43.123Z';
    const runId = '2026-03-14T09-50-43-123Z';

    await persistRunOutputs(buildPersistInput({
      runId,
      runDate: '2026-03-14',
      generatedAt,
      results: [{ product_id: 'produto-a', price: 199.9, status: 'ok' }],
    }));

    const manifest = await readRunsIndex();
    const primaryLatest = await readJson(tempRoot, 'data/latest.json');
    const mirrorLatest = await readJson(tempRoot, 'docs/data/latest.json');
    const primaryRun = await readJson(tempRoot, `data/runs/${runId}.json`);
    const mirrorRun = await readJson(tempRoot, `docs/data/runs/${runId}.json`);
    const primaryError = await readJson(tempRoot, `data/errors/${runId}.json`);
    const mirrorError = await readJson(tempRoot, `docs/data/errors/${runId}.json`);
    const mirrorManifest = await readJson(tempRoot, 'docs/data/runs/index.json');

    assert.deepEqual(manifest.files, [`${runId}.json`]);
    assert.equal(manifest.runs[0].run_id, runId);
    assert.equal(manifest.runs[0].status, 'success');
    assert.equal(manifest.daily[0].latest_run_id, runId);
    assert.equal(primaryLatest.run_id, runId);
    assert.deepEqual(mirrorLatest, primaryLatest);
    assert.deepEqual(mirrorRun, primaryRun);
    assert.deepEqual(mirrorError, primaryError);
    assert.deepEqual(mirrorManifest, manifest);
  });
});

test('persistRunOutputs keeps daily drilldown and partial status across multiple runs', async () => {
  const tempRoot = await makeTempDataRoot('git-scraper-storage-');

  await withDataRoot(tempRoot, async () => {
    await persistRunOutputs(buildPersistInput({
      runId: '2026-03-14T09-50-43-123Z',
      runDate: '2026-03-14',
      generatedAt: '2026-03-14T09:50:43.123Z',
      results: [{ product_id: 'produto-a', price: 199.9, status: 'ok' }],
    }));

    await persistRunOutputs(buildPersistInput({
      runId: '2026-03-14T18-10-00-000Z',
      runDate: '2026-03-14',
      generatedAt: '2026-03-14T18:10:00.000Z',
      status: 'partial',
      results: [{
        product_id: 'produto-a',
        price: 199.9,
        status: 'carried_forward',
        engine_used: 'carry_forward',
      }],
      failures: [{
        product_id: 'produto-a',
        status: 'failed',
        error_code: 'captcha_or_block',
      }],
      successCount: 0,
      failureCount: 1,
    }));

    await persistRunOutputs(buildPersistInput({
      runId: '2026-03-15T08-00-00-000Z',
      runDate: '2026-03-15',
      generatedAt: '2026-03-15T08:00:00.000Z',
      results: [{ product_id: 'produto-a', price: 189.9, status: 'ok' }],
    }));

    const manifest = await readRunsIndex();

    assert.deepEqual(
      manifest.runs.map((entry) => [entry.run_id, entry.status]),
      [
        ['2026-03-15T08-00-00-000Z', 'success'],
        ['2026-03-14T18-10-00-000Z', 'partial'],
        ['2026-03-14T09-50-43-123Z', 'success'],
      ],
    );
    assert.deepEqual(manifest.daily, [
      {
        run_date: '2026-03-15',
        run_ids: ['2026-03-15T08-00-00-000Z'],
        latest_run_id: '2026-03-15T08-00-00-000Z',
        total_runs: 1,
      },
      {
        run_date: '2026-03-14',
        run_ids: ['2026-03-14T18-10-00-000Z', '2026-03-14T09-50-43-123Z'],
        latest_run_id: '2026-03-14T18-10-00-000Z',
        total_runs: 2,
      },
    ]);
  });
});

test('readRunsIndex normalizes legacy manifest files and deduplicates runs', async () => {
  const tempRoot = await makeTempDataRoot('git-scraper-storage-');

  await withDataRoot(tempRoot, async () => {
    await writeJson(tempRoot, 'data/runs/index.json', {
      updated_at: '2026-03-15T09:00:00.000Z',
      files: [
        '2026-03-14T09-50-43-123Z.json',
        '2026-03-13.json',
      ],
      runs: [{
        run_id: '2026-03-14T09-50-43-123Z',
        run_date: '2026-03-14',
        generated_at: '2026-03-14T09:50:43.123Z',
        run_file: '2026-03-14T09-50-43-123Z.json',
        error_file: '2026-03-14T09-50-43-123Z.json',
        status: 'success',
      }],
    });

    const manifest = await readRunsIndex();

    assert.deepEqual(manifest.files, [
      '2026-03-14T09-50-43-123Z.json',
      '2026-03-13.json',
    ]);
    assert.deepEqual(
      manifest.runs.map((entry) => entry.run_id),
      ['2026-03-14T09-50-43-123Z', '2026-03-13'],
    );
    assert.deepEqual(
      manifest.daily.map((entry) => [entry.run_date, entry.total_runs]),
      [['2026-03-14', 1], ['2026-03-13', 1]],
    );
  });
});

test('findLatestSuccessfulResults returns the newest usable historical price per product', async () => {
  const tempRoot = await makeTempDataRoot('git-scraper-storage-');

  await withDataRoot(tempRoot, async () => {
    await persistRunOutputs(buildPersistInput({
      runId: '2026-03-14T09-50-43-123Z',
      runDate: '2026-03-14',
      generatedAt: '2026-03-14T09:50:43.123Z',
      results: [
        { product_id: 'produto-a', price: 199.9, status: 'ok' },
        { product_id: 'produto-b', price: 89.5, status: 'ok' },
      ],
    }));

    await persistRunOutputs(buildPersistInput({
      runId: '2026-03-15T08-00-00-000Z',
      runDate: '2026-03-15',
      generatedAt: '2026-03-15T08:00:00.000Z',
      results: [
        { product_id: 'produto-a', price: 179.9, status: 'ok' },
        { product_id: 'produto-b', price: 0, status: 'ok' },
      ],
    }));

    const results = await findLatestSuccessfulResults(['produto-a', 'produto-b', 'produto-c']);

    assert.equal(results.get('produto-a')?.price, 179.9);
    assert.equal(results.get('produto-a')?.run_id, '2026-03-15T08-00-00-000Z');
    assert.equal(results.get('produto-b')?.price, 89.5);
    assert.equal(results.get('produto-b')?.run_id, '2026-03-14T09-50-43-123Z');
    assert.equal(results.has('produto-c'), false);
  });
});
