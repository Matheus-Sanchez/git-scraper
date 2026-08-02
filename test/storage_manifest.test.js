import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  findLatestSuccessfulResults,
  HistoryIntegrityError,
  inspectRunsIndex,
  persistRunOutputs,
  readRunsIndex,
  rebuildRunsIndex,
} from '../src/io/storage.js';
import {
  makeTempDataRoot,
  readJson,
  readText,
  withDataRoot,
  writeJson,
  writeText,
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

function buildRunFixture({
  runId,
  runDate,
  generatedAt,
  successCount = 1,
  failureCount = 0,
} = {}) {
  return {
    ...(runId ? { run_id: runId } : {}),
    run_date: runDate,
    generated_at: generatedAt,
    currency: 'BRL',
    summary: {
      total_products: successCount + failureCount,
      success_count: successCount,
      failure_count: failureCount,
    },
    results: successCount > 0 ? [{ product_id: 'produto-a', price: 199.9 }] : [],
    failures: failureCount > 0 ? [{ product_id: 'produto-b', status: 'failed' }] : [],
  };
}

function buildErrorFixture({ runId, runDate, generatedAt, errors = [] }) {
  return {
    ...(runId ? { run_id: runId } : {}),
    run_date: runDate,
    generated_at: generatedAt,
    engine_summary: {},
    errors,
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
    await writeJson(tempRoot, 'data/runs/2026-03-14T09-50-43-123Z.json', {
      run_id: '2026-03-14T09-50-43-123Z',
      run_date: '2026-03-14',
      generated_at: '2026-03-14T09:50:43.123Z',
      summary: { total_products: 1, success_count: 1, failure_count: 0 },
      results: [{ product_id: 'produto-a', price: 199.9 }],
      failures: [],
    });
    await writeJson(tempRoot, 'data/runs/2026-03-13.json', {
      run_date: '2026-03-13',
      generated_at: '2026-03-13T09:50:43.123Z',
      summary: { total_products: 1, success_count: 1, failure_count: 0 },
      results: [{ product_id: 'produto-a', price: 209.9 }],
      failures: [],
    });
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

test('readRunsIndex recovers every valid run when the manifest is incomplete', async () => {
  const tempRoot = await makeTempDataRoot('git-scraper-storage-');

  await withDataRoot(tempRoot, async () => {
    const olderId = '2026-03-14T09-50-43-123Z';
    const newerId = '2026-03-15T08-00-00-000Z';
    await writeJson(tempRoot, `data/runs/${olderId}.json`, buildRunFixture({
      runId: olderId,
      runDate: '2026-03-14',
      generatedAt: '2026-03-14T09:50:43.123Z',
    }));
    await writeJson(tempRoot, `data/runs/${newerId}.json`, buildRunFixture({
      runId: newerId,
      runDate: '2026-03-15',
      generatedAt: '2026-03-15T08:00:00.000Z',
    }));
    await writeJson(tempRoot, 'data/runs/index.json', {
      updated_at: '2026-03-14T10:00:00.000Z',
      files: [`${olderId}.json`],
      runs: [{
        run_id: olderId,
        run_date: '2026-03-14',
        generated_at: '2026-03-14T09:50:43.123Z',
        run_file: `${olderId}.json`,
      }],
    });

    const manifest = await readRunsIndex();

    assert.deepEqual(manifest.runs.map((entry) => entry.run_id), [newerId, olderId]);
    assert.ok(manifest.diagnostics.some((issue) => issue.code === 'manifest_incomplete'));
  });
});

test('readRunsIndex rebuilds in memory from valid runs when the manifest JSON is corrupt', async () => {
  const tempRoot = await makeTempDataRoot('git-scraper-storage-');

  await withDataRoot(tempRoot, async () => {
    const runId = '2026-03-14T09-50-43-123Z';
    await writeJson(tempRoot, `data/runs/${runId}.json`, buildRunFixture({
      runId,
      runDate: '2026-03-14',
      generatedAt: '2026-03-14T09:50:43.123Z',
    }));
    await writeText(tempRoot, 'data/runs/index.json', '{ merge conflict');

    const manifest = await readRunsIndex();

    assert.deepEqual(manifest.files, [`${runId}.json`]);
    assert.ok(manifest.diagnostics.some((issue) => issue.code === 'manifest_invalid'));
  });
});

test('readRunsIndex reports schema-invalid and stale manifest declarations', async () => {
  const invalidRoot = await makeTempDataRoot('git-scraper-storage-');
  await withDataRoot(invalidRoot, async () => {
    await writeJson(invalidRoot, 'data/runs/index.json', {
      updated_at: 'not-a-timestamp',
      files: [],
    });
    const manifest = await readRunsIndex();
    assert.ok(manifest.diagnostics.some((entry) => entry.code === 'manifest_invalid_schema'));
  });

  const staleRoot = await makeTempDataRoot('git-scraper-storage-');
  await withDataRoot(staleRoot, async () => {
    const runId = '2026-03-14T09-50-43-123Z';
    await writeJson(staleRoot, 'data/runs/index.json', {
      updated_at: '2026-03-14T10:00:00.000Z',
      files: [`${runId}.json`],
      runs: [{
        run_id: runId,
        run_date: '2026-03-14',
        generated_at: '2026-03-14T09:50:43.123Z',
        run_file: `${runId}.json`,
        error_file: `${runId}.json`,
        success_count: 1,
        failure_count: 0,
        status: 'success',
      }],
      daily: [{
        run_date: '2026-03-14',
        run_ids: [runId],
        latest_run_id: runId,
        total_runs: 1,
      }],
    });
    const manifest = await readRunsIndex();
    assert.ok(manifest.diagnostics.some((entry) => entry.code === 'manifest_stale'));
  });
});

test('invalid run files are reported while valid recovered entries remain available for diagnosis', async () => {
  const tempRoot = await makeTempDataRoot('git-scraper-storage-');

  await withDataRoot(tempRoot, async () => {
    const runId = '2026-03-14T09-50-43-123Z';
    await writeJson(tempRoot, `data/runs/${runId}.json`, buildRunFixture({
      runId,
      runDate: '2026-03-14',
      generatedAt: '2026-03-14T09:50:43.123Z',
    }));
    await writeText(tempRoot, 'data/runs/2026-03-15.json', '{ invalid');

    const inspection = await inspectRunsIndex();
    assert.equal(inspection.stats.discovered_run_files, 2);
    assert.equal(inspection.stats.valid_runs, 1);
    assert.ok(inspection.issues.some((issue) => issue.code === 'run_invalid_json'));

    await assert.rejects(
      readRunsIndex(),
      (error) => {
        assert.ok(error instanceof HistoryIntegrityError);
        assert.deepEqual(error.manifest.runs.map((entry) => entry.run_id), [runId]);
        return true;
      },
    );
  });
});

test('rebuildRunsIndex atomically writes identical complete manifests to both data roots', async () => {
  const tempRoot = await makeTempDataRoot('git-scraper-storage-');

  await withDataRoot(tempRoot, async () => {
    const legacyFile = '2026-03-13.json';
    const currentId = '2026-03-14T09-50-43-123Z';
    await writeJson(tempRoot, `data/runs/${legacyFile}`, buildRunFixture({
      runDate: '2026-03-13',
      generatedAt: '2026-03-13T09:50:43.123Z',
    }));
    await writeJson(tempRoot, `data/runs/${currentId}.json`, buildRunFixture({
      runId: currentId,
      runDate: '2026-03-14',
      generatedAt: '2026-03-14T09:50:43.123Z',
      successCount: 0,
      failureCount: 1,
    }));
    await writeJson(tempRoot, 'data/errors/2026-03-13.json', {
      run_date: '2026-03-13',
      generated_at: '2026-03-13T09:50:43.123Z',
      engine_summary: {},
      errors: [],
    });
    await writeJson(tempRoot, `data/errors/${currentId}.json`, {
      run_id: currentId,
      run_date: '2026-03-14',
      generated_at: '2026-03-14T09:50:43.123Z',
      engine_summary: {},
      errors: [{ product_id: 'produto-b', status: 'failed' }],
    });

    const rebuilt = await rebuildRunsIndex();
    const primaryManifest = await readJson(tempRoot, 'data/runs/index.json');
    const mirrorManifest = await readJson(tempRoot, 'docs/data/runs/index.json');

    assert.deepEqual(primaryManifest, mirrorManifest);
    assert.deepEqual(primaryManifest, rebuilt.manifest);
    assert.deepEqual(
      primaryManifest.runs.map((entry) => [entry.run_id, entry.status]),
      [[currentId, 'partial'], ['2026-03-13', 'success']],
    );
    assert.equal(primaryManifest.daily.length, 2);
  });
});

test('rebuildRunsIndex replaces stale error_file metadata and preserves fatal status', async () => {
  const tempRoot = await makeTempDataRoot('git-scraper-storage-');

  await withDataRoot(tempRoot, async () => {
    const runId = '2026-03-14T09-50-43-123Z';
    const runDate = '2026-03-14';
    const generatedAt = '2026-03-14T09:50:43.123Z';
    const runPayload = buildRunFixture({
      runId,
      runDate,
      generatedAt,
      successCount: 0,
      failureCount: 0,
    });
    const errorPayload = {
      ...buildErrorFixture({ runId, runDate, generatedAt }),
      fatal: true,
    };

    for (const dataRoot of ['data', 'docs/data']) {
      await writeJson(tempRoot, `${dataRoot}/runs/${runId}.json`, runPayload);
      await writeJson(tempRoot, `${dataRoot}/errors/${runId}.json`, errorPayload);
    }
    await writeJson(tempRoot, 'data/runs/index.json', {
      updated_at: generatedAt,
      files: [`${runId}.json`],
      runs: [{
        run_id: runId,
        run_date: runDate,
        generated_at: generatedAt,
        run_file: `${runId}.json`,
        error_file: 'stale-error-file.json',
        success_count: 0,
        failure_count: 0,
        status: 'success',
      }],
      daily: [{
        run_date: runDate,
        run_ids: [runId],
        latest_run_id: runId,
        total_runs: 1,
      }],
    });

    const rebuilt = await rebuildRunsIndex();

    assert.equal(rebuilt.manifest.runs[0].error_file, `${runId}.json`);
    assert.equal(rebuilt.manifest.runs[0].status, 'fatal');
    assert.deepEqual(
      await readJson(tempRoot, 'data/runs/index.json'),
      await readJson(tempRoot, 'docs/data/runs/index.json'),
    );
  });
});

test('persistRunOutputs preserves historical files after a corrupt manifest', async () => {
  const tempRoot = await makeTempDataRoot('git-scraper-storage-');

  await withDataRoot(tempRoot, async () => {
    const olderId = '2026-03-14T09-50-43-123Z';
    const newerId = '2026-03-15T08-00-00-000Z';
    await writeJson(tempRoot, `data/runs/${olderId}.json`, buildRunFixture({
      runId: olderId,
      runDate: '2026-03-14',
      generatedAt: '2026-03-14T09:50:43.123Z',
    }));
    await writeJson(tempRoot, `data/errors/${olderId}.json`, buildErrorFixture({
      runId: olderId,
      runDate: '2026-03-14',
      generatedAt: '2026-03-14T09:50:43.123Z',
    }));
    await writeText(tempRoot, 'data/runs/index.json', '{ invalid');

    await persistRunOutputs(buildPersistInput({
      runId: newerId,
      runDate: '2026-03-15',
      generatedAt: '2026-03-15T08:00:00.000Z',
      results: [{ product_id: 'produto-b', price: 89.9, status: 'ok' }],
    }));

    const manifest = await readRunsIndex();
    assert.deepEqual(manifest.runs.map((entry) => entry.run_id), [newerId, olderId]);
  });
});

test('persistRunOutputs unions mirror-only history before publishing a new manifest', async () => {
  const tempRoot = await makeTempDataRoot('git-scraper-storage-');

  await withDataRoot(tempRoot, async () => {
    const olderId = '2026-03-14T09-50-43-123Z';
    const newerId = '2026-03-15T08-00-00-000Z';
    await writeJson(tempRoot, `docs/data/runs/${olderId}.json`, buildRunFixture({
      runId: olderId,
      runDate: '2026-03-14',
      generatedAt: '2026-03-14T09:50:43.123Z',
    }));
    await writeJson(tempRoot, `docs/data/errors/${olderId}.json`, buildErrorFixture({
      runId: olderId,
      runDate: '2026-03-14',
      generatedAt: '2026-03-14T09:50:43.123Z',
    }));

    await persistRunOutputs(buildPersistInput({
      runId: newerId,
      runDate: '2026-03-15',
      generatedAt: '2026-03-15T08:00:00.000Z',
      results: [{ product_id: 'produto-b', price: 89.9, status: 'ok' }],
    }));

    const manifest = await readRunsIndex();
    assert.deepEqual(manifest.runs.map((entry) => entry.run_id), [newerId, olderId]);
    assert.deepEqual(
      await readJson(tempRoot, `data/runs/${olderId}.json`),
      await readJson(tempRoot, `docs/data/runs/${olderId}.json`),
    );
    assert.deepEqual(
      await readJson(tempRoot, 'data/runs/index.json'),
      await readJson(tempRoot, 'docs/data/runs/index.json'),
    );
  });
});

for (const sourceRoot of ['data', 'docs/data']) {
  test(`rebuildRunsIndex recovers a valid run and error present only in ${sourceRoot}`, async () => {
    const tempRoot = await makeTempDataRoot('git-scraper-storage-');

    await withDataRoot(tempRoot, async () => {
      const runId = '2026-03-14T09-50-43-123Z';
      const runDate = '2026-03-14';
      const generatedAt = '2026-03-14T09:50:43.123Z';
      await writeJson(tempRoot, `${sourceRoot}/runs/${runId}.json`, buildRunFixture({
        runId,
        runDate,
        generatedAt,
      }));
      await writeJson(tempRoot, `${sourceRoot}/errors/${runId}.json`, buildErrorFixture({
        runId,
        runDate,
        generatedAt,
      }));

      const rebuilt = await rebuildRunsIndex();
      const primaryRun = await readJson(tempRoot, `data/runs/${runId}.json`);
      const mirrorRun = await readJson(tempRoot, `docs/data/runs/${runId}.json`);
      const primaryError = await readJson(tempRoot, `data/errors/${runId}.json`);
      const mirrorError = await readJson(tempRoot, `docs/data/errors/${runId}.json`);
      const primaryManifest = await readJson(tempRoot, 'data/runs/index.json');
      const mirrorManifest = await readJson(tempRoot, 'docs/data/runs/index.json');

      assert.equal(rebuilt.stats.recovered_payloads, 2);
      assert.deepEqual(primaryRun, mirrorRun);
      assert.deepEqual(primaryError, mirrorError);
      assert.deepEqual(primaryManifest, mirrorManifest);
      assert.deepEqual(primaryManifest.files, [`${runId}.json`]);
      const repeated = await rebuildRunsIndex();
      assert.equal(repeated.stats.recovered_payloads, 0);
    });
  });
}

test('rebuildRunsIndex aborts divergent mirrored payloads before changing manifests', async () => {
  const tempRoot = await makeTempDataRoot('git-scraper-storage-');

  await withDataRoot(tempRoot, async () => {
    const runId = '2026-03-14T09-50-43-123Z';
    const runDate = '2026-03-14';
    const generatedAt = '2026-03-14T09:50:43.123Z';
    await writeJson(tempRoot, `data/runs/${runId}.json`, buildRunFixture({
      runId,
      runDate,
      generatedAt,
    }));
    const divergent = buildRunFixture({ runId, runDate, generatedAt });
    divergent.results[0].price = 299.9;
    await writeJson(tempRoot, `docs/data/runs/${runId}.json`, divergent);
    const errorPayload = buildErrorFixture({ runId, runDate, generatedAt });
    await writeJson(tempRoot, `data/errors/${runId}.json`, errorPayload);
    await writeJson(tempRoot, `docs/data/errors/${runId}.json`, errorPayload);
    const sentinel = '{"sentinel":"unchanged"}\n';
    await writeText(tempRoot, 'data/runs/index.json', sentinel);
    await writeText(tempRoot, 'docs/data/runs/index.json', sentinel);

    await assert.rejects(
      rebuildRunsIndex(),
      (error) => error instanceof HistoryIntegrityError
        && error.issues.some((entry) => entry.code === 'run_mirror_conflict'),
    );
    assert.equal(await readText(tempRoot, 'data/runs/index.json'), sentinel);
    assert.equal(await readText(tempRoot, 'docs/data/runs/index.json'), sentinel);
  });
});

test('rebuildRunsIndex rejects malformed and misidentified union payloads', async () => {
  const tempRoot = await makeTempDataRoot('git-scraper-storage-');

  await withDataRoot(tempRoot, async () => {
    await writeText(tempRoot, 'data/runs/2026-03-14T00-00-00-000Z.json', '{ invalid');
    await writeJson(tempRoot, 'data/runs/2026-03-15T00-00-00-000Z.json', buildRunFixture({
      runId: '2026-03-15T01-00-00-000Z',
      runDate: '2026-03-15',
      generatedAt: '2026-03-15T00:00:00.000Z',
    }));
    await writeJson(tempRoot, 'data/runs/2026-03-16T00-00-00-000Z.json', buildRunFixture({
      runDate: '2026-03-17',
      generatedAt: '2026-03-17T00:00:00.000Z',
    }));
    await writeJson(tempRoot, 'data/errors/2026-03-18T00-00-00-000Z.json', {
      run_id: '2026-03-18T00-00-00-000Z',
      run_date: '2026-03-18',
      generated_at: '2026-03-18T00:00:00.000Z',
      errors: [],
    });
    await writeJson(tempRoot, 'data/errors/2026-03-19T00-00-00-000Z.json', buildErrorFixture({
      runId: '2026-03-19T00-00-00-000Z',
      runDate: '2026-03-19',
      generatedAt: '2026-03-19T00:00:00.000Z',
    }));
    await writeJson(tempRoot, 'data/runs/2026-03-20T00-00-00-000Z.json', buildRunFixture({
      runId: '2026-03-20T00-00-00-000Z',
      runDate: '2026-03-20',
      generatedAt: '2026-03-20T00:00:00.000Z',
    }));

    await assert.rejects(
      rebuildRunsIndex(),
      (error) => {
        assert.ok(error instanceof HistoryIntegrityError);
        const codes = error.issues.map((entry) => entry.code);
        assert.ok(codes.includes('run_invalid_json'));
        assert.ok(codes.includes('run_identity_mismatch'));
        assert.ok(codes.includes('run_date_mismatch'));
        assert.ok(codes.includes('error_invalid_schema'));
        assert.ok(codes.includes('run_error_file_missing'));
        assert.ok(codes.includes('error_payload_orphan'));
        return true;
      },
    );
  });
});

test('findLatestSuccessfulResults skips chains of carried-forward snapshots', async () => {
  const tempRoot = await makeTempDataRoot('git-scraper-storage-');

  await withDataRoot(tempRoot, async () => {
    const observedId = '2026-03-13T08-00-00-000Z';
    await persistRunOutputs(buildPersistInput({
      runId: observedId,
      runDate: '2026-03-13',
      generatedAt: '2026-03-13T08:00:00.000Z',
      results: [{ product_id: 'produto-a', price: 199.9, status: 'ok' }],
    }));

    for (const [runId, runDate, generatedAt] of [
      ['2026-03-14T08-00-00-000Z', '2026-03-14', '2026-03-14T08:00:00.000Z'],
      ['2026-03-15T08-00-00-000Z', '2026-03-15', '2026-03-15T08:00:00.000Z'],
    ]) {
      await persistRunOutputs(buildPersistInput({
        runId,
        runDate,
        generatedAt,
        status: 'partial',
        results: [{
          product_id: 'produto-a',
          price: 199.9,
          status: 'carried_forward',
          engine_used: 'carry_forward',
        }],
        failures: [{ product_id: 'produto-a', status: 'failed' }],
        successCount: 0,
        failureCount: 1,
      }));
    }

    const results = await findLatestSuccessfulResults(['produto-a']);
    assert.equal(results.get('produto-a')?.run_id, observedId);
    assert.equal(results.get('produto-a')?.status, 'ok');
    assert.equal((await findLatestSuccessfulResults([])).size, 0);
  });
});

test('persistRunOutputs validates identities and schemas before creating any artifact', async () => {
  const tempRoot = await makeTempDataRoot('git-scraper-storage-');

  await withDataRoot(tempRoot, async () => {
    const runId = '2026-03-14T09-50-43-123Z';
    const input = buildPersistInput({
      runId,
      runDate: '2026-03-14',
      generatedAt: '2026-03-14T09:50:43.123Z',
      results: [{ product_id: 'produto-a', price: 199.9, status: 'ok' }],
    });
    input.runPayload.run_date = '2026-03-99';

    await assert.rejects(persistRunOutputs(input), /runPayload is invalid/);
    await assert.rejects(readJson(tempRoot, `data/runs/${runId}.json`), /ENOENT/);
    await assert.rejects(readJson(tempRoot, `docs/data/runs/${runId}.json`), /ENOENT/);
    await assert.rejects(readJson(tempRoot, 'data/latest.json'), /ENOENT/);
    await assert.rejects(readJson(tempRoot, 'docs/data/latest.json'), /ENOENT/);

    const validInput = buildPersistInput({
      runId,
      runDate: '2026-03-14',
      generatedAt: '2026-03-14T09:50:43.123Z',
      results: [{ product_id: 'produto-a', price: 199.9, status: 'ok' }],
    });
    await persistRunOutputs(validInput);
    const originalRun = await readText(tempRoot, `data/runs/${runId}.json`);
    const originalLatest = await readText(tempRoot, 'data/latest.json');
    const mismatched = JSON.parse(JSON.stringify(validInput));
    mismatched.latestPayload.items[0].price = 1;

    await assert.rejects(persistRunOutputs(mismatched), /latestPayload.items must match/);
    assert.equal(await readText(tempRoot, `data/runs/${runId}.json`), originalRun);
    assert.equal(await readText(tempRoot, 'data/latest.json'), originalLatest);

    const wrongIdentity = JSON.parse(JSON.stringify(validInput));
    wrongIdentity.errorPayload.run_id = '2026-03-14T10-00-00-000Z';
    await assert.rejects(persistRunOutputs(wrongIdentity), /errorPayload.run_id must be/);

    const wrongSummary = JSON.parse(JSON.stringify(validInput));
    wrongSummary.latestPayload.summary.success_count = 0;
    wrongSummary.latestPayload.summary.failure_count = 1;
    await assert.rejects(persistRunOutputs(wrongSummary), /latestPayload.summary.success_count/);

    const wrongStatus = { ...validInput, status: 'partial' };
    await assert.rejects(persistRunOutputs(wrongStatus), /status must be success/);
    await assert.rejects(
      persistRunOutputs({ ...validInput, runId: '' }),
      /requires runId and runDate/,
    );
  });
});

test('persistRunOutputs refuses to rewrite immutable run or error payloads', async () => {
  const tempRoot = await makeTempDataRoot('git-scraper-storage-');

  await withDataRoot(tempRoot, async () => {
    const runId = '2026-03-14T09-50-43-123Z';
    const original = buildPersistInput({
      runId,
      runDate: '2026-03-14',
      generatedAt: '2026-03-14T09:50:43.123Z',
      results: [{ product_id: 'produto-a', price: 199.9, status: 'ok' }],
    });
    await persistRunOutputs(original);

    const artifactPaths = [
      `data/runs/${runId}.json`,
      `docs/data/runs/${runId}.json`,
      `data/errors/${runId}.json`,
      `docs/data/errors/${runId}.json`,
      'data/latest.json',
      'docs/data/latest.json',
      'data/runs/index.json',
      'docs/data/runs/index.json',
    ];
    const before = new Map(await Promise.all(artifactPaths.map(async (filePath) => (
      [filePath, await readText(tempRoot, filePath)]
    ))));

    const changedRun = buildPersistInput({
      runId,
      runDate: '2026-03-14',
      generatedAt: '2026-03-14T09:50:43.123Z',
      results: [{ product_id: 'produto-a', price: 1.99, status: 'ok' }],
    });
    await assert.rejects(
      persistRunOutputs(changedRun),
      (error) => error instanceof HistoryIntegrityError
        && error.issues.some((entry) => entry.code === 'run_immutable_conflict'),
    );

    const changedError = JSON.parse(JSON.stringify(original));
    changedError.errorPayload.engine_summary = { chromium: { failures: 1 } };
    await assert.rejects(
      persistRunOutputs(changedError),
      (error) => error instanceof HistoryIntegrityError
        && error.issues.some((entry) => entry.code === 'error_immutable_conflict'),
    );

    for (const filePath of artifactPaths) {
      assert.equal(await readText(tempRoot, filePath), before.get(filePath));
    }
  });
});

test('persistRunOutputs permits an exact idempotent retry without rewriting originals', async () => {
  const tempRoot = await makeTempDataRoot('git-scraper-storage-');

  await withDataRoot(tempRoot, async () => {
    const runId = '2026-03-14T09-50-43-123Z';
    const input = buildPersistInput({
      runId,
      runDate: '2026-03-14',
      generatedAt: '2026-03-14T09:50:43.123Z',
      results: [{ product_id: 'produto-a', price: 199.9, status: 'ok' }],
    });
    await persistRunOutputs(input);
    const primaryRun = await readText(tempRoot, `data/runs/${runId}.json`);
    const primaryError = await readText(tempRoot, `data/errors/${runId}.json`);

    await persistRunOutputs(JSON.parse(JSON.stringify(input)));

    assert.equal(await readText(tempRoot, `data/runs/${runId}.json`), primaryRun);
    assert.equal(await readText(tempRoot, `data/errors/${runId}.json`), primaryError);
    assert.equal(await readText(tempRoot, `docs/data/runs/${runId}.json`), primaryRun);
    assert.equal(await readText(tempRoot, `docs/data/errors/${runId}.json`), primaryError);
    assert.deepEqual((await readRunsIndex()).files, [`${runId}.json`]);
  });
});

test('persistRunOutputs safely recovers a lock owned by a dead process', async () => {
  const tempRoot = await makeTempDataRoot('git-scraper-storage-');

  await withDataRoot(tempRoot, async () => {
    await writeText(tempRoot, 'data/.storage.lock', `${JSON.stringify({
      pid: 2147483647,
      token: 'dead-owner',
      acquired_at: new Date().toISOString(),
    })}\n`);
    await persistRunOutputs(buildPersistInput({
      runId: '2026-03-14T09-50-43-123Z',
      runDate: '2026-03-14',
      generatedAt: '2026-03-14T09:50:43.123Z',
      results: [{ product_id: 'produto-a', price: 199.9, status: 'ok' }],
    }));

    await assert.rejects(readText(tempRoot, 'data/.storage.lock'), /ENOENT/);
  });
});

test('persistRunOutputs does not remove an old lock owned by a live process', async () => {
  const tempRoot = await makeTempDataRoot('git-scraper-storage-');

  await withDataRoot(tempRoot, async () => {
    const lock = {
      pid: process.pid,
      token: 'live-owner',
      acquired_at: '2000-01-01T00:00:00.000Z',
    };
    await writeText(tempRoot, 'data/.storage.lock', `${JSON.stringify(lock)}\n`);

    const pendingPersist = persistRunOutputs(buildPersistInput({
      runId: '2026-03-14T09-50-43-123Z',
      runDate: '2026-03-14',
      generatedAt: '2026-03-14T09:50:43.123Z',
      results: [{ product_id: 'produto-a', price: 199.9, status: 'ok' }],
    }));

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    assert.deepEqual(await readJson(tempRoot, 'data/.storage.lock'), lock);

    await rm(resolve(tempRoot, 'data/.storage.lock'));
    await pendingPersist;
    await assert.rejects(readText(tempRoot, 'data/.storage.lock'), /ENOENT/);
  });
});
