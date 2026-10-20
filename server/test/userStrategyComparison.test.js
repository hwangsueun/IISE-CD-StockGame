const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/strategy/engine');
const { execute } = require('../src/strategy/worker');
const { template } = require('../src/strategy/catalog');

function fixture() {
  const dates = E.weekdays('2017-01-02', '2020-12-31').slice(0, 500);
  const assets = Array.from({ length: 8 }, (_, i) => ({ asset_id: `S${i}`, masked_name: `종목${i}`, is_active: true }));
  const prices = dates.flatMap((date, d) => assets.map((a, i) => {
    const close = 100 + i * 8 + d * (.02 + i * .015) + 3 * Math.sin(d / (5 + i));
    return { asset_id: a.asset_id, trade_date: date, close_price: close,
      open_price: close * (1 + .003 * Math.cos(d + i)), adjusted_volume: 1000 + d + i, amount: 1e8 + d * 1000 };
  }));
  return { dates, assets, prices, benchmark: dates.map((date, d) => ({ trade_date: date, value: 1000 + d })),
    initialCash: 500000, feeBps: 10, sourceFrom: dates[0], asOf: dates.at(-1) };
}

test('custom practice compares independent settings with one period, capital and fee, retraining before evaluation', () => {
  const input = fixture();
  const configs = [{ ...template('learning'), name: '학습 모델' }, { ...template(), name: '현금 유지', exposure: 0 }];
  const versions = configs.map((config, i) => ({ id: `v${i}`, config, model: { invalidSavedModel: true },
    savedDate: input.dates[350 + i * 10], savedTurn: 1 + i * 10 }));
  const result = execute({ ...input, mode: 'compareSaved', comparisonPeriod: 'practice', versions });
  assert.equal(result.kind, 'compare');
  assert.equal(result.comparison, 'custom');
  assert.equal(result.turnCount, 240);
  assert.deepEqual(result.reports.map(r => r.versionId), ['v0', 'v1']);
  for (const report of result.reports) {
    assert.equal(report.from, result.from); assert.equal(report.to, result.to);
    assert.equal(report.initialCash, input.initialCash); assert.equal(report.feeBps, input.feeBps);
    assert.equal(report.chart.length, 240);
    assert.equal(report.chart[0].own, 0);
  }
  assert.ok(result.reports[0].model.trainedThrough < result.from);
  assert.ok(result.reports[0].own.tradeCount > 0);
  assert.equal(result.reports[1].own.tradeCount, 0);
  assert.equal(result.reports[1].own.returnRate, 0);
  assert.notEqual(result.reports[0].own.returnRate, result.reports[1].own.returnRate);
});

test('common observation starts at latest save, preserves frozen models and checks each original source window', () => {
  const input = fixture(), config = { ...template('learning'), name: '저장 모델' };
  const versions = [350, 370].map((index, i) => {
    const sourceFrom = input.dates[i * 10];
    const source = { ...input, config, asOf: input.dates[index],
      prices: input.prices.filter(p => p.trade_date >= sourceFrom), benchmark: input.benchmark.filter(p => p.trade_date >= sourceFrom) };
    const saved = execute({ ...source, mode: 'save' });
    return { id: `v${i}`, config, savedDate: input.dates[index], savedTurn: index - 349,
      sourceFrom, sourceHash: saved.sourceHash, model: saved.model };
  });
  const request = { ...input, mode: 'compareSaved', comparisonPeriod: 'observe', versions, asOf: input.dates[410] };
  const result = execute(request);
  assert.equal(result.from, input.dates[370]); assert.equal(result.commonStartTurn, 21);
  assert.equal(result.turnCount, 41);
  result.reports.forEach((r, i) => {
    assert.deepEqual(r.model, versions[i].model.signal);
    assert.equal(r.chart[0].own, 0);
    assert.equal(r.from, result.from);
    assert.equal(r.chart.length, 41);
  });
  const futureChanged = structuredClone(request);
  futureChanged.prices.filter(p => p.trade_date > request.asOf).forEach(p => { p.close_price *= 3; p.open_price *= 3; });
  assert.deepEqual(execute(futureChanged), result);
  const changed = structuredClone(request); changed.prices[0].close_price *= 2;
  assert.throws(() => execute(changed), /저장 당시의 가격 데이터/);
  const firstDay = execute({ ...request, asOf: input.dates[370] });
  assert.equal(firstDay.turnCount, 1);
  assert.ok(firstDay.reports.every(r => r.own.returnRate === 0 && r.own.tradeCount === 0));
});
