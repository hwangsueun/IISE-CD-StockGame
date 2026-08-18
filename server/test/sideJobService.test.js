const test = require('node:test');
const assert = require('node:assert/strict');

const dbPath = require.resolve('../src/db');
const servicePath = require.resolve('../src/services/sideJobService');
const realDb = require(dbPath);

test.after(() => {
  require.cache[dbPath].exports = realDb;
  delete require.cache[servicePath];
  realDb.pool.end();
});

test('side job remains available and pays normally without consulting market-open dates', async () => {
  const calls = [];
  const session = {
    id: 'session-1',
    status: 'active',
    current_turn: 10,
    action_locked_until_turn: 0,
    side_job_turn: 0,
    cash: '50000000',
    stress: 0,
  };
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('SELECT * FROM game_sessions')) return { rows: [session] };
    return { rows: [{}] };
  } };
  const globalQuery = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('SELECT current_turn')) return { rows: [session] };
    throw new Error(`unexpected query: ${sql}`);
  };
  require.cache[dbPath].exports = {
    ...realDb,
    query: globalQuery,
    withTransaction: async (fn) => fn(client),
  };
  delete require.cache[servicePath];
  const service = require(servicePath);

  const status = await service.getStatus('session-1');
  const result = await service.submitPlay('session-1', 'catch_waxon', 0);

  assert.equal(status.available, true);
  assert.equal(result.cashReward, 60000);
  assert.equal(result.tradingLockedToday, true);
  assert.ok(calls.every((call) => !/game_turns|asset_prices|trade_date/.test(call.sql)));
});
