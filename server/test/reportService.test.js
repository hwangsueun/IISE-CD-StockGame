const test = require('node:test');
const assert = require('node:assert/strict');
const dbPath = require.resolve('../src/db');
const performancePath = require.resolve('../src/services/marketComparisonService');
const reportPath = require.resolve('../src/services/reportService');
const db = require(dbPath);
const market = require(performancePath);

function finalReportFor(ledger) {
  const performance = market.buildPerformance(ledger);
  require.cache[dbPath].exports = { ...db, query: async sql => {
    if (sql.includes('FROM game_sessions')) return { rows: [{
      status: 'success', difficulty: 'normal', current_turn: ledger.turns.length,
      initial_cash: ledger.initialCash, debt_initial: 100000000, debt: 0,
    }] };
    if (sql.includes('FROM session_snapshots') || sql.includes('FROM repayments')) return { rows: [] };
    throw new Error(`Unexpected report query: ${sql}`);
  } };
  require.cache[performancePath].exports = { ...market, getPerformance: async () => performance };
  delete require.cache[reportPath];
  return require(reportPath).getFinalReport('test-session');
}

test.afterEach(() => {
  require.cache[dbPath].exports = db;
  require.cache[performancePath].exports = market;
  delete require.cache[reportPath];
});
test.after(() => db.pool.end());

const ledger = (cash = 50000000) => ({
  initialCash: cash, actualTotal: cash,
  turns: [1, 2, 3].map(turn => ({ turn_number: turn, trade_date: `2020-01-0${turn}` })),
  trades: [], events: [], surges: [], prices: [], indices: [],
});
const flow = (turn, amount, event_type) => ({ id: turn, turn_number: turn,
  cash_delta: amount, event_type, resolved: true, created_at: `2020-01-0${turn}T10:00:00Z`, detail: {},
});

test('final report: cash-only income and repayments change assets but never investment return', async () => {
  const f = ledger();
  f.events = [flow(1, 30120000, 'side_job'), flow(2, 5000000, 'monthly_cashflow'), flow(3, -10000000, 'repayment')];
  f.actualTotal = 75120000;
  const report = await finalReportFor(f);
  assert.equal(report.finalTotalAsset, 75120000);
  assert.equal(report.totalReturn, 0);
});

test('final report: investment gains use linked returns when capital is withdrawn', async () => {
  const f = ledger(1000);
  f.trades = [{ id: 1, turn_number: 1, asset_id: 'A', trade_type: 'buy', quantity: 5,
    amount: 500, created_at: '2020-01-01T09:00:00Z' }];
  f.prices = [100, 120, 144].map((price, i) => ({ asset_id: 'A', turn_number: i + 1, price }));
  f.events = [flow(2, -500, 'repayment'), flow(3, 1000, 'quant_challenge_prize')];
  f.actualTotal = 1720;
  assert.ok(Math.abs((await finalReportFor(f)).totalReturn - .32) < 1e-9);
});

test('final report: empty capital or unreconciled history stays unavailable instead of fabricating a return', async () => {
  const depleted = ledger();
  depleted.events = [flow(1, -50000000, 'repayment'), flow(2, 2100000, 'side_job')];
  depleted.actualTotal = 2100000;
  assert.equal((await finalReportFor(depleted)).totalReturn, null);
  const mismatch = ledger();
  mismatch.actualTotal = 123;
  assert.equal((await finalReportFor(mismatch)).totalReturn, null);
});
