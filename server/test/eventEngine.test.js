const test = require('node:test');
const assert = require('node:assert/strict');

const dbPath = require.resolve('../src/db');
const gameServicePath = require.resolve('../src/services/gameService');
const surgeServicePath = require.resolve('../src/services/surgeStockService');
const valuationServicePath = require.resolve('../src/services/valuationService');
const eventEnginePath = require.resolve('../src/services/eventEngine');
const realDb = require(dbPath);
const realGameService = require(gameServicePath);
const realSurgeService = require(surgeServicePath);
const realValuationService = require(valuationServicePath);

function loadEventEngine({ db, gameService, surgeService, valuationService } = {}) {
  require.cache[dbPath].exports = db || realDb;
  require.cache[gameServicePath].exports = gameService || realGameService;
  require.cache[surgeServicePath].exports = surgeService || realSurgeService;
  require.cache[valuationServicePath].exports = valuationService || realValuationService;
  delete require.cache[eventEnginePath];
  return require(eventEnginePath);
}

test.after(() => {
  require.cache[dbPath].exports = realDb;
  require.cache[gameServicePath].exports = realGameService;
  require.cache[surgeServicePath].exports = realSurgeService;
  require.cache[valuationServicePath].exports = realValuationService;
  delete require.cache[eventEnginePath];
  realDb.pool.end();
});

test('surge stock never spawns on a weekday market holiday', () => {
  const { EVENT_DEFS } = loadEventEngine();
  const session = { current_turn: 10, action_locked_until_turn: 0, stress: 99 };
  assert.equal(
    EVENT_DEFS.surge_stock.trigger({ session, marketOpen: false, hasFutureMarketOpen: true }),
    false
  );
});

test('surge stock never spawns without a later open turn for settlement', () => {
  const { EVENT_DEFS } = loadEventEngine();
  const session = { current_turn: 239, action_locked_until_turn: 0, stress: 99 };
  assert.equal(
    EVENT_DEFS.surge_stock.trigger({ session, marketOpen: true, hasFutureMarketOpen: false }),
    false
  );
  assert.equal(EVENT_DEFS.surge_stock.trigger({ session }), false);
});

test('loan shark payment that clears debt ends immediately and snapshots refunded surge cash', async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT e.id AS log_id')) {
        return {
          rows: [{
            log_id: 41,
            event_type: 'loan_shark_call',
            resolved: false,
            id: 'session-1',
            status: 'active',
            current_turn: 10,
            cash: '10000',
            debt: '1000',
            stress: 20,
            trust: 50,
            action_locked_until_turn: 0,
          }],
        };
      }
      return { rows: [{}] };
    },
  };

  let evaluatedState;
  let cleanupCash;
  let valuationCash;
  const service = loadEventEngine({
    db: {
      ...realDb,
      withTransaction: async (fn) => fn(client),
    },
    gameService: {
      ...realGameService,
      evaluateEndCondition: async (transactionClient, session, options) => {
        evaluatedState = { ...session };
        return realGameService.evaluateEndCondition(transactionClient, session, options);
      },
    },
    surgeService: {
      ...realSurgeService,
      closePendingAtGameEnd: async (_client, session) => {
        cleanupCash = session.cash;
        session.cash += 3000;
        return [{ surgeStockId: 9, investedAmount: 3000, outcome: 'cancelled' }];
      },
    },
    valuationService: {
      ...realValuationService,
      computeTotalAsset: async (_sessionId, _client, options) => {
        valuationCash = options.cash;
        return 15000;
      },
    },
  });

  const result = await service.resolveEvent('session-1', 41, 'pay', { amount: 1000 });

  assert.equal(evaluatedState.cash, 9000);
  assert.equal(evaluatedState.debt, 0);
  assert.equal(evaluatedState.stress, 17);
  assert.equal(cleanupCash, 9000);
  assert.equal(valuationCash, 12000);
  assert.equal(result.status, 'success');
  assert.equal(result.finished, true);
  assert.equal(result.cash, 12000);
  assert.equal(result.debt, 0);
  assert.equal(result.totalAsset, 15000);
  assert.equal(result.surgeResults[0].outcome, 'cancelled');

  const finalSessionUpdate = calls.find((call) => /SET cash = \$2, debt = \$3/.test(call.sql));
  assert.deepEqual(finalSessionUpdate.params, ['session-1', 12000, 0, 17, 50, 'success']);
  const dailySnapshot = calls.find((call) => call.sql.includes('INSERT INTO session_snapshots'));
  assert.deepEqual(dailySnapshot.params, ['session-1', 10, 15000, 12000, 0, 17, 50]);
  assert.match(dailySnapshot.sql, /ON CONFLICT[\s\S]+DO UPDATE/);
  const otherSnapshots = calls.find((call) =>
    call.sql.includes('UPDATE session_snapshots') && call.sql.includes("snapshot_type <> 'daily'")
  );
  assert.deepEqual(otherSnapshots.params, ['session-1', 10, 15000, 12000, 0, 17, 50]);
});
