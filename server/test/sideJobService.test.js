const test = require('node:test');
const assert = require('node:assert/strict');

const dbPath = require.resolve('../src/db');
const servicePath = require.resolve('../src/services/sideJobService');
const realDb = require(dbPath);

function fixture(overrides = {}) {
  const calls = [];
  const session = {
    id: 'side-job-test', status: 'active', current_turn: 10, action_locked_until_turn: 0,
    side_job_turn: 0, cash: '50000000', stress: 20, ...overrides,
  };
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('SELECT * FROM game_sessions')) return { rows: [session] };
    if (sql.includes('UPDATE market_orders')) return { rows: [{ id: 1 }, { id: 2 }] };
    return { rows: [{}] };
  } };
  require.cache[dbPath].exports = {
    ...realDb,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT current_turn')) return { rows: [session] };
      return { rows: [] };
    },
    withTransaction: async (fn) => fn(client),
  };
  delete require.cache[servicePath];
  return { service: require(servicePath), session, calls };
}

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
  assert.deepEqual(status.auto, { cashReward: 30000, stressDelta: 10, manualMinReward: 60000 });
  assert.equal(result.mode, 'manual');
  assert.equal(result.cashReward, 60000);
  assert.equal(result.tradingLockedToday, true);
  assert.ok(calls.every((call) => !/game_turns|asset_prices|trade_date/.test(call.sql)));
});

test('auto ignores submitted scores for every game and records its fixed reward with compatible DB values', async () => {
  for (const gameKey of ['avoid_professor', 'catch_waxon', 'sort_characters']) {
    for (const rawScore of [undefined, Infinity, NaN, 999999999, { cashReward: 999999999 }]) {
      const { service, calls } = fixture();
      const result = await service.submitPlay('side-job-test', gameKey, rawScore, 'auto');
      assert.equal(result.mode, 'auto');
      assert.equal(result.grade, 'auto');
      assert.equal(result.rawScore, null);
      assert.equal(result.cashReward, 30000);
      assert.equal(result.stressDelta, 10);
      assert.equal(result.stress, 30);
      assert.equal(result.cash, 50030000);
      assert.equal(result.tradingLockedToday, true);
      assert.equal(result.cancelledOrderCount, 2);
      assert.equal(result.investmentRestriction.code, 'side_job');
      assert.ok(calls[0].sql.includes('FOR UPDATE'));
      const play = calls.find((call) => call.sql.includes('INSERT INTO side_job_plays'));
      assert.deepEqual(play.params, ['side-job-test', 10, gameKey, 0, 'great_fail', 30000, 10]);
      const event = calls.find((call) => call.sql.includes('INSERT INTO event_log'));
      assert.deepEqual(JSON.parse(event.params[2]), { gameKey, mode: 'auto', rawScore: null, grade: 'auto' });
      assert.ok(calls.some((call) => call.sql.includes('UPDATE market_orders') && call.params[1] === 'investment_locked_side_job'));
      assert.ok(calls.some((call) => call.sql.includes('UPDATE user_strategy_automation')));
    }
  }
});

test('auto reward is below every possible manual grade reward, including a zero-score attempt', async () => {
  const { service } = fixture();
  const status = await service.getStatus('side-job-test');
  for (const { payRate } of Object.values(status.grades)) {
    assert.ok(status.auto.cashReward < Math.round(status.basePay * payRate));
  }
  const auto = await service.submitPlay('side-job-test', 'catch_waxon', undefined, 'auto');
  const manual = await fixture().service.submitPlay('side-job-test', 'catch_waxon', 0);
  assert.ok(auto.cashReward < manual.cashReward);
});

test('manual and auto share the once-per-day lock in either order', async () => {
  for (const modes of [['auto', 'manual'], ['manual', 'auto'], ['auto', 'auto']]) {
    const { service, calls } = fixture();
    await service.submitPlay('side-job-test', 'catch_waxon', 0, modes[0]);
    await assert.rejects(service.submitPlay('side-job-test', 'avoid_professor', 0, modes[1]), /하루 1회/);
    assert.equal(calls.filter((call) => call.sql.includes('INSERT INTO side_job_plays')).length, 1);
  }
});

test('both modes preserve hospitalization, stress and ended-game guards before any payment', async () => {
  for (const mode of ['auto', 'manual']) {
    for (const [change, message] of [
      [{ action_locked_until_turn: 10 }, /입원 중/],
      [{ stress: 100 }, /스트레스가 한계/],
      [{ status: 'failed' }, /종료된 게임/],
      [{ status: 'success' }, /종료된 게임/],
    ]) {
      const { service, calls } = fixture(change);
      assert.equal((await service.getStatus('side-job-test')).available, false);
      await assert.rejects(service.submitPlay('side-job-test', 'catch_waxon', 0, mode), message);
      assert.ok(!calls.some((call) => /^\s*(UPDATE|INSERT)\b/.test(call.sql)));
    }
  }
});

test('manual rejects nonfinite, negative, missing and nonnumeric scores before opening a transaction', async () => {
  for (const rawScore of [Infinity, -Infinity, NaN, -1, undefined, null, '', '   ', 'Infinity', 'NaN', {}, [], false]) {
    const { service, calls } = fixture();
    await assert.rejects(service.submitPlay('side-job-test', 'catch_waxon', rawScore), /유한한 숫자/);
    assert.equal(calls.length, 0);
  }
  const result = await fixture().service.submitPlay('side-job-test', 'catch_waxon', '5');
  assert.equal(result.rawScore, 5);
  assert.equal(result.grade, 'fail');
  assert.equal(result.cashReward, 180000);
});

test('invalid mode or game cannot bypass validation through auto', async () => {
  for (const mode of ['', null, 'AUTO', 'autoplay', {}, 1]) {
    const { service, calls } = fixture();
    await assert.rejects(service.submitPlay('side-job-test', 'catch_waxon', undefined, mode), /mode/);
    assert.equal(calls.length, 0);
  }
  await assert.rejects(fixture().service.submitPlay('side-job-test', 'unknown', undefined, 'auto'), /gameKey/);
});
