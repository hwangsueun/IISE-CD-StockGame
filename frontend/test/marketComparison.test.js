import test from 'node:test';
import assert from 'node:assert/strict';
import { percentagePoints } from '../src/utils/marketComparison.js';

test('relative performance uses percentage points, handles losses and missing values', () => {
  assert.equal(percentagePoints(.02), '+2.00%p');
  assert.equal(percentagePoints(-.02), '-2.00%p');
  assert.equal(percentagePoints(null), '—');
  assert.equal(percentagePoints(-.03), '-3.00%p');
  assert.equal(percentagePoints(1e-12), '0.00%p');
  assert.equal(percentagePoints(-1e-12), '0.00%p');
});
