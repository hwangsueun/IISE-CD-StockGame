const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPerformance } = require('../src/services/marketComparisonService');
const { sectorQuote } = require('../src/services/sectorService');
const { parseSectorRow } = require('../seeds/import_sectors');

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const date = turn => `2020-01-${String(turn).padStart(2, '0')}`;
const at = (turn, hour = '10') => `${date(turn)}T${hour}:00:00Z`;
const fixture = (count = 3) => ({
  initialCash: 1000, actualTotal: 1000,
  turns: Array.from({ length: count }, (_, i) => ({ turn_number: i + 1, trade_date: date(i + 1) })),
  trades: [], events: [], surges: [], prices: [],
  indices: Array.from({ length: count }, (_, i) => ['kospi', 'kosdaq'].map((code, n) => ({
    turn_number: i + 1, indicator_code: code, trade_date: date(i + 1), value: 100 + i * (n ? -2 : 5),
  }))).flat(),
});
const flow = (turn, amount, type = 'side_job') => ({
  id: turn, turn_number: turn, cash_delta: amount, event_type: type, resolved: true, created_at: at(turn), detail: {},
});
const trade = (turn, side, quantity, amount) => ({
  id: turn, turn_number: turn, asset_id: 'A', trade_type: side, quantity, amount, created_at: at(turn),
});

test('cash only: salary, side jobs, prize, living cost and repayments never create investment gains', () => {
  const f = fixture(6);
  f.events = [flow(1, 200), flow(2, 300, 'monthly_cashflow'), flow(3, -100, 'faint'),
    flow(4, -500, 'repayment'), flow(5, 50, 'quant_challenge_prize')];
  f.actualTotal = 950;
  const p = buildPerformance(f);
  assert.equal(p.available, true);
  close(p.summary.playerReturn, 0);
  assert.equal(p.summary.netAmount, 0);
  close(p.summary.benchmarks[0].returnRate, .25);
  close(p.summary.benchmarks[0].excessReturn, -.25);
  assert.ok(p.periods.day.every(d => Math.abs(d.playerReturn) < 1e-9));
});

test('flow-time linking preserves performance through a withdrawal and later deposit', () => {
  const f = fixture();
  f.trades = [trade(1, 'buy', 5, 500)];
  f.prices = [100, 120, 144].map((price, i) => ({ asset_id: 'A', turn_number: i + 1, price }));
  f.events = [flow(2, -500, 'repayment'), flow(3, 1000, 'quant_challenge_prize')];
  f.actualTotal = 1720;
  const p = buildPerformance(f);
  close(p.summary.playerReturn, .32); // +10% on 1000, then +20% on remaining 600.
  assert.equal(p.summary.netAmount, 220);
  close(p.periods.day[0].playerReturn, .2);
  close(p.periods.day[1].playerReturn, .1);
});

test('different starting capital: fees reduce performance; pending orders have no ledger entry', () => {
  for (const scale of [1, 10000]) {
    const f = fixture(2);
    f.initialCash *= scale;
    f.trades = [trade(2, 'buy', 5 * scale, 505 * scale)];
    f.prices = [{ asset_id: 'A', turn_number: 2, price: 100 }];
    f.actualTotal = 995 * scale;
    close(buildPerformance(f).summary.playerReturn, -.005);
  }
  assert.equal(buildPerformance(fixture(1)).summary.playerReturn, 0);
});

test('forced liquidation is investment proceeds; duplicate event log is not an external deposit', () => {
  const f = fixture();
  f.trades = [trade(1, 'buy', 5, 500), trade(3, 'sell', 5, 600)];
  f.prices = [100, 110].map((price, i) => ({ asset_id: 'A', turn_number: i + 1, price }));
  f.events = [flow(3, 600, 'asset_delisted')];
  f.actualTotal = 1100;
  const p = buildPerformance(f);
  close(p.summary.playerReturn, .1);
  assert.equal(p.externalCash, 0);
});

test('same transaction salary precedes surge settlement; profit is counted once', () => {
  const f = fixture(2);
  f.surges = [{ id: 20, invested_amount: 500, buy_turn: 1, purchased_at: at(1), created_at: at(1),
    resolved: true, sell_turn: 2, resolved_at: at(2), cash_delta: 100 }];
  f.events = [flow(2, 1000, 'monthly_cashflow'), flow(2, 100, 'surge_stock_result')];
  f.actualTotal = 2100;
  const p = buildPerformance(f);
  close(p.summary.playerReturn, .05);
  assert.equal(p.summary.netAmount, 100);
  assert.equal(p.externalCash, 1000);
});

test('selected event uses actual applied turn; unresolved events have no cash effect', () => {
  const f = fixture();
  f.trades = [trade(1, 'buy', 5, 500)];
  f.prices = [100, 120, 144].map((price, i) => ({ asset_id: 'A', turn_number: i + 1, price }));
  f.events = [{ ...flow(1, -500, 'trip'), detail: { chosen: 'go', appliedTurn: 2, appliedAt: at(2) } },
    { ...flow(2, -999), resolved: false }];
  f.actualTotal = 720;
  const p = buildPerformance(f);
  close(p.summary.playerReturn, .32);
  assert.equal(p.timingEstimated, false);
});

test('missing index is unavailable, not zero; mismatch and missing stock prices suppress invented gains', () => {
  const f = fixture();
  f.indices = f.indices.filter(i => i.indicator_code !== 'kosdaq');
  assert.equal(buildPerformance(f).summary.benchmarks[1].returnRate, null);
  assert.equal(buildPerformance({ ...f, actualTotal: 10 }).summary.playerReturn, null);
  assert.equal(buildPerformance({ ...f, actualTotal: 10 }).points.at(-1).netAmount, null);
  const noPrice = buildPerformance({ ...f, trades: [trade(1, 'buy', 1, 100)], actualTotal: 900 });
  assert.equal(noPrice.summary.playerReturn, null);
});

test('empty capital does not produce infinity; week/month periods use matching endpoints', () => {
  const f = fixture(23);
  assert.equal(buildPerformance({ ...f, initialCash: 0, actualTotal: 0 }).summary.playerReturn, null);
  const p = buildPerformance(f);
  assert.deepEqual(p.periods.month.map(r => [r.fromTurn, r.toTurn]), [[20, 23], [1, 20]]);
  close(p.periods.month[0].benchmarks[0].returnRate, 210 / 195 - 1);
});

test('sector index returns use previous close and preserve missing baselines', () => {
  const row = { indicator_code: 'sector_kospi_1001', display_name: '전기전자',
    price: '1100', previous_price: '1000', trade_date: '2020-01-06', previous_date: '2020-01-03' };
  close(sectorQuote(row).changeRate, .1);
  assert.equal(sectorQuote(row).market, 'KOSPI');
  assert.equal(sectorQuote({ ...row, previous_price: null }).changeRate, null);
  assert.equal(sectorQuote({ ...row, previous_price: 0 }).changeRate, null);
  assert.equal(sectorQuote({ ...row, indicator_code: 'sector_kosdaq_2001' }).market, 'KOSDAQ');
});

test('sector import keeps market identity and ignores missing or zero prices', () => {
  const row = { market: 'KOSDAQ', index_code: '2026', index_name: '건설', date: '2020-01-02', close: '123.45' };
  assert.deepEqual(parseSectorRow(row), { code: 'sector_kosdaq_2026', name: '건설', date: row.date, value: 123.45 });
  assert.equal(parseSectorRow({ ...row, close: '' }), null);
  assert.equal(parseSectorRow({ ...row, close: '0' }), null);
  assert.throws(() => parseSectorRow({ ...row, close: 'oops' }));
  assert.throws(() => parseSectorRow({ ...row, market: 'unknown' }));
});
