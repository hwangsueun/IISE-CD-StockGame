const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/strategy/engine');
const { template } = require('../src/strategy/catalog');
const dates = E.weekdays('2017-01-02', '2020-12-31').slice(0, 700);
const assets = Array.from({ length: 8 }, (_, i) => ({ asset_id: `S${i}`, masked_name: `종목${i}`, is_active: true }));
const prices = dates.flatMap((date, day) => assets.map((asset, i) => {
  const close = 100 + i * 20 + day * (.03 + i * .01) + 5 * Math.sin(day / (5 + i));
  return { asset_id: asset.asset_id, trade_date: date, close_price: close, open_price: close * (1 + .003 * Math.cos(day + i)),
    high_price: close * 1.02, low_price: close * .98, adjusted_volume: 1000 + day + i, amount: 1e8 + day * 1000 };
}));
const input = { prices, assets, benchmark: dates.map((date, i) => ({ trade_date: date, value: 1000 + i })) };
test('selected feature storage preserves exact ranks, historical z-scores, labels and trading results', () => {
  const full = E.buildFrames(input);
  for (const representation of ['rank', 'raw', 'zscore']) {
    const config = { ...template('learning'), representation, allocation: 'inverseVol', riskModel: 'historical', entryCeiling: 10,
      terms: ['return5', 'skip120', 'vol60', 'volume20', 'ma20'].map(feature => ({ feature, weight: 1 })) };
    const options = E.frameOptions(config), compact = E.buildFrames(input, options);
    assert.ok(compact.frames.get(dates.at(-1)).rows[0].values.vol20 > 0);
    for (const [date, frame] of compact.frames) for (const row of frame.rows) {
      const original = full.frames.get(date).rows.find(r => r.id === row.id);
      for (const feature of options.featureKeys) {
        assert.equal(row.values[feature], original.values[feature]);
        assert.equal(row.ranks[feature], original.ranks[feature]);
      }
      for (const feature of options.zscoreKeys) assert.equal(row.zscores[feature], original.zscores[feature]);
    }
    const cutoff = dates[500];
    assert.deepEqual(E.trainingSet(config, compact, cutoff), E.trainingSet(config, full, cutoff));
    const model = E.train(config, full, cutoff);
    assert.deepEqual(E.train(config, compact, cutoff), model);
    const old = E.replay(config, full, dates.slice(500), 50000000, model);
    const current = E.replay(config, compact, dates.slice(500), 50000000, model);
    for (const key of ['cash', 'returnRate', 'maxDrawdown', 'history', 'orders', 'trades', 'holdings']) assert.deepEqual(current[key], old[key]);
  }
});


test('streamed history fingerprint matches already-saved full JSON fingerprints byte for byte', () => {
  for (const researchVersion of [0, 1]) {
    const source = { ...input, config: { researchVersion } }, until = dates[550];
    const oldPrices = prices.filter(p => p.trade_date <= until).map(p => {
      if (researchVersion) return p;
      const { high_price, low_price, ...legacy } = p; return legacy;
    });
    const expected = E.hash({ assets, prices: oldPrices, benchmark: input.benchmark.filter(p => p.trade_date <= until) });
    assert.equal(E.sourceHash(source, until), expected);
  }
});

test('discarding unread feature dates preserves training and complete reports for practice and save', () => {
  const { execute } = require('../src/strategy/worker');
  const original = E.retainedRowDates;
  for (const mode of ['practice', 'save', 'holidaySave']) for (const representation of ['rank', 'raw', 'zscore']) {
    const config = { ...template('learning'), representation, method: 'ridge', trainYears: 1, horizon: 5,
      terms: ['return5', 'return20', 'return60', 'return120', 'return240', 'skip60', 'skip120', 'skip240', 'vol20', 'vol60', 'ma20', 'ma60'].map(feature => ({ feature, weight: 1 })) };
    const source = { ...input, asOf: mode === 'holidaySave' ? E.weekdays(dates.at(-1), '2020-12-31')[1] : dates.at(-1), mode: mode === 'holidaySave' ? 'save' : mode, config, feeBps: 10, initialCash: 50000000 };
    const rowDates = original(source, config);
    assert.ok(rowDates.size < dates.length / 2 + 100);
    let expected;
    try { E.retainedRowDates = () => undefined; expected = execute(source); }
    finally { E.retainedRowDates = original; }
    assert.deepEqual(execute(source), expected);
    const consumed = { ...source };
    assert.deepEqual(execute(consumed, true), expected);
    assert.equal(consumed.prices, null);
  }
});
