const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/strategy/engine');
const { template, references } = require('../src/strategy/catalog');
function fixture(days = 420, n = 8) {
  const dates = E.weekdays('2017-01-02', '2020-12-31').slice(0, days), prices = [], benchmark = [];
  const assets = Array.from({ length: n }, (_, i) => ({ asset_id: `S${i}`, masked_name: `종목${i}`, is_active: true }));
  for (let d = 0; d < dates.length; d++) {
    benchmark.push({ trade_date: dates[d], value: 1000 + d * .4 + 4 * Math.sin(d / 7) });
    for (let i = 0; i < n; i++) {
      const close = 100 + i * 8 + d * (.02 + i * .015) + 3 * Math.sin(d / (5 + i));
      prices.push({ asset_id: `S${i}`, trade_date: dates[d], close_price: close, open_price: close * (1 + .003 * Math.cos(d + i)), adjusted_volume: 1000 + d + i, amount: 1e8 + d * 1000 });
    }
  }
  return { dates, prices, assets, benchmark };
}
test('reference recipes validate and invalid or duplicate indicators are rejected', () => {
  for (const r of references.filter(r => r.recipe)) {
    const c = template(r.id); if (['har','garch','vhar','sparseVhar','ewma','ccc','dcc'].includes(c.riskModel) || c.stressTest) c.riskAssets = ['S0','S1'];
    assert.equal(E.validateConfig(c).referenceId, r.id);
  }
  assert.equal(references.some(r => r.id === 'quality'), false);
  for (const patch of [{ topK: 0 }, { terms: [{ feature: 'futureReturn', weight: 1 }] }, { exposure: NaN }, { marketMA: 123 }, { terms: [{ feature: 'return60', weight: 1 }, { feature: 'return60', weight: 2 }] }]) assert.throws(() => E.validateConfig({ ...template(), ...patch }));
});
test('backward returns, shifted momentum, return volatility and previous volume match definitions', () => {
  const a = Array.from({ length: 261 }, (_, i) => ({ close: 100 + i, volume: 10, amount: 1e8 })); a.at(-1).volume = 20;
  const f = E.rawFeatures(a);
  assert.equal(f.return20, (360 / 340 - 1) * 100); assert.equal(f.skip120, (340 / 220 - 1) * 100);
  assert.equal(f.volume20, 2); assert.equal(f.amount20, 1); assert.ok(f.vol20 > 0 && f.vol20 < 1);
});
test('percentile ties are stable; missing values do not get favorable ranks', () => {
  const rows = [1, 1, 3, NaN].map(x => ({ values: { x }, ranks: {} })); E.rankValues(rows, 'x');
  assert.deepEqual(rows.map(r => r.ranks.x), [25, 25, 100, undefined]);
});
test('future prices cannot change earlier features or either learned model', () => {
  const input = fixture(), cutoff = input.dates[300], a = E.buildFrames(input), changed = structuredClone(input);
  for (const row of changed.prices) if (row.trade_date >= cutoff) { row.close_price *= 4; row.open_price *= 3; }
  const b = E.buildFrames(changed);
  assert.deepEqual(a.frames.get(input.dates[299]), b.frames.get(input.dates[299]));
  for (const method of ['ridge', 'tree']) {
    const c = { ...template('learning'), method }, m1 = E.train(c, a, cutoff), m2 = E.train(c, b, cutoff);
    assert.deepEqual(m1, m2); assert.ok(m1.trainedThrough < cutoff);
  }
});
test('condition-only strategies support any and all', () => {
  const frame = [...E.buildFrames(fixture()).frames.values()].at(-1);
  const c = { ...template(), method: 'conditions', conditions: [{ feature: 'return5', measure: 'raw', op: 'gte', value: 1e5 }, { feature: 'return60', measure: 'raw', op: 'gte', value: -1e5 }] };
  assert.equal(E.selection(c, frame).rows.length, 0); assert.equal(E.selection({ ...c, conditionMode: 'any' }, frame).rows.length, 8);
});
test('market gate and per-stock cap leave residual funds in cash', () => {
  const frame = [...E.buildFrames(fixture()).frames.values()].at(-1), c = { ...template(), topK: 2, exposure: 80, maxWeight: 10 };
  assert.ok(Math.abs(E.selection(c, frame).cashWeight - .8) < 1e-9);
  const gated = structuredClone(frame); gated.market.value = 1;
  assert.equal(E.selection({ ...c, marketMA: 60 }, gated).cashWeight, 1);
});
test('Ridge contributions and tree paths explain actual predictions', () => {
  const data = E.buildFrames(fixture()), dates = [...data.frames.keys()];
  for (const method of ['ridge', 'tree']) {
    const c = { ...template('learning'), method }, model = E.train(c, data, dates[300]);
    const row = E.selection(c, data.frames.get(dates[301]), new Map(), model).rows[0];
    assert.ok(Number.isFinite(row.score));
    if (method === 'ridge') assert.ok(Math.abs(row.score - row.intercept - row.contributions.reduce((s, x) => s + x.value, 0)) < 1e-12);
    else { assert.ok(row.path.length > 0); assert.ok(row.leafCount >= 50); }
  }
});
test('next-open fills are integer, cash is nonnegative, and holidays defer orders', () => {
  const input = fixture(), dates = input.dates.slice(300, 340), holiday = dates[1];
  input.prices = input.prices.filter(p => p.trade_date !== holiday);
  const c = { ...template(), rebalanceTurns: 5, topK: 3, exposure: 100, maxWeight: 100 }, result = E.replay(c, E.buildFrames(input), dates, 1000, null);
  assert.equal(result.history[0].totalAsset, 1000); assert.equal(result.history[1].totalAsset, 1000);
  assert.ok(result.trades.length > 0); assert.equal(result.trades[0].executionTurn, 3);
  for (const trade of result.trades) { assert.ok(trade.executionTurn > trade.decisionTurn); assert.ok(Number.isInteger(trade.filledQuantity)); }
  assert.ok(result.history.every(r => r.cash >= 0));
});
test('future suffix does not alter prior portfolio decisions or values', () => {
  const input = fixture(), dates = input.dates.slice(300, 400), cut = dates[50], changed = structuredClone(input);
  for (const row of changed.prices) if (row.trade_date > cut) { row.open_price *= 2; row.close_price *= 2; }
  const a = E.replay(template(), E.buildFrames(input), dates, 100000, null), b = E.replay(template(), E.buildFrames(changed), dates, 100000, null);
  assert.deepEqual(a.history.slice(0, 51), b.history.slice(0, 51));
  assert.deepEqual(a.orders.filter(o => o.executionDate <= cut), b.orders.filter(o => o.executionDate <= cut));
});
test('gate exits between reviews; rank buffer retains incumbents', () => {
  const frame = [...E.buildFrames(fixture()).frames.values()].at(-1), c = { ...template(), topK: 1, rankBuffer: 1 };
  const ranked = E.selection({ ...c, topK: 8, rankBuffer: 0 }, frame).rows;
  assert.equal(E.selection(c, frame, new Map([[ranked[1].id, { quantity: 1, avgPrice: 100 }]])).rows[0].id, ranked[1].id);
  const input = fixture(), dates = input.dates.slice(300, 310);
  for (const b of input.benchmark) if (b.trade_date >= dates[2]) b.value = 100;
  const r = E.replay({ ...template(), marketMA: 60, rebalanceTurns: 20 }, E.buildFrames(input), dates, 100000, null);
  assert.ok(r.orders.some(o => o.side === 'sell' && o.decisionTurn === 3));
});
test('monthly comparison excludes partial windows and chains interval returns', () => {
  const history = Array.from({ length: 45 }, (_, i) => ({ totalAsset: 100 + i + 1 })), m = E.monthly(history, 100, history);
  assert.equal(m.length, 2); assert.equal(m[0].returnRate, 120 / 100 - 1); assert.equal(m[1].returnRate, 140 / 120 - 1);
});
test('source fingerprint ignores future suffix but detects historical changes', () => {
  const input = fixture(10), cutoff = input.dates[4], changed = structuredClone(input); changed.prices.at(-1).close_price *= 2;
  assert.equal(E.sourceHash(input, cutoff), E.sourceHash(changed, cutoff)); changed.prices[0].close_price *= 2;
  assert.notEqual(E.sourceHash(input, cutoff), E.sourceHash(changed, cutoff));
});
test('zero exposure or insufficient capital does not create fictitious returns', () => {
  const input = fixture(), data = E.buildFrames(input), dates = input.dates.slice(300);
  for (const [cash, exposure] of [[100000, 0], [1, 100]]) { const r = E.replay({ ...template(), exposure }, data, dates, cash, null); assert.equal(r.returnRate, 0); assert.equal(r.tradeCount, 0); }
  assert.equal(require('../src/config/constants').TRADE_FEE_RATE, 0);
});
