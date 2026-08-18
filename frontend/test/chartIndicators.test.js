import test from 'node:test';
import assert from 'node:assert/strict';

import { bollingerBands, movingAverage, rsi } from '../src/utils/chartIndicators.js';

test('moving averages and Bollinger bands keep their full-history warm-up', () => {
  const prices = Array.from({ length: 30 }, (_, index) => index + 1);
  const ma20 = movingAverage(prices, 20);
  const bands = bollingerBands(prices, 20);

  assert.equal(ma20[18], null);
  assert.equal(ma20[19], 10.5);
  assert.equal(ma20.slice(-5).every((value) => value !== null), true);
  assert.equal(bands.upper[18], null);
  assert.equal(bands.lower.slice(-5).every((value) => value !== null), true);
});

test('RSI treats a flat market as neutral instead of overbought', () => {
  const values = rsi(new Array(30).fill(100), 14);

  assert.equal(values[13], null);
  assert.equal(values[14], 50);
  assert.equal(values.at(-1), 50);
});

test('RSI still reaches its directional limits for one-way moves', () => {
  assert.equal(rsi(Array.from({ length: 30 }, (_, i) => i + 1), 14).at(-1), 100);
  assert.equal(rsi(Array.from({ length: 30 }, (_, i) => 30 - i), 14).at(-1), 0);
});
