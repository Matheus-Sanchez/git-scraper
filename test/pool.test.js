import assert from 'node:assert/strict';
import test from 'node:test';
import { runWithPool, sleep } from '../src/utils/pool.js';

test('runWithPool limits concurrent executions', async () => {
  const items = Array.from({ length: 12 }, (_, index) => index + 1);
  let running = 0;
  let maxRunning = 0;

  const results = await runWithPool(items, 3, async (item) => {
    running += 1;
    maxRunning = Math.max(maxRunning, running);

    await sleep(20);

    running -= 1;
    return item * 2;
  });

  assert.equal(results.length, items.length);
  assert.equal(maxRunning <= 3, true);
  assert.deepEqual(results.slice(0, 4), [2, 4, 6, 8]);
});

test('runWithPool isolates worker failures without aborting entire run', async () => {
  const items = [1, 2, 3, 4];
  const results = await runWithPool(items, 2, async (item) => {
    if (item === 3) throw new Error('boom');
    await sleep(5);
    return { ok: true, value: item };
  });

  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, true);
  assert.equal(results[2].ok, false);
  assert.equal(typeof results[2].error, 'string');
  assert.equal(results[3].ok, true);
});
