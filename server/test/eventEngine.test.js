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

test('joining study uses this session history and persists the matching lesson and quiz for later visits', async () => {
  const calls = [];
  const learned = [{ detail: { insight: '분산 투자는 개별 종목 리스크를 줄여준다.' } }];
  const events = new Map([[101, false], [102, false]]);
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT e.id AS log_id')) {
        return { rows: [{
          log_id: params[0], event_type: 'invest_study', resolved: events.get(params[0]),
          id: params[1], current_turn: 10, cash: '50000', debt: '100000', stress: 60, trust: 50,
          action_locked_until_turn: 0,
        }] };
      }
      if (sql.includes('SELECT detail FROM event_log')) {
        assert.deepEqual(params, ['study-session']);
        assert.match(sql, /session_id = \$1/);
        assert.match(sql, /event_type = 'invest_study' AND resolved = TRUE/);
        assert.match(sql, /ORDER BY id DESC/);
        return { rows: [...learned] };
      }
      if (sql.includes('SET resolved = TRUE')) {
        events.set(params[0], true);
        learned.unshift({ detail: JSON.parse(params[4]) });
      }
      return { rows: [{}] };
    },
  };
  const service = loadEventEngine({
    db: { ...realDb, withTransaction: async (fn) => fn(client) },
    gameService: { ...realGameService, evaluateEndCondition: async () => 'active' },
  });

  const first = await service.resolveEvent('study-session', 101, 'join');
  const second = await service.resolveEvent('study-session', 102, 'join');
  const { KNOWLEDGE } = require('../src/education/investmentStudyKnowledge');
  for (const result of [first, second]) {
    const lesson = KNOWLEDGE.find((item) => item.id === result.detail.insightId);
    assert.ok(lesson);
    assert.equal(result.detail.insight, lesson.insight);
    assert.equal(result.detail.insightTitle, lesson.title);
    assert.equal(result.detail.insightTopic, lesson.topic);
    assert.deepEqual(result.detail.quiz, lesson.quiz);
    assert.ok(result.stressDelta >= -15 && result.stressDelta <= -6);
    assert.equal(result.cash, 50000);
    assert.equal(result.debt, 100000);
    assert.equal(result.status, 'active');
  }
  assert.notEqual(first.detail.insightId, 'diversify_single');
  assert.notEqual(second.detail.insightId, first.detail.insightId);
  assert.notEqual(second.detail.insightTopic, first.detail.insightTopic);
  assert.deepEqual(learned[0].detail, { chosen: 'join', ...second.detail });
  assert.deepEqual(learned[1].detail, { chosen: 'join', ...first.detail });
  assert.ok(calls.find((call) => call.sql.includes('FOR UPDATE OF e, s')));
  await assert.rejects(service.resolveEvent('study-session', 102, 'join'), /이미 처리된 이벤트/);
  assert.equal(calls.filter((call) => call.sql.includes('SELECT detail FROM event_log')).length, 2);
});

test('declining study has no lesson selection, history lookup, or financial effect', async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT e.id AS log_id')) return { rows: [{
        log_id: 201, event_type: 'invest_study', resolved: false, id: 'study-session',
        current_turn: 10, cash: '50000', debt: '100000', stress: 60, trust: 50,
        action_locked_until_turn: 0,
      }] };
      return { rows: [{}] };
    },
  };
  const service = loadEventEngine({
    db: { ...realDb, withTransaction: async (fn) => fn(client) },
    gameService: { ...realGameService, evaluateEndCondition: async () => 'active' },
  });
  const result = await service.resolveEvent('study-session', 201, 'decline');
  assert.equal(result.detail, undefined);
  assert.equal(result.cash, 50000);
  assert.equal(result.debt, 100000);
  assert.equal(result.stress, 60);
  assert.equal(result.trust, 50);
  assert.equal(calls.filter((call) => call.sql.includes('SELECT detail FROM event_log')).length, 0);
  const resolved = calls.find((call) => call.sql.includes('SET resolved = TRUE'));
  assert.deepEqual(JSON.parse(resolved.params[4]), { chosen: 'decline' });
});

test('bonus study tasks contain general checks rather than fabricated future signals', () => {
  const { EVENT_DEFS } = loadEventEngine();
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    const { detail } = EVENT_DEFS.invest_study.choices[0].effect();
    assert.equal(detail.rare, true);
    assert.equal(detail.directionHint.scope, 'study');
    assert.equal(detail.omenHint.scope, 'budget');
    assert.doesNotMatch(detail.directionHint.text, /다음 주|조짐|상승 확정|수익 보장/);
    assert.doesNotMatch(detail.omenHint.text, /조만간|예감|생길 것/);
  } finally {
    Math.random = originalRandom;
  }
});
