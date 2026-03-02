import assert from 'node:assert/strict';
import test from 'node:test';
import { extractNumericTokens, parseBRLValue } from '../src/utils/price_parse.js';

test('parseBRLValue parses brazilian formatted prices', () => {
  assert.equal(parseBRLValue('R$ 1.234,56'), 1234.56);
  assert.equal(parseBRLValue('12,99'), 12.99);
  assert.equal(parseBRLValue('  9.999,00 '), 9999);
});

test('parseBRLValue handles JSON-LD numeric strings', () => {
  assert.equal(parseBRLValue('1999.90'), 1999.9);
  assert.equal(parseBRLValue(349.45), 349.45);
});

test('parseBRLValue rejects invalid values', () => {
  assert.equal(parseBRLValue('gratis'), null);
  assert.equal(parseBRLValue('R$ 0,00'), null);
  assert.equal(parseBRLValue(-19), null);
});

test('extractNumericTokens finds candidate number tokens', () => {
  const tokens = extractNumericTokens('de R$ 129,90 por R$ 89,90 no PIX');
  assert.deepEqual(tokens, ['R$ 129,90', 'R$ 89,90']);
});
