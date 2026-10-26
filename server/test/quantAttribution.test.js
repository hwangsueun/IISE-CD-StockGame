const test = require('node:test');
const assert = require('node:assert/strict');
const { contextFor, validateExplanation } = require('../src/services/quantAttribution');
function fixture() {
  const id = 'STOCK_000001', model = { id: 'lgb-20200101', available_from: '2020-01-01', trained_through: '2019-12-30', sha256: 'checkpoint-hash' };
  const loaded = { sha: 'artifact-hash', artifact: { model_version: 'v4', models: [model],
    sessions: { '2020-01-02': { signal_date: '2020-01-02', model_id: model.id, ranking: [[id, .02, 100]] } } } };
  const selection = { assetId: id, score: .02 };
  const portfolio = { artifactSha256: loaded.sha, modelVersion: 'v4', date: '2020-01-02', decision: { date: '2020-01-02', signalDate: '2020-01-02', modelId: model.id, selections: [selection] } };
  const report = { method: 'lightgbm_tree_shap', artifactSha256: loaded.sha, modelVersion: 'v4', modelId: model.id,
    modelSha256: model.sha256, signalDate: '2020-01-02', decisionDate: '2020-01-02', trainedThrough: model.trained_through, featureCount: 158,
    decisionPathMethod: 'lightgbm_observed_paths', branchValueMethod: 'leaf_count_weighted_subtree_output',
    treeCount: 1, numericSplitsOnly: true, pathLeavesVerified: true, maxPathScoreError: 0,
    rows: [{ assetId: id, score: .02, prediction: .02, baseValue: .005, features: Array.from({ length: 158 }, (_, i) => ({ name: `f${i}`, value: i === 157 ? null : i, contribution: i === 0 ? .02 : i === 1 ? -.005 : 0 })) }] };
  for (const feature of report.rows[0].features.filter(f => f.contribution !== 0)) {
    const left = feature.value <= .5;
    feature.decisionEvidence = { method: 'observed_tree_paths', totalTrees: 1, modelTreeCount: 1, pathTreeCount: 1,
      splitCount: 1, higherBranchCount: 1, lowerBranchCount: 0, equalBranchCount: 0,
      referenceComparison: { method: 'one_feature_same_day_median', available: true, referenceValue: feature.value,
        referencePopulation: 1, originalPrediction: .02, comparisonPrediction: .02, difference: 0 },
      examples: [{ feature: feature.name, value: feature.value, effectiveValue: feature.value,
        decisionType: '<=', threshold: .5, selectedBranch: left ? 'left' : 'right', conditionOperator: left ? '<=' : '>',
        missingType: 'None', valueWasMissing: false, usedDefault: false, defaultLeft: true, routing: 'comparison',
        treeIndex: 0, nodeIndex: 0, selectedExpectedValue: .03, alternativeExpectedValue: .01, branchDifference: .02,
        selectedSampleCount: 12, alternativeSampleCount: 4, context: [], omittedContextCount: 0 }] };
  }
  return { id, loaded, portfolio, report };
}
test('explanations require the session-pinned model, selected stock and past decision date', () => {
  const { id, loaded, portfolio } = fixture();
  assert.equal(contextFor(portfolio, loaded, id).selection.score, .02);
  assert.throws(() => contextFor(portfolio, loaded, 'STOCK_999999'), /포함된/);
  assert.throws(() => contextFor({ ...portfolio, artifactSha256: 'different' }, loaded, id), /모델이 다릅니다/);
  assert.throws(() => contextFor({ ...portfolio, date: '2020-01-01' }, loaded, id), /확인할 수 없습니다/);
  loaded.artifact.models[0].trained_through = '2020-01-02';
  assert.throws(() => contextFor(portfolio, loaded, id), /확인할 수 없습니다/);
});
test('all 158 signed contributions plus baseline must reconstruct the actual ranked score', () => {
  const { loaded, report } = fixture();
  assert.equal(validateExplanation(report, loaded, '2020-01-02'), report);
  report.rows[0].features[0].contribution += .001;
  assert.throws(() => validateExplanation(report, loaded, '2020-01-02'), /reconstruct/);
});
test('rejects generic importance, wrong checkpoint, wrong date and incomplete feature vectors', () => {
  for (const mutate of [r => r.method = 'gain', r => r.modelSha256 = 'other', r => r.signalDate = '2020-01-03', r => r.rows[0].features.pop(), r => r.rows[0].features[1].name = 'f0', r => r.rows[0].features[0].value = Infinity, r => r.rows[0].features[0].contribution = NaN]) {
    const { loaded, report } = fixture(); mutate(report);
    assert.throws(() => validateExplanation(report, loaded, '2020-01-02'));
  }
});
test('cannot substitute another asset or a self-consistent but different forecast', () => {
  const { loaded, report } = fixture();
  report.rows[0].assetId = 'STOCK_999999';
  assert.throws(() => validateExplanation(report, loaded, '2020-01-02'), /Invalid/);
  const second = fixture(); second.report.rows[0].score += .01; second.report.rows[0].prediction += .01; second.report.rows[0].baseValue += .01;
  assert.throws(() => validateExplanation(second.report, second.loaded, '2020-01-02'), /reconstruct/);
});
test('decision examples must match the actual value, branch, counts and difference', () => {
  for (const mutate of [
    e => e.examples[0].selectedBranch = 'right', e => e.examples[0].threshold = -.5,
    e => e.examples[0].effectiveValue = 200, e => e.examples[0].branchDifference += .01,
    e => e.examples[0].context = [{ ...e.examples[0], feature: 'absent' }],
    e => e.examples[0].treeIndex = 1, e => e.pathTreeCount = 2,
    e => e.higherBranchCount = 20, e => e.examples[0].routing = 'missing_default',
    e => e.referenceComparison.difference = .05, e => e.referenceComparison.originalPrediction = .03,
    e => e.referenceComparison.referenceValue = 42,
  ]) {
    const { loaded, report } = fixture();
    mutate(report.rows[0].features[0].decisionEvidence);
    assert.throws(() => validateExplanation(report, loaded, '2020-01-02'), /Invalid/);
  }
});
test('a SHAP contribution may oppose a local branch difference or have no visited split', () => {
  const { loaded, report } = fixture();
  // f1 has a negative SHAP contribution and a positive local branch difference.
  assert.ok(report.rows[0].features[1].contribution < 0);
  assert.equal(validateExplanation(report, loaded, '2020-01-02'), report);
  const evidence = report.rows[0].features[0].decisionEvidence;
  Object.assign(evidence, { pathTreeCount: 0, splitCount: 0, higherBranchCount: 0, examples: [] });
  assert.equal(validateExplanation(report, loaded, '2020-01-02'), report);
});
test('missing indicators follow the recorded LightGBM missing route', () => {
  const { loaded, report } = fixture();
  const feature = report.rows[0].features[0], example = feature.decisionEvidence.examples[0];
  feature.value = null;
  Object.assign(example, { value: null, effectiveValue: null, missingType: 'NaN', valueWasMissing: true,
    usedDefault: true, routing: 'missing_default' });
  Object.assign(feature.decisionEvidence.referenceComparison, {
    available: false, referenceValue: null, referencePopulation: 0, comparisonPrediction: null, difference: null,
  });
  assert.equal(validateExplanation(report, loaded, '2020-01-02'), report);
  example.defaultLeft = false;
  assert.throws(() => validateExplanation(report, loaded, '2020-01-02'), /Invalid/);
});
