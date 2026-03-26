import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFatalFailure,
  classifyAxiosFailure,
  classifyExtractionFailure,
  classifyPlaywrightFailure,
  isRetryableFailure,
  mergeFailureMetadata,
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

test('classifyAxiosFailure maps http, rate limit, redirect and unexpected failures', () => {
  const failure429 = classifyAxiosFailure({
    message: 'Request failed with status code 429',
    response: {
      status: 429,
      headers: {
        'content-type': 'text/html',
      },
      data: '<html>retry later</html>',
    },
  });

  const failure500 = classifyAxiosFailure({
    message: 'Request failed with status code 500',
    response: {
      status: 500,
      headers: {
        'content-type': 'text/html',
      },
      data: '<html>server error</html>',
    },
  }, { final_url: 'https://example.com/produto' });

  const redirect = classifyAxiosFailure(new Error('Redirect loop detected while fetching the page'));

  const unexpected = classifyAxiosFailure({
    message: 'Socket closed unexpectedly',
  });

  assert.equal(failure429.error_code, 'http_429');
  assert.equal(failure500.error_code, 'http_error');
  assert.equal(failure500.http_status, 500);
  assert.equal(failure500.final_url, 'https://example.com/produto');
  assert.equal(redirect.error_code, 'redirect_loop');
  assert.equal(unexpected.error_code, 'unexpected_error');
});

test('classifyPlaywrightFailure maps browser and navigation failures', () => {
  const launch = classifyPlaywrightFailure(new Error('browserType.launch: failed'), { stage: 'launch' });
  const navigation = classifyPlaywrightFailure(new Error('Timeout 30000ms exceeded'), { stage: 'navigation' });

  assert.equal(launch.error_code, 'browser_launch_failed');
  assert.equal(navigation.error_code, 'navigation_timeout');
});

test('classifyPlaywrightFailure maps persistent context, redirect, captcha and generic timeouts', () => {
  const persistentContext = classifyPlaywrightFailure(new Error('browserType.launchPersistentContext: failed'));
  const redirect = classifyPlaywrightFailure(new Error('ERR_TOO_MANY_REDIRECTS'));
  const captcha = classifyPlaywrightFailure(new Error('Robot Check'));
  const timeout = classifyPlaywrightFailure(new Error('Timeout while waiting for selector'));
  const unexpected = classifyPlaywrightFailure(new Error('Execution context was destroyed'));

  assert.equal(persistentContext.error_code, 'persistent_context_launch_failed');
  assert.equal(redirect.error_code, 'redirect_loop');
  assert.equal(captcha.error_code, 'captcha_or_block');
  assert.equal(timeout.error_code, 'timeout');
  assert.equal(unexpected.error_code, 'unexpected_error');
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

test('failure helpers merge metadata, flag retries and build fatal payloads', () => {
  const merged = mergeFailureMetadata({
    error: 'timeout',
    error_code: 'timeout',
    error_detail: 'timeout',
  }, {
    final_url: 'https://example.com/a',
    content_type: 'text/html',
    html_size: 321,
    ignored: '',
  });

  const extracted = classifyExtractionFailure({
    error_detail: 'price_css candidates were empty',
    top_candidates: [{ source: 'json-ld', price: 11.5 }, { source: 'regex', price: 11.9 }],
  });

  const fatal = buildFatalFailure({
    phase: 'read_products',
    message: ' products.json is invalid ',
  });

  assert.equal(merged.final_url, 'https://example.com/a');
  assert.equal(merged.html_size, 321);
  assert.equal('ignored' in merged, false);
  assert.equal(extracted.error_code, 'price_not_found');
  assert.equal(extracted.error_detail, 'price_css candidates were empty');
  assert.equal(extracted.top_candidates.length, 2);
  assert.equal(isRetryableFailure({ error_code: 'timeout' }), true);
  assert.equal(isRetryableFailure({ error_code: 'http_429' }), true);
  assert.equal(isRetryableFailure({ error_code: 'http_error', http_status: 503 }), true);
  assert.equal(isRetryableFailure({ error_code: 'http_error', http_status: 404 }), false);
  assert.equal(isRetryableFailure({ error_code: 'captcha_or_block' }), false);
  assert.equal(fatal.phase, 'read_products');
  assert.equal(fatal.engine, 'pipeline');
  assert.equal(fatal.error_code, 'unexpected_error');
  assert.equal(fatal.error_detail, 'products.json is invalid');
});
