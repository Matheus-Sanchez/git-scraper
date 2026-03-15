import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyAxiosFailure,
  classifyExtractionFailure,
  classifyPlaywrightFailure,
} from '../src/utils/failure.js';

test('classifyAxiosFailure maps transport failures', () => {
  const failure403 = classifyAxiosFailure({
    message: 'Request failed with status code 403',
    response: {
      status: 403,
      headers: {
        'content-type': 'text/html',
      },
      data: '<html></html>',
    },
  });

  const timeout = classifyAxiosFailure({
    message: 'timeout of 15000ms exceeded',
    code: 'ECONNABORTED',
  });

  assert.equal(failure403.error_code, 'http_403');
  assert.equal(timeout.error_code, 'timeout');
});

test('classifyPlaywrightFailure maps browser and navigation failures', () => {
  const launch = classifyPlaywrightFailure(new Error('browserType.launch: failed'), { stage: 'launch' });
  const navigation = classifyPlaywrightFailure(new Error('Timeout 30000ms exceeded'), { stage: 'navigation' });

  assert.equal(launch.error_code, 'browser_launch_failed');
  assert.equal(navigation.error_code, 'navigation_timeout');
});

test('classifyExtractionFailure preserves extractor classification', () => {
  const failure = classifyExtractionFailure({
    error_code: 'implausible_candidates',
    reason: 'Candidates found but none passed plausibility heuristics',
    candidates_checked: 4,
    top_candidates: [{ price: 10.5, source: 'selector' }],
  });

  assert.equal(failure.error_code, 'implausible_candidates');
  assert.equal(failure.candidates_checked, 4);
  assert.deepEqual(failure.top_candidates, [{ price: 10.5, source: 'selector' }]);
});
