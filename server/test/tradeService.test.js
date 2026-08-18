const test = require('node:test');
const assert = require('node:assert/strict');

const dbPath = require.resolve('../src/db');
const turnSelectorPath = require.resolve('../src/services/turnSelector');
const servicePath = require.resolve('../src/services/tradeService');
const realDb = require(dbPath);

function loadService(client) {
  require.cache[dbPath].exports = {
    ...realDb,
    withTransaction: async (fn) => fn(client),
  };
  delete require.cache[turnSelectorPath];
  delete require.cache[servicePath];
  return require(servicePath);
}

test.after(() => {
  require.cache[dbPath].exports = realDb;
  delete require.cache[turnSelectorPath];
  delete require.cache[servicePath];
  realDb.pool.end();
});

test('weekday market holiday blocks every asset trade before holdings or cash can change', async () => {
  const calls = [];
  const client = { query: async (sql) => {
    calls.push(sql);
    if (sql.includes('FROM game_sessions')) {
      return { rows: [{
        id: 'session-1',
        status: 'active',
        current_turn: 4,
        action_locked_until_turn: 0,
        side_job_turn: 0,
      }] };
    }
    if (sql.includes('FROM game_turns')) return { rows: [{ trade_date: '2024-02-09' }] };
    if (sql.includes('SELECT EXISTS')) return { rows: [{ market_open: false }] };
    throw new Error(`unexpected query: ${sql}`);
  } };
  const service = loadService(client);

  await assert.rejects(
    service.executeTrade('session-1', { assetId: 'BOND_KTB3Y', tradeType: 'buy', quantity: 1 }),
    (err) => err.statusCode === 409 && /휴장일/.test(err.message)
  );
  assert.equal(calls.some((sql) => /FROM holdings|UPDATE game_sessions|INSERT INTO trades/.test(sql)), false);
});
