const test = require('node:test');
const assert = require('node:assert/strict');

const dbPath = require.resolve('../src/db');
const gameServicePath = require.resolve('../src/services/gameService');
const repaymentServicePath = require.resolve('../src/services/repaymentService');
const surgeServicePath = require.resolve('../src/services/surgeStockService');
const valuationServicePath = require.resolve('../src/services/valuationService');
const reportServicePath = require.resolve('../src/services/reportService');
const turnServicePath = require.resolve('../src/services/turnService');
const realDb = require(dbPath);
const realGameService = require(gameServicePath);
const realRepaymentService = require(repaymentServicePath);
const realSurgeService = require(surgeServicePath);
const realValuationService = require(valuationServicePath);
const realReportService = require(reportServicePath);

function loadTurnService({ client, evaluateEndCondition, recordMissedIfUnpaid }) {
  let valuationCash;
  let snapshot;
  require.cache[dbPath].exports = {
    ...realDb,
    withTransaction: async (fn) => fn(client),
  };
  require.cache[gameServicePath].exports = {
    ...realGameService,
    evaluateEndCondition,
  };
  require.cache[repaymentServicePath].exports = {
    ...realRepaymentService,
    recordMissedIfUnpaid,
  };
  require.cache[surgeServicePath].exports = {
    ...realSurgeService,
    closePendingAtGameEnd: async (_client, session) => {
      session.cash = Number(session.cash) + 3000;
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
  delete require.cache[turnServicePath];
  const service = require(turnServicePath);
  return {
    service,
    getValuationCash: () => valuationCash,
    getSnapshot: () => snapshot,
  };
}

test.after(() => {
  require.cache[dbPath].exports = realDb;
  require.cache[gameServicePath].exports = realGameService;
  require.cache[repaymentServicePath].exports = realRepaymentService;
  require.cache[surgeServicePath].exports = realSurgeService;
  require.cache[valuationServicePath].exports = realValuationService;
  require.cache[reportServicePath].exports = realReportService;
  delete require.cache[turnServicePath];
  realDb.pool.end();
});

function terminalClient(session) {
  return {
    query: async (sql) => {
      if (sql.includes('SELECT * FROM game_sessions')) return { rows: [session] };
      return { rows: [{}] };
    },
  };
}

test('pre-advance termination snapshots surge refund before returning', async () => {
  const session = {
    id: 'session-1', status: 'active', current_turn: 20,
    cash: '7000', debt: '1000', stress: 85, trust: 0,
  };
  const loaded = loadTurnService({
    client: terminalClient(session),
    evaluateEndCondition: async () => 'failed',
    recordMissedIfUnpaid: async () => ({ monthIndex: 1 }),
  });

  const result = await loaded.service.advanceTurn('session-1');

  assert.equal(result.status, 'failed');
  assert.equal(result.totalAsset, 15000);
  assert.equal(result.surgeResults[0].outcome, 'cancelled');
  assert.equal(loaded.getValuationCash(), 10000);
  assert.equal(loaded.getSnapshot().turnNumber, 20);
  assert.equal(loaded.getSnapshot().session.cash, 10000);
});

test('turn-240 termination snapshots surge refund after turn-limit evaluation', async () => {
  const session = {
    id: 'session-2', status: 'active', current_turn: 240,
    cash: '7000', debt: '1000', stress: 50, trust: 50,
  };
  const evaluations = [];
  const loaded = loadTurnService({
    client: terminalClient(session),
    evaluateEndCondition: async (_client, _session, options) => {
      evaluations.push(options);
      return options?.turnLimitReached ? 'failed' : 'active';
    },
    recordMissedIfUnpaid: async () => null,
  });

  const result = await loaded.service.advanceTurn('session-2');

  assert.equal(result.status, 'failed');
  assert.equal(result.totalAsset, 15000);
  assert.equal(evaluations.length, 2);
  assert.equal(evaluations[1].turnLimitReached, true);
  assert.equal(loaded.getValuationCash(), 10000);
  assert.equal(loaded.getSnapshot().turnNumber, 240);
  assert.equal(loaded.getSnapshot().session.cash, 10000);
});
