import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeContributions, contributionPoints } from '../src/utils/quantAttribution.js';
test('headline totals include every contribution even when only five factors per direction are shown', () => {
  const features = Array.from({length: 158}, (_, i) => ({ name: `f${i}`, contribution: (i % 2 ? -1 : 1) * (i + 1) / 10000 }));
  const s = summarizeContributions(features);
  assert.equal(s.positive.length, 5); assert.equal(s.negative.length, 5); assert.equal(s.sorted.length, 158);
  assert.ok(Math.abs(s.positiveTotal + s.negativeTotal - features.reduce((sum, f) => sum + f.contribution, 0)) < 1e-12);
  assert.ok(s.positive.every(f => f.contribution > 0)); assert.ok(s.negative.every(f => f.contribution < 0));
  assert.equal(features[0].name, 'f0');
});
test('signed score units are converted to percentage points and zero is neutral', () => {
  assert.equal(contributionPoints(.002), '+0.2000%p');
  assert.equal(contributionPoints(-.002), '−0.2000%p');
  assert.equal(contributionPoints(0), '0.0000%p');
  const s = summarizeContributions([{ name: 'unused', contribution: 0 }]);
  assert.equal(s.positive.length, 0); assert.equal(s.negative.length, 0);
});
