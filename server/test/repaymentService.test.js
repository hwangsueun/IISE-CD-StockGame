const test = require('node:test');
const assert = require('node:assert/strict');

const dbPath = require.resolve('../src/db');
const gameServicePath = require.resolve('../src/services/gameService');
const surgeServicePath = require.resolve('../src/services/surgeStockService');
const valuationServicePath = require.resolve('../src/services/valuationService');
const reportServicePath = require.resolve('../src/services/reportService');
const repaymentServicePath = require.resolve('../src/services/repaymentService');
const realDb = require(dbPath);
const realGameService = require(gameServicePath);
const realSurgeService = require(surgeServicePath);
const realValuationService = require(valuationServicePath);
const realReportService = require(reportServicePath);

test.after(() => {
  require.cache[dbPath].exports = realDb;
  require.cache[gameServicePath].exports = realGameService;
  require.cache[surgeServicePath].exports = realSurgeService;
  require.cache[valuationServicePath].exports = realValuationService;
  require.cache[reportServicePath].exports = realReportService;
  delete require.cache[repaymentServicePath];
  realDb.pool.end();
});

test('repayment that ends the game refunds pending surge principal before final cash is returned', async () => {
  const calls = [];
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('SELECT * FROM game_sessions')) {
      return { rows: [{
        id: 'session-1',
        status: 'active',
        current_turn: 20,
        cash: '10000',
        debt: '1000',
        debt_initial: '12000',
        trust: 100,
        stress: 50,
      }] };
    }
    if (sql.includes('SELECT 1 FROM repayments')) return { rows: [] };
    return { rows: [{}] };
  } };

  let evaluatedCash;
  let cleanupCash;
  let valuationCash;
  let snapshot;
  require.cache[dbPath].exports = {
    ...realDb,
    query: client.query,
    withTransaction: async (fn) => fn(client),
  };
  require.cache[gameServicePath].exports = {
    ...realGameService,
    evaluateEndCondition: async (_client, session) => {
      evaluatedCash = session.cash;
      return 'success';
    },
  };
  require.cache[surgeServicePath].exports = {
    ...realSurgeService,
    closePendingAtGameEnd: async (_client, session) => {
      cleanupCash = session.cash;
      session.cash += 3000;
      return [{ surgeStockId: 9, investedAmount: 3000, outcome: 'cancelled' }];
    },
  };
  require.cache[valuationServicePath].exports = {
    ...realValuationService,
    computeTotalAsset: async (_sessionId, _client, options) => {
      valuationCash = options.cash;
      return 15000;
    },
  };
  require.cache[reportServicePath].exports = {
    ...realReportService,
    syncTerminalSnapshots: async (_client, sessionId, turnNumber, payload) => {
      snapshot = { sessionId, turnNumber, ...payload };
    },
  };
  delete require.cache[repaymentServicePath];
  const service = require(repaymentServicePath);

  const result = await service.repay('session-1', 1000);

  assert.equal(evaluatedCash, 9000);
  assert.equal(cleanupCash, 9000);
  assert.equal(result.status, 'success');
  assert.equal(result.cash, 12000);
  assert.equal(result.totalAsset, 15000);
  assert.equal(result.surgeResults[0].outcome, 'cancelled');
  assert.equal(valuationCash, 12000);
  assert.equal(snapshot.sessionId, 'session-1');
  assert.equal(snapshot.turnNumber, 20);
  assert.equal(snapshot.totalAsset, 15000);
  assert.equal(snapshot.session.cash, 12000);
  assert.equal(snapshot.session.debt, 0);
  const finalCashUpdate = calls.find((call) => /SET cash = \$2/.test(call.sql));
  assert.deepEqual(finalCashUpdate.params, ['session-1', 12000]);
});
