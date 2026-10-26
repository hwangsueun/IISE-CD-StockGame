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
  assert.equal(result.cashBefore, 10000);
  assert.equal(result.debtBefore, 1000);
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

function loadRepaymentService(session, { duplicate = false } = {}) {
  const calls = [];
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('SELECT * FROM game_sessions')) return { rows: [session] };
    if (sql.includes('SELECT 1 FROM repayments')) return { rows: duplicate ? [{ exists: 1 }] : [] };
    return { rows: [] };
  } };
  require.cache[dbPath].exports = {
    ...realDb,
    query: client.query,
    withTransaction: async (fn) => fn(client),
  };
  require.cache[gameServicePath].exports = {
    ...realGameService,
    evaluateEndCondition: async (_client, evaluated) => evaluated.debt === 0 ? 'success' : 'active',
  };
  require.cache[surgeServicePath].exports = {
    ...realSurgeService,
    closePendingAtGameEnd: async () => [],
  };
  require.cache[valuationServicePath].exports = {
    ...realValuationService,
    computeTotalAsset: async (_id, _client, { cash }) => cash,
  };
  require.cache[reportServicePath].exports = {
    ...realReportService,
    syncTerminalSnapshots: async () => {},
  };
  delete require.cache[repaymentServicePath];
  return { service: require(repaymentServicePath), client, calls };
}

const finalPaymentSession = () => ({
  id: 'last-payment', status: 'active', current_turn: 240,
  cash: '10000000', debt: '8333326', debt_initial: '100000000',
  trust: 100, stress: 20,
});

test('paying the last rounded balance counts as full payment without penalties', async () => {
  const { service, calls } = loadRepaymentService(finalPaymentSession());
  const result = await service.repay('last-payment', 8333326);

  assert.equal(result.dueAmount, 8333326);
  assert.equal(result.ratio, 1);
  assert.equal(result.trustDelta, 0);
  assert.equal(result.stressDelta, 0);
  assert.equal(result.trust, 100);
  assert.equal(result.stress, 20);
  assert.equal(result.status, 'success');
  assert.equal(result.cashBefore, 10000000);
  assert.equal(result.debtBefore, 8333326);
  assert.equal(result.cash, 1666674);
  assert.equal(result.debtRemaining, 0);
  const record = calls.find(({ sql }) => sql.includes('INSERT INTO repayments'));
  assert.deepEqual(record.params, ['last-payment', 12, 8333326, 8333326, 1, 0, 0]);
});

test('remaining debt caps the due amount even before the final month', async () => {
  const session = { ...finalPaymentSession(), current_turn: 40, debt: '500000' };
  const { service } = loadRepaymentService(session);
  const result = await service.repay(session.id, 500000);

  assert.equal(result.monthIndex, 2);
  assert.equal(result.dueAmount, 500000);
  assert.equal(result.ratio, 1);
  assert.equal(result.trustDelta, 0);
  assert.equal(result.stressDelta, 0);
  assert.equal(result.status, 'success');
});

test('missed repayment records the same capped remaining balance', async () => {
  const session = finalPaymentSession();
  const { service, client, calls } = loadRepaymentService(session);
  const result = await service.recordMissedIfUnpaid(client, session);

  assert.equal(result.dueAmount, 8333326);
  assert.equal(result.ratio, 0);
  assert.equal(result.trustDelta, -25);
  assert.equal(result.stressDelta, 35);
  assert.equal(session.trust, 75);
  assert.equal(session.stress, 55);
  const record = calls.find(({ sql }) => sql.includes('INSERT INTO repayments'));
  assert.deepEqual(record.params, ['last-payment', 12, 8333326, -25, 35]);
});

test('completed repayment remains protected from duplicate charges and missed penalties', async () => {
  const session = finalPaymentSession();
  const { service, client, calls } = loadRepaymentService(session, { duplicate: true });

  await assert.rejects(service.repay(session.id, 8333326), /이번 달 상환은 이미 완료했습니다/);
  assert.equal(await service.recordMissedIfUnpaid(client, session), null);
  assert.equal(calls.some(({ sql }) => /^\s*(UPDATE|INSERT)/.test(sql)), false);
});

test('month status retains the recorded due after a payment reduces remaining debt', async () => {
  const session = { ...finalPaymentSession(), debt: '0' };
  const { service } = loadRepaymentService(session);
  let params;
  const status = await service.getMonthStatus(session, 240, {
    query: async (_sql, values) => {
      params = values;
      return { rows: [{ due_amount: '8333326' }] };
    },
  });

  assert.deepEqual(params, [session.id, 12]);
  assert.deepEqual(status, { repaymentCompleted: true, repaymentDueAmount: 8333326 });
});

test('unpaid month status provides the capped outstanding amount', async () => {
  const session = finalPaymentSession();
  const { service } = loadRepaymentService(session);
  const status = await service.getMonthStatus(session, 240, {
    query: async () => ({ rows: [] }),
  });
  assert.deepEqual(status, { repaymentCompleted: false, repaymentDueAmount: 8333326 });
});
