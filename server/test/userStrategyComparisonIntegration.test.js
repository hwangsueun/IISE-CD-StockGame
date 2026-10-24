const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

test('saved model comparison API: matched periods, frozen models, persistence, validation and session isolation', {
  skip: process.env.USER_STRATEGY_COMPARISON_INTEGRATION !== '1', timeout: 180000,
}, async t => {
  require('dotenv').config();
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/antsurvival_challenge_20261019');
  const db = require('../src/db'), S = require('../src/services/userStrategyService');
  const { template } = require('../src/strategy/catalog');
  const dates = require('../src/strategy/engine').weekdays('2020-01-02', '2021-02-01').slice(0, 240), ids = [];
  t.after(async () => {
    for (const id of ids) await db.query('DELETE FROM game_sessions WHERE id=$1', [id]);
    await db.pool.end();
  });
  async function session() {
    const { rows: [s] } = await db.query(`INSERT INTO game_sessions
      (difficulty,start_date,initial_cash,cash,debt_initial,debt,monthly_living_cost)
      VALUES ('normal',$1,17000000,17000000,100000000,100000000,800000) RETURNING *`, [dates[0]]);
    ids.push(s.id); await require('../src/services/turnSelector').createGameTurns(db, s.id, dates);
    return s;
  }
  const s = await session(), other = await session();
  const configs = [
    { ...template('learning'), name: 'Ridge 비교', method: 'ridge' },
    { ...template(), name: '현금 비교', exposure: 0 },
    { ...template('learning'), name: 'LightGBM 비교', method: 'lightgbm', ensembleTrees: 50 },
  ];
  const versions = [];
  for (let i = 0; i < configs.length; i++) {
    await db.query('UPDATE game_sessions SET current_turn=$2 WHERE id=$1', [s.id, 1 + i * 5]);
    versions.push((await S.save(s.id, { config: configs[i], requestKey: randomUUID() })).id);
  }
  const { rows: originals } = await db.query('SELECT id,config,model,source_hash FROM user_strategy_versions WHERE session_id=$1 ORDER BY id', [s.id]);
  const post = async (sid, body) => {
    const res = await fetch(`http://127.0.0.1:3002/api/game/${sid}/quant/strategies/compare-saved`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const request = { versionIds: versions, period: 'practice', feeBps: 20 };
  assert.equal((await post(s.id, { ...request, versionIds: [versions[0]] })).status, 400);
  assert.equal((await post(s.id, { ...request, versionIds: [versions[0], versions[0]] })).status, 400);
  assert.equal((await post(s.id, { ...request, versionIds: [...versions, randomUUID(), randomUUID()] })).status, 400);
  assert.equal((await post(s.id, { ...request, period: 'future' })).status, 400);
  assert.equal((await post(s.id, { ...request, feeBps: 99 })).status, 400);
  assert.equal((await post(other.id, request)).status, 404);
  const past = await post(s.id, request);
  assert.equal(past.status, 200, JSON.stringify(past.body));
  assert.equal(past.body.reports.length, 3);
  for (const r of past.body.reports) {
    assert.equal(r.from, past.body.from); assert.equal(r.to, dates[10]); assert.equal(r.turnCount, 240);
    assert.equal(r.initialCash, 17000000); assert.equal(r.feeBps, 20);
    if (r.model) assert.ok(r.model.trainedThrough < r.from);
  }
  assert.equal(past.body.reports[1].own.returnRate, 0);
  assert.equal(past.body.reports[2].model.library, 'lightgbm');
  assert.deepEqual(await S.report(s.id, past.body.id), past.body);
  await db.query('UPDATE game_sessions SET current_turn=41 WHERE id=$1', [s.id]);
  const observed = await post(s.id, { versionIds: versions, period: 'observe' });
  assert.equal(observed.status, 200, JSON.stringify(observed.body));
  assert.equal(observed.body.commonStartTurn, 11);
  assert.equal(observed.body.from, dates[10]); assert.equal(observed.body.to, dates[40]);
  for (const r of observed.body.reports) {
    assert.equal(r.feeBps, 0); assert.equal(r.turnCount, 31); assert.equal(r.chart[0].own, 0);
    assert.deepEqual(r.model, originals.find(v => v.id === r.versionId).model.signal);
  }
  assert.deepEqual(await S.report(s.id, observed.body.id), observed.body);
  const workspace = await S.workspace(s.id);
  assert.equal(workspace.runs.find(r => r.id === observed.body.id).comparison_period, 'observe');
  const { rows: after } = await db.query('SELECT id,config,model,source_hash FROM user_strategy_versions WHERE session_id=$1 ORDER BY id', [s.id]);
  assert.deepEqual(after, originals);
  const { rows: [player] } = await db.query('SELECT cash,debt FROM game_sessions WHERE id=$1', [s.id]);
  assert.equal(Number(player.cash), 17000000); assert.equal(Number(player.debt), 100000000);
  assert.equal(workspace.automation.enabled, false);
  const { rows: [orders] } = await db.query('SELECT COUNT(*)::int AS n FROM market_orders WHERE session_id=$1', [s.id]);
  assert.equal(orders.n, 0);
});
