import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { persistRunOutputs, readRunsIndex } from '../src/io/storage.js';

async function createTempRoot() {
  return mkdtemp(resolve(tmpdir(), 'git-scraper-storage-'));
}

test('persistRunOutputs populates files, runs, and daily manifest sections', async () => {
  const tempRoot = await createTempRoot();
  process.env.DATA_ROOT = tempRoot;

  try {
    const generatedAt = '2026-03-14T09:50:43.123Z';
    const runId = '2026-03-14T09-50-43-123Z';

    await persistRunOutputs({
      runId,
      runDate: '2026-03-14',
      generatedAt,
      status: 'success',
      runPayload: {
        run_id: runId,
        run_date: '2026-03-14',
        generated_at: generatedAt,
        currency: 'BRL',
        summary: {
          total_products: 1,
          success_count: 1,
          failure_count: 0,
        },
        results: [{ product_id: 'produto-a', price: 199.9 }],
        failures: [],
      },
      errorPayload: {
        run_id: runId,
        run_date: '2026-03-14',
        generated_at: generatedAt,
        engine_summary: {},
        errors: [],
      },
      latestPayload: {
        run_id: runId,
        generated_at: generatedAt,
        currency: 'BRL',
        summary: {
          total_products: 1,
          success_count: 1,
          failure_count: 0,
        },
        items: [{ product_id: 'produto-a', price: 199.9 }],
        failures: [],
        run_file: `${runId}.json`,
      },
    });

    const manifest = await readRunsIndex();
    const savedLatest = JSON.parse(await readFile(resolve(tempRoot, 'data', 'latest.json'), 'utf8'));

    assert.deepEqual(manifest.files, [`${runId}.json`]);
    assert.equal(manifest.runs[0].run_id, runId);
    assert.equal(manifest.daily[0].latest_run_id, runId);
    assert.equal(savedLatest.run_id, runId);
  } finally {
    delete process.env.DATA_ROOT;
  }
});
