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
    rows: [{ assetId: id, score: .02, prediction: .02, baseValue: .005, features: Array.from({ length: 158 }, (_, i) => ({ name: `f${i}`, value: i === 157 ? null : i, contribution: i === 0 ? .02 : i === 1 ? -.005 : 0 })) }] };
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
