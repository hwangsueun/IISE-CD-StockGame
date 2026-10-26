import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeContributions, contributionPoints, compareContributions, indicatorValue } from '../src/utils/quantAttribution.js';
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

test('indicator values keep exact evidence when nearby values round to the same display', () => {
  const actual = .9952341318130493, threshold = .99523414;
  const a = indicatorValue(actual), b = indicatorValue(threshold);
  assert.ok(actual < threshold);
  assert.equal(a.text, '약 0.9952341');
  assert.equal(a.text, b.text);
  assert.equal(a.exact, String(actual));
  assert.equal(b.exact, String(threshold));
  assert.notEqual(a.exact, b.exact);
  assert.equal(indicatorValue(.5).text, '0.5');
  for (const unavailable of [null, undefined, NaN, Infinity, -Infinity]) {
    assert.deepEqual(indicatorValue(unavailable), { text: '자료 없음', exact: undefined, rounded: false });
  }
});

test('importance sorts both score increases and decreases by magnitude without changing their signs', () => {
  const input = [
    { name: 'MA20', contribution: .001 },
    { name: 'VMA20', contribution: -.004 },
    { name: 'ROC20', contribution: .002 },
  ];
  const result = summarizeContributions(input);
  assert.deepEqual(result.sorted.map(f => f.name), ['VMA20', 'ROC20', 'MA20']);
  assert.equal(result.sorted[0].contribution, -.004);
  assert.equal(input[0].name, 'MA20');
});

const report = (features, extra = {}) => ({
  decisionDate: '2020-03-02', signalDate: '2020-02-28', modelVersion: 'v1', modelId: 'lgb-20200101',
  modelSha256: 'model-sha', artifactSha256: 'artifact-sha', features, ...extra,
});
test('stock comparison aligns by feature name in the selected stock importance order', () => {
  const a = report([{ name: 'MA20', value: .98, contribution: .001 }, { name: 'ROC20', value: 1.1, contribution: -.004 }]);
  const b = report([{ name: 'ROC20', value: .9, contribution: .002 }, { name: 'MA20', value: .98, contribution: -.005 }]);
  const result = compareContributions(a, b);
  assert.equal(result.comparable, true);
  assert.deepEqual(result.rows.map(row => row.name), ['ROC20', 'MA20']);
  assert.equal(result.rows[0].secondary.value, .9);
  assert.equal(result.rows[1].primary.value, result.rows[1].secondary.value);
  assert.notEqual(result.rows[1].primary.contribution, result.rows[1].secondary.contribution);
});
test('stock comparison rejects different evaluation dates, checkpoint identities and signal artifacts', () => {
  const a = report([{ name: 'MA20', value: .98, contribution: .001 }]);
  for (const key of ['decisionDate', 'signalDate', 'modelVersion', 'modelId', 'modelSha256', 'artifactSha256']) {
    assert.equal(compareContributions(a, { ...a, [key]: 'different' }).comparable, false, key);
    assert.equal(compareContributions(a, { ...a, [key]: undefined }).comparable, false, `missing ${key}`);
  }
  assert.equal(compareContributions(a, report([{ name: 'ROC20', value: 1, contribution: .001 }])).comparable, false);
});
