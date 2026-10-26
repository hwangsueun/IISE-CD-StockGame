const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
// Opt-in against the local challenge copy only. Existing sessions/prices are never modified.
test('real data: recipes, learners, idempotent versions, fixed observation and session isolation', {
  skip: process.env.USER_STRATEGY_INTEGRATION !== '1', timeout: 300000,
}, async t => {
  require('dotenv').config();
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/antsurvival_challenge_20261019');
  const db = require('../src/db'), S = require('../src/services/userStrategyService');
  const { template, references } = require('../src/strategy/catalog');
  const E = require('../src/strategy/engine');
  const dates = E.weekdays('2020-01-02', '2021-02-01').slice(0, 240), ids = [];
  t.after(async () => {
    for (const id of ids) await db.query('DELETE FROM game_sessions WHERE id=$1', [id]);
    await db.pool.end();
  });
  async function session(cash) {
    const { rows: [s] } = await db.query(`INSERT INTO game_sessions(difficulty,start_date,initial_cash,cash,debt_initial,debt,monthly_living_cost)
      VALUES('normal',$1,$2,$2,100000000,100000000,800000) RETURNING *`, [dates[0], cash]);
    ids.push(s.id);
    await require('../src/services/turnSelector').createGameTurns(db, s.id, dates);
    return s;
  }
  const s = await session(10000000), other = await session(30000000);
  const { rows: panel } = await db.query(`SELECT d.asset_id FROM stock_price_detail d JOIN assets a USING(asset_id)
    WHERE d.trade_date BETWEEN '2016-01-01' AND '2020-01-02' AND a.is_active=true
    GROUP BY d.asset_id HAVING COUNT(*)>950 AND MIN(d.high_price-d.low_price)>0 ORDER BY d.asset_id LIMIT 3`);
  assert.equal(panel.length, 3);
  const riskAssets = panel.map(a => a.asset_id);
  for (const ref of references.filter(r => r.recipe)) {
    const c = template(ref.id); if (['har','garch','vhar','sparseVhar','ewma','ccc','dcc'].includes(c.riskModel) || c.stressTest) c.riskAssets = riskAssets;
    const r = await S.practice(s.id, { config: c, feeBps: 10 });
    assert.equal(r.turnCount, 240);
    assert.equal(r.initialCash, 10000000);
    assert.ok(r.to <= dates[0]);
    assert.ok(Number.isFinite(r.own.returnRate));
    assert.ok(r.rival);
    assert.equal(r.monthly.length, 12);
    if (r.model) assert.ok(r.model.trainedThrough < r.from);
    console.log(`${ref.id}: ${r.own.tradeCount} trades; ${r.own.returnRate.toFixed(4)} practice return`);
  }
  const tree = await S.practice(other.id, { config: { ...template('learning'), method: 'tree' }, feeBps: 20 });
  assert.equal(tree.initialCash, 30000000);
  assert.ok(tree.model.tree);
  assert.equal(tree.feeBps, 20);
  const compared = await S.compare(other.id, { config: { ...template('learning'), ensembleTrees: 50 }, feeBps: 20 });
  assert.equal(compared.initialCash, 30000000);
  assert.equal(compared.reports.length, 4);
  assert.deepEqual(await S.report(other.id, compared.id), compared);
  for (const r of compared.reports) {
    assert.equal(r.model.trainingHash, compared.training.trainingHash);
    assert.ok(r.model.trainedThrough < r.from);
    assert.equal(r.initialCash, 30000000); assert.equal(r.feeBps, 20);
  }
  console.log('matched model reports persisted without value changes');
  const workspace = await S.workspace(other.id);
  assert.equal(workspace.runs.find(r => r.id === compared.id).kind, 'compare');
  assert.equal(workspace.modelCapabilities.randomForest.available, true);
  for (const method of ['randomForest', 'lightgbm', 'xgboost']) {
    const nativeConfig = { ...template('learning'), method, ensembleTrees: 50 };
    const v = await S.save(other.id, { config: nativeConfig, requestKey: randomUUID() });
    const firstNative = await S.observe(other.id, v.id);
    await db.query('UPDATE game_sessions SET current_turn=41 WHERE id=$1', [other.id]);
    const laterNative = await S.observe(other.id, v.id);
    assert.deepEqual(firstNative.model, laterNative.model);
    assert.ok(laterNative.own.tradeCount > 0);
    assert.deepEqual(await S.observe(other.id, v.id), laterNative);
    await db.query('UPDATE game_sessions SET current_turn=1 WHERE id=$1', [other.id]);
    console.log(`${method}: saved parameters and repeated observation matched`);
  }
  const riskConfig = { ...template('volatility-label'), riskAssets, riskModel: 'sparseVhar', riskLagMode: 'auto', stressTest: true, trainYears: 3, ensembleTrees: 50 };
  const riskSaved = await S.save(other.id, { config: riskConfig, requestKey: randomUUID() });
  const riskFirst = await S.observe(other.id, riskSaved.id);
  await db.query('UPDATE game_sessions SET current_turn=41 WHERE id=$1', [other.id]);
  const riskLater = await S.observe(other.id, riskSaved.id);
  assert.deepEqual(riskFirst.model, riskLater.model); assert.deepEqual(riskFirst.riskModel, riskLater.riskModel);
  assert.ok(riskLater.calibration.count > 0);
  assert.ok(riskLater.stress); assert.deepEqual(await S.observe(other.id, riskSaved.id), riskLater);
  console.log('combined classifier + sparse VHAR + joint-loss scenario replay matched');
  const config = template('learning'), requestKey = randomUUID();
  const saved = await S.save(s.id, { config, requestKey }), retry = await S.save(s.id, { config, requestKey });
  assert.equal(retry.id, saved.id);
  assert.equal(retry.replayed, true);
  await assert.rejects(S.save(s.id, { config: { ...config, exposure: 50 }, requestKey }), /동일한 저장 요청/);
  await assert.rejects(S.observe(other.id, saved.id), /찾을 수 없습니다/);
  const first = await S.observe(s.id, saved.id);
  assert.equal(first.turnCount, 1);
  assert.equal(first.own.returnRate, 0);
  const frozenModel = JSON.stringify(first.model);
  await db.query('UPDATE game_sessions SET current_turn=41 WHERE id=$1', [s.id]);
  const later = await S.observe(s.id, saved.id);
  assert.equal(later.turnCount, 41);
  assert.equal(later.monthly.length, 2);
  assert.equal(JSON.stringify(later.model), frozenModel);
  assert.equal(later.chart[0].own, first.chart[0].own);
  assert.ok(later.own.tradeCount > 0);
  assert.deepEqual(await S.observe(s.id, saved.id), later);
  const { rows: [player] } = await db.query('SELECT cash,debt FROM game_sessions WHERE id=$1', [s.id]);
  assert.equal(Number(player.cash), 10000000);
  assert.equal(Number(player.debt), 100000000);
  const { rows: [{ count }] } = await db.query('SELECT COUNT(*) FROM market_orders WHERE session_id=$1', [s.id]);
  assert.equal(Number(count), 0);
  assert.equal(require('../src/config/constants').TRADE_FEE_RATE, 0);
});
