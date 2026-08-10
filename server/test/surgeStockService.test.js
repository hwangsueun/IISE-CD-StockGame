const test = require('node:test');
const assert = require('node:assert/strict');

const dbPath = require.resolve('../src/db');
const servicePath = require.resolve('../src/services/surgeStockService');
const realDb = require(dbPath);

function loadService(query) {
  require.cache[dbPath].exports = { ...realDb, query };
  delete require.cache[servicePath];
  return require(servicePath);
}

test.after(() => {
  require.cache[dbPath].exports = realDb;
  delete require.cache[servicePath];
  realDb.pool.end();
});

test('spawn probability follows every stress band in the feature specification', () => {
  const service = loadService(async () => {
    throw new Error('pure probability lookup must not query the database');
  });

  assert.equal(service.spawnProb(0), 0.05);
  assert.equal(service.spawnProb(30), 0.10);
  assert.equal(service.spawnProb(50), 0.20);
  assert.equal(service.spawnProb(70), 0.35);
  assert.equal(service.spawnProb(90), 0.55);
  assert.equal(service.spawnProb(100), 0);
});

test('getActive exposes event price and the server-calculated maximum integer quantity', async () => {
  const service = loadService(async (sql) => {
    assert.match(sql, /g\.cash/);
    return { rows: [{
      id: 7,
      display_name: '급등테크',
      spawn_turn: 4,
      current_turn: 4,
      buy_price: '3000',
      quantity: '0',
      invested_amount: '0',
      cash: '10000',
      status: 'active',
      action_locked_until_turn: 0,
    }] };
  });

  assert.deepEqual(await service.getActive('session-1'), {
    surgeStockId: 7,
    displayName: '급등테크',
    spawnTurn: 4,
    buyPrice: 3000,
    quantity: 0,
    investedAmount: 0,
    maxBuyQuantity: 3,
    canBuy: true,
  });
});

test('buy locks stock and session rows, calculates total on the server, and debits once', async () => {
  const service = loadService(async () => {
    throw new Error('global query must not be used inside a supplied transaction');
  });
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT s.*')) {
        return { rows: [{
          id: 7,
          resolved: false,
          spawn_turn: 4,
          current_turn: 4,
          buy_price: '3000',
          quantity: '0',
          invested_amount: '0',
          cash: '10000',
          status: 'active',
          action_locked_until_turn: 0,
        }] };
      }
      if (sql.includes('UPDATE surge_stocks')) return { rows: [{ id: 7 }] };
      if (sql.includes('UPDATE game_sessions')) return { rows: [{ cash: '1000' }] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };

  const result = await service.buy('session-1', 7, 3, client);
  assert.deepEqual(result, {
    surgeStockId: 7,
    quantity: 3,
    buyPrice: 3000,
    totalAmount: 9000,
    cashAfter: 1000,
  });
  assert.match(calls[0].sql, /FOR UPDATE OF s, g/);
  assert.deepEqual(calls[1].params, [7, 3, 9000]);
  assert.deepEqual(calls[2].params, ['session-1', 9000]);
});

test('buy rejects decimal quantities and quantities above available cash', async () => {
  const service = loadService(async () => {
    throw new Error('global query must not be used inside a supplied transaction');
  });
  const unusedClient = { query: async () => { throw new Error('must reject before querying'); } };
  await assert.rejects(
    service.buy('session-1', 7, 1.5, unusedClient),
    (err) => err.statusCode === 400 && /quantity/.test(err.message)
  );

  const client = { query: async (sql) => {
    if (!sql.includes('SELECT s.*')) throw new Error('must reject before updating');
    return { rows: [{
      id: 7,
      resolved: false,
      spawn_turn: 4,
      current_turn: 4,
      buy_price: '3000',
      quantity: '0',
      invested_amount: '0',
      cash: '10000',
      status: 'active',
      action_locked_until_turn: 0,
    }] };
  } };
  await assert.rejects(
    service.buy('session-1', 7, 4, client),
    (err) => err.statusCode === 409 && err.detail.maxBuyQuantity === 3
  );

  const sideJobClient = { query: async (sql) => {
    if (!sql.includes('SELECT s.*')) throw new Error('must reject before updating');
    return { rows: [{
      id: 7,
      resolved: false,
      spawn_turn: 4,
      current_turn: 4,
      buy_price: '3000',
      quantity: '0',
      invested_amount: '0',
      cash: '10000',
      status: 'active',
      action_locked_until_turn: 0,
      side_job_turn: 4,
    }] };
  } };
  await assert.rejects(
    service.buy('session-1', 7, 1, sideJobClient),
    (err) => err.statusCode === 409 && /부업/.test(err.message)
  );
});

test('resolvePending auto-sells purchased stock next turn and applies PnL and stress', async () => {
  const service = loadService(async () => {
    throw new Error('global query must not be used');
  });
  const calls = [];
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('SELECT * FROM surge_stocks')) {
      return { rows: [{
        id: 9,
        display_name: '로켓에너지',
        buy_price: '100',
        quantity: '10',
        invested_amount: '1000',
      }] };
    }
    return { rows: [{ id: 9 }] };
  } };
  const randomValues = [0, 0]; // surge 결과, +30% 구간 하단
  const random = () => randomValues.shift();
  const session = { id: 'session-1', current_turn: 5, cash: 500, stress: 90 };

  const results = await service.resolvePending(client, session, random);
  assert.match(calls[0].sql, /ORDER BY id FOR UPDATE/);
  assert.equal(session.cash, 1800);
  assert.equal(session.stress, 70);
  assert.deepEqual(results, [{
    surgeStockId: 9,
    displayName: '로켓에너지',
    purchased: true,
    quantity: 10,
    buyPrice: 100,
    investedAmount: 1000,
    outcome: 'surge',
    returnRate: 0.3,
    proceeds: 1300,
    pnl: 300,
    stressDelta: -20,
  }]);
  assert.equal(calls[1].params[3], 300);
  assert.match(calls[2].sql, /surge_stock_result/);
  assert.equal(calls[2].params[3], 300);
});

test('resolvePending removes an observed stock without rolling an outcome or changing state', async () => {
  const service = loadService(async () => {
    throw new Error('global query must not be used');
  });
  const calls = [];
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('SELECT * FROM surge_stocks')) {
      return { rows: [{
        id: 10,
        display_name: '불꽃반도체',
        buy_price: '5000',
        quantity: '0',
        invested_amount: '0',
      }] };
    }
    return { rows: [{ id: 10 }] };
  } };
  const session = { id: 'session-1', current_turn: 6, cash: 8000, stress: 40 };

  const results = await service.resolvePending(client, session, () => {
    throw new Error('관망에는 결과 추첨이 없어야 한다');
  });
  assert.equal(calls.length, 2);
  assert.equal(session.cash, 8000);
  assert.equal(session.stress, 40);
  assert.deepEqual(results, [{
    surgeStockId: 10,
    displayName: '불꽃반도체',
    purchased: false,
    quantity: 0,
    buyPrice: 5000,
    investedAmount: 0,
    outcome: 'skipped',
    returnRate: 0,
    proceeds: 0,
    pnl: 0,
    stressDelta: 0,
  }]);
});
