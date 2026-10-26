import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bollingerBands, movingAverage, rsi, exponentialMovingAverage, macd,
  rateOfChange, disparity, rollingVolatility, onBalanceVolume,
} from '../src/utils/chartIndicators.js';

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

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('EMA seeds from a mean and MACD signal and histogram have their own warm-up', () => {
  assert.deepEqual(exponentialMovingAverage([2, 4, 6, 10, 12], 3), [null, null, 4, 7, 9.5]);
  const values = macd([1, 2, 3, 4, 5, 6], 2, 3, 2);
  assert.deepEqual(values.line, [null, null, 0.5, 0.5, 0.5, 0.5]);
  assert.deepEqual(values.signal, [null, null, null, 0.5, 0.5, 0.5]);
  assert.deepEqual(values.histogram, [null, null, null, 0, 0, 0]);
  assert.ok(macd([1, 2, 3], 3, 2, 2).line.every((value) => value === null));
});

test('ROC and disparity use percentage and 100 baselines respectively', () => {
  const prices = [100, 100, 120, 90];
  assert.deepEqual(rateOfChange(prices, 2).slice(0, 2), [null, null]);
  near(rateOfChange(prices, 2)[2], 20);
  near(rateOfChange(prices, 2)[3], -10);
  near(disparity(prices, 2)[2], 120 / 110 * 100);
  assert.equal(disparity([100, 100], 2)[1], 100);
  assert.equal(rateOfChange([0, 1], 1)[1], null);
});

test('volatility uses sample standard deviation of log returns without annualization', () => {
  const values = rollingVolatility([100, 110, 99], 2);
  assert.deepEqual(values.slice(0, 2), [null, null]);
  near(values[2], Math.abs(Math.log(1.1) - Math.log(0.9)) / Math.sqrt(2) * 100);
  assert.equal(rollingVolatility([100, 100, 100], 2)[2], 0);
  assert.equal(rollingVolatility([100, 0, 100], 2)[2], null);
});

test('volume calculations preserve real zeros and never fill missing data with zero', () => {
  assert.deepEqual(movingAverage([100, null, 0, 200, 400], 2), [null, null, null, 100, 300]);
  assert.deepEqual(onBalanceVolume([10, 12, 11, 11, 13], [100, 200, 50, 70, 0]), [100, 300, 250, 250, 250]);
  assert.deepEqual(onBalanceVolume([10, 12, 11, 13], [100, null, 50, 70]), [100, null, null, null]);
});

test('indicator histories are unchanged by future observations', () => {
  const prices = Array.from({ length: 100 }, (_, i) => 100 + i * 0.3 + Math.sin(i) * 3);
  const volumes = prices.map((_, i) => 1000 + i * 7);
  const calculators = [
    (p) => movingAverage(p, 20), (p) => exponentialMovingAverage(p, 20),
    (p) => bollingerBands(p).upper, (p) => rsi(p), (p) => macd(p).signal,
    (p) => macd(p).histogram, (p) => rateOfChange(p), (p) => disparity(p),
    (p) => rollingVolatility(p), (p) => onBalanceVolume(p, volumes.slice(0, p.length)),
  ];
  for (const calculate of calculators) {
    const full = calculate(prices);
    assert.deepEqual(calculate(prices.slice(0, 60)), full.slice(0, 60));
    assert.ok(full.every((value) => value === null || Number.isFinite(value)));
  }
});
