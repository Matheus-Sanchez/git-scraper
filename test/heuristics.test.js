import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasCurrentPriceContext,
  hasInstallmentContext,
  hasOldPriceContext,
  isCandidatePricePlausible,
  priorityBySource,
} from '../src/extract/heuristics.js';

test('installment contexts are detected', () => {
  assert.equal(hasInstallmentContext('10x de R$ 39,90 sem juros'), true);
  assert.equal(hasInstallmentContext('assinatura mensal R$ 19,90'), true);
  assert.equal(hasInstallmentContext('por R$ 99,90 no pix'), false);
});

test('old and current contexts are detected', () => {
  const text = 'de: R$ 199,90 por R$ 149,90';
  assert.equal(hasOldPriceContext(text), true);
  assert.equal(hasCurrentPriceContext(text), true);
});

test('plausibility filters invalid prices', () => {
  assert.equal(isCandidatePricePlausible(1), true);
  assert.equal(isCandidatePricePlausible(0), false);
  assert.equal(isCandidatePricePlausible(Number.NaN), false);
  assert.equal(isCandidatePricePlausible(1_500_000), false);
});

test('source priority follows json-ld > meta > selector > regex', () => {
  assert.ok(priorityBySource('json-ld') > priorityBySource('meta'));
  assert.ok(priorityBySource('meta') > priorityBySource('selector'));
  assert.ok(priorityBySource('selector') > priorityBySource('regex'));
});
