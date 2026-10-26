const test = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config();
const E = require('../src/strategy/engine');
const N = require('../src/strategy/nativeModels');
const { template } = require('../src/strategy/catalog');
const { execute } = require('../src/strategy/worker');
function fixture() {
  const dates = E.weekdays('2017-01-02', '2020-12-31').slice(0, 600), prices = [], benchmark = [];
  const assets = Array.from({ length: 12 }, (_, i) => ({ asset_id: `S${i}`, masked_name: `종목${i}`, is_active: true }));
  for (let d = 0; d < dates.length; d++) {
    benchmark.push({ trade_date: dates[d], value: 1000 + d });
    for (let i = 0; i < assets.length; i++) {
      const close = 100 + i * 8 + d * (.02 + i * .015) + 3 * Math.sin(d / (5 + i));
      prices.push({ asset_id: `S${i}`, trade_date: dates[d], close_price: close, open_price: close * (1 + .003 * Math.cos(d + i)), adjusted_volume: 1000 + d + i, amount: 1e8 + d * 1000 });
    }
  }
  return { dates, prices, assets, benchmark, initialCash: 10000000, asOf: dates.at(-1), feeBps: 10 };
}
test('legacy configs receive safe ensemble defaults; unsupported settings fail', () => {
  const old = template('learning');
  for (const key of ['ensembleTrees', 'ensembleDepth', 'minLeaf', 'learningRate']) delete old[key];
  assert.equal(E.validateConfig(old).ensembleTrees, 100);
  for (const patch of [{ ensembleTrees: 10000 }, { ensembleDepth: 100 }, { minLeaf: 0 }, { learningRate: 10 }])
    assert.throws(() => E.validateConfig({ ...old, ...patch }));
});
test('missing native runtime is reported without substituting another algorithm', async () => {
  const before = process.env.USER_STRATEGY_PYTHON;
  try {
    process.env.USER_STRATEGY_PYTHON = '/no/such/strategy-python';
    assert.equal((await N.capabilities()).randomForest.available, false);
    assert.throws(() => N.train(template('learning'), [], { keys: [] }), /학습 환경/);
  } finally { if (before) process.env.USER_STRATEGY_PYTHON = before; else delete process.env.USER_STRATEGY_PYTHON; }
});
test('real ensembles preserve native predictions and additive explanations; future prices cannot change training', { timeout: 60000 }, async t => {
  if (!(await N.capabilities()).lightgbm.available) return t.skip('Install quant/workshop-requirements.txt and set USER_STRATEGY_PYTHON');
  const input = fixture(), cutoff = input.dates[350], data = E.buildFrames(input), future = structuredClone(input);
  for (const p of future.prices) if (p.trade_date >= cutoff) { p.close_price *= 3; p.open_price *= 2; }
  const changed = E.buildFrames(future);
  for (const method of ['randomForest', 'lightgbm']) {
    const config = { ...template('learning'), method, ensembleTrees: 50 };
    const model = E.train(config, data, cutoff), repeated = E.train(config, changed, cutoff);
    assert.deepEqual(model, repeated);
    assert.ok(model.trainedThrough < cutoff);
    assert.ok(model.ensemble.trees.length > 1);
    assert.ok(model.verification.count >= 96);
    assert.ok(model.verification.maxError < 1e-9);
    const predictions = data.frames.get(input.dates[351]).rows.map(row => E.predict(row, model));
    assert.ok(new Set(predictions.map(p => p.score)).size > 1);
    for (const p of predictions) assert.ok(Math.abs(p.intercept + p.contributions.reduce((s, c) => s + c.value, 0) - p.score) < 1e-10);
  }
});
test('four-model comparison shares samples, capital, costs and execution settings', { timeout: 60000 }, async t => {
  if (!(await N.capabilities()).lightgbm.available) return t.skip('Native training environment not installed');
  const input = fixture(), config = { ...template('learning'), ensembleTrees: 50 };
  const report = execute({ ...input, config, mode: 'compare' });
  assert.equal(report.kind, 'compare'); assert.equal(report.reports.length, 4);
  assert.equal(report.turnCount, 240);
  for (const r of report.reports) {
    assert.equal(r.model.trainingHash, report.training.trainingHash);
    assert.equal(r.model.sampleCount, report.training.sampleCount);
    assert.equal(r.from, report.from); assert.equal(r.to, report.to);
    assert.equal(r.initialCash, input.initialCash); assert.equal(r.feeBps, input.feeBps);
    assert.deepEqual({ ...r.config, method: config.method }, config);
    assert.deepEqual(r.equal, report.reports[0].equal);
    assert.equal(r.chart[0].own, 0); assert.ok(r.own.tradeCount > 0);
    const individual = execute({ ...input, config: r.config, mode: 'practice' });
    assert.deepEqual(individual.own, r.own);
    assert.deepEqual(individual.chart, r.chart);
  }
});
