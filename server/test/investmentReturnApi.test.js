const test = require('node:test');
const assert = require('node:assert/strict');
const dbPath = require.resolve('../src/db');
const valuationPath = require.resolve('../src/services/valuationService');
const marketPath = require.resolve('../src/services/marketComparisonService');
const originalDbModule = require.cache[dbPath];
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test.afterEach(() => {
  if (originalDbModule) require.cache[dbPath] = originalDbModule;
  else delete require.cache[dbPath];
  delete require.cache[valuationPath];
  delete require.cache[marketPath];
});

test('portfolio and main-screen APIs agree on 0.93% despite idle cash, fees and external deposits', async () => {
  let deposit = 0;
  const calls = [];
  const query = async sql => {
    calls.push(sql);
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
    if (sql.includes('SELECT gt.trade_date')) return { rows: [{ trade_date: '2020-01-02' }] };
    if (sql.includes('FROM game_sessions')) return { rows: [{
      cash: 8999000 + deposit, debt: 5000000, initial_cash: 10000000, current_turn: 2,
    }] };
    if (sql.includes('FROM holdings h')) return { rows: [{
      asset_id: 'A', asset_type: 'stock', name: '주식 A', sector: 'IT',
      quantity: '1000', avg_price: '1000', price: '1009.3', is_event_asset: false,
    }] };
    if (sql.includes('FROM game_turns\n')) return { rows: [1, 2].map(n => ({
      turn_number: n, trade_date: `2020-01-0${n}`,
    })) };
    if (sql.includes('FROM trades t')) return { rows: [{
      id: 1, asset_id: 'A', turn_number: 2, trade_type: 'buy', quantity: 1000,
      amount: 1001000, created_at: '2020-01-02T09:00:00Z',
    }] };
    if (sql.includes('FROM event_log e')) return { rows: deposit ? [{
      id: 1, turn_number: 2, event_type: 'side_job', cash_delta: deposit, resolved: true,
      created_at: '2020-01-02T12:00:00Z', detail: {},
    }] : [] };
    if (sql.includes('FROM surge_stocks s')) return { rows: [] };
    if (sql.includes('p.close_price AS price')) return { rows: [{ asset_id: 'A', turn_number: 2, price: 1009.3 }] };
    if (sql.includes('i.indicator_code')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  const client = { query, release() {} };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true,
    exports: { query, pool: { connect: async () => client } } };
  delete require.cache[valuationPath];
  delete require.cache[marketPath];
  const { getPortfolio } = require(valuationPath);
  const { getPerformance } = require(marketPath);

  for (const extraCash of [0, 90000000]) {
    deposit = extraCash;
    const portfolio = await getPortfolio('session');
    calls.length = 0;
    const performance = await getPerformance('session');
    assert.equal(calls[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    assert.equal(calls.at(-1), 'COMMIT');
    assert.deepEqual(performance.investment, portfolio.investment);
    close(performance.investment.returnRate, .0093);
    close(performance.investment.returnRate, portfolio.holdings[0].returnRate);
    assert.equal(performance.currentValue, portfolio.totalAsset);
    assert.equal(portfolio.netAsset, portfolio.totalAsset - portfolio.debt);
    // The explicitly separate account ledger still includes fees and idle cash.
    assert.equal(performance.available, true);
    close(performance.summary.playerReturn, .00083);
    assert.equal(performance.summary.netAmount, 8300);
  }
});
