import test from 'node:test';
import assert from 'node:assert/strict';
import { strategySignature, restoreStrategyDraft } from '../src/utils/userStrategy.js';
const blank = { schemaVersion: 1, name: '기본', hypothesis: '', method: 'score', terms: [{ feature: 'return60', weight: 1 }], conditions: [] }, features = [{ id: 'return60' }];
test('database object ordering does not falsely mark a result stale', () => {
  assert.equal(strategySignature(blank), strategySignature({ conditions: [], terms: [{ weight: 1, feature: 'return60' }], method: 'score', hypothesis: '', name: '기본', schemaVersion: 1 }));
  assert.notEqual(strategySignature(blank), strategySignature({ ...blank, name: '다른 전략' }));
});
test('corrupt or structurally invalid drafts cannot crash the editor', () => {
  for (const value of ['{', 'null', '[]', JSON.stringify({ ...blank, terms: [null] }), JSON.stringify({ ...blank, conditions: [null] }), JSON.stringify({ ...blank, terms: [{ feature: 'not-supported', weight: 1 }] })]) assert.deepEqual(restoreStrategyDraft(value, blank, features), blank);
  assert.equal(restoreStrategyDraft(JSON.stringify({ ...blank, name: '복원' }), blank, features).name, '복원');
});
test('native model drafts restore and old drafts inherit new settings', () => {
  const updated = { ...blank, ensembleTrees: 100, ensembleDepth: 5, minLeaf: 30, learningRate: .05 };
  for (const method of ['randomForest', 'lightgbm', 'xgboost']) {
    const restored = restoreStrategyDraft(JSON.stringify({ ...blank, method }), updated, features);
    assert.equal(restored.method, method); assert.equal(restored.ensembleTrees, 100);
  }
  assert.equal(restoreStrategyDraft(JSON.stringify(blank), updated, features).ensembleTrees, 100);
});

test('invalid research panels cannot crash the editor', () => {
  for (const riskAssets of [null, {}, [null]]) assert.deepEqual(restoreStrategyDraft(JSON.stringify({ ...blank, riskAssets }), blank, features), blank);
});
