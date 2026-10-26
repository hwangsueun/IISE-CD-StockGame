const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

test('automatic investing pauses through side jobs, stress and hospitalization, then reviews fresh state', {
  skip: process.env.AUTOMATION_EVENTS_INTEGRATION !== '1', timeout: 120000,
}, async t => {
  require('dotenv').config();
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/antsurvival_challenge_20261019');
  const db = require('../src/db');
  const A = require('../src/services/strategyAutomation');
  const S = require('../src/services/userStrategyService');
  const O = require('../src/services/orderService');
  const J = require('../src/services/sideJobService');
  const T = require('../src/services/turnService');
  const events = require('../src/services/eventEngine');
  const C = require('../src/config/constants');
  const dates = require('../src/strategy/engine').weekdays('2020-01-02', '2021-02-01').slice(0, 240);
  let sid;
  const random = Math.random;
  // Only this isolated test process: suppress unrelated random choices, keep actual faint rules.
  Math.random = () => 0.99999;
  t.after(async () => {
    Math.random = random;
    if (sid) await db.query('DELETE FROM game_sessions WHERE id=$1', [sid]);
    await db.pool.end();
  });
  const { rows: [created] } = await db.query(`INSERT INTO game_sessions
    (difficulty,start_date,initial_cash,cash,debt_initial,debt,monthly_living_cost,stress,trust)
    VALUES('normal',$1,50000000,50000000,100000000,100000000,800000,0,100) RETURNING *`, [dates[0]]);
  sid = created.id;
  await require('../src/services/turnSelector').createGameTurns(db, sid, dates);
  const session = async () => (await db.query('SELECT * FROM game_sessions WHERE id=$1', [sid])).rows[0];
  const sync = () => db.withTransaction(async client => {
    const { rows: [s] } = await client.query('SELECT * FROM game_sessions WHERE id=$1 FOR UPDATE', [sid]);
    return A.sync(client, s);
  });
  const holdings = async () => (await db.query(
    'SELECT asset_id,quantity,avg_price FROM holdings WHERE session_id=$1 ORDER BY asset_id', [sid])).rows;
  const countTrades = async () => Number((await db.query('SELECT COUNT(*) FROM trades WHERE session_id=$1', [sid])).rows[0].count);
  const pending = async () => (await O.listOrders(sid)).filter(o => o.status === 'pending');
  const v = await S.save(sid, {
    config: { ...require('../src/strategy/catalog').base, name: '이벤트 회귀 검사', topK: 3, exposure: 50, maxWeight: 20 },
    requestKey: randomUUID(),
  });
  await A.configure(sid, { enabled: true, versionId: v.id });
  const first = await sync();
  assert.ok(first.orderCount > 0);
  const queued = await pending();
  const stock = queued[0];
  const { rows: [manualStock] } = await db.query(`SELECT a.asset_id FROM assets a
    JOIN stock_price_detail d USING(asset_id) JOIN asset_prices p ON p.asset_id=a.asset_id AND p.trade_date=d.trade_date
    WHERE a.asset_type='stock' AND a.is_active AND d.trade_date=$1 AND d.open_price>0
      AND p.close_price BETWEEN 1 AND 100000 AND a.asset_id<>ALL($2::text[]) LIMIT 1`,
    [dates[0], queued.map(o => o.assetId)]);
  assert.ok(manualStock);
  await O.submitOrder(sid, { assetId: manualStock.asset_id, tradeType: 'buy', quantity: 1 });
  // A benchmark order is outside the player's event restrictions.
  await db.query(`INSERT INTO market_orders
    (session_id,owner,order_key,asset_id,side,decision_turn,decision_date,quantity,reference_price,cash_budget)
    VALUES($1,'quant','event-test-benchmark',$2,'buy',1,$3,1,$4,$4)`,
    [sid, stock.assetId, dates[0], stock.referencePrice]);
  const job = await J.submitPlay(sid, 'catch_waxon', 0);
  assert.equal(job.cancelledOrderCount, queued.length + 1);
  assert.equal(Number((await session()).cash), 50000000 + job.cashReward);
  assert.deepEqual(await holdings(), []);
  assert.equal((await A.state(sid)).pauseCode, 'side_job');
  assert.equal((await A.state(sid)).enabled, true);
  assert.equal((await A.configure(sid, { enabled: true, versionId: v.id })).paused, true);
  assert.equal((await pending()).length, 0);
  assert.ok((await O.listOrders(sid)).every(o => o.reason === 'investment_locked_side_job'));
  assert.equal((await db.query("SELECT status FROM market_orders WHERE session_id=$1 AND owner='quant'", [sid])).rows[0].status, 'pending');
  await assert.rejects(J.submitPlay(sid, 'catch_waxon', 0), /하루 1회/);
  await assert.rejects(O.submitOrder(sid, { assetId: stock.assetId, tradeType: 'buy', quantity: 1 }), /부업/);
  // A repeated decision in the same turn cannot recreate the cancelled orders.
  assert.equal(await sync(), null);
  await T.advanceTurn(sid);
  assert.equal(await countTrades(), 0);
  assert.equal((await A.state(sid)).paused, false);
  assert.ok((await A.state(sid)).nextReview <= 2);
  const resumed = await T.advanceTurn(sid);
  assert.equal(resumed.modelAutomation.status, 'reviewed');
  assert.ok(resumed.orderResults.some(o => o.strategyVersionId === v.id && o.filledQuantity > 0));
  assert.ok(resumed.orderResults.every(o => o.decisionTurn === 2));
  const held = await holdings();
  assert.ok(held.length > 0);
  const tradeCount = await countTrades();

  // Queue a valid model sell before a choice raises stress from 98 to 100.
  const current = await session();
  const { rows: [price] } = await db.query('SELECT close_price FROM asset_prices WHERE asset_id=$1 AND trade_date=$2',
    [held[0].asset_id, dates[current.current_turn - 1]]);
  await db.query(`INSERT INTO market_orders
    (session_id,owner,order_key,asset_id,side,decision_turn,decision_date,quantity,reference_price,cash_budget,strategy_version_id)
    VALUES($1,'player','pre-stress-sell',$2,'sell',$3,$4,1,$5,0,$6)`,
    [sid, held[0].asset_id, current.current_turn, dates[current.current_turn - 1], price.close_price, v.id]);
  await db.query('UPDATE game_sessions SET stress=98 WHERE id=$1', [sid]);
  const { rows: [choice] } = await db.query(`INSERT INTO event_log(session_id,turn_number,event_type,detail,resolved)
    VALUES($1,$2,'loan_shark_call','{}',FALSE) RETURNING id`, [sid, current.current_turn]);
  await events.resolveEvent(sid, choice.id, 'hang_up');
  assert.equal((await A.state(sid)).pauseCode, 'stress_limit');
  assert.equal((await pending()).length, 0);
  assert.equal((await J.getStatus(sid)).available, false);
  await assert.rejects(O.submitOrder(sid, { assetId: held[0].asset_id, tradeType: 'sell', quantity: 1 }), /스트레스/);
  const beforeHospital = Number((await session()).cash);
  const admission = await T.advanceTurn(sid);
  assert.ok(admission.events.some(e => e.eventType === 'faint'));
  assert.equal(admission.modelAutomation.pauseCode, 'stress_limit');
  assert.equal(admission.orderResults.length, 0);
  assert.equal(Number((await session()).cash), beforeHospital - C.HOSPITAL_COST);
  assert.equal((await A.state(sid)).pauseCode, 'hospitalized');
  assert.deepEqual(await holdings(), held);
  await assert.rejects(J.submitPlay(sid, 'catch_waxon', 0), /입원/);

  // An old queued order cannot bypass the settlement guard during hospitalization.
  const hospitalized = await session();
  await db.query(`INSERT INTO market_orders
    (session_id,owner,order_key,asset_id,side,decision_turn,decision_date,quantity,reference_price,cash_budget,strategy_version_id)
    VALUES($1,'player','legacy-locked-sell',$2,'sell',1,$3,1,$4,0,$5)`,
    [sid, held[0].asset_id, dates[0], price.close_price, v.id]);
  await db.withTransaction(async client => {
    await client.query('SELECT id FROM game_sessions WHERE id=$1 FOR UPDATE', [sid]);
    assert.deepEqual(await O.settlePendingOrders(client, hospitalized, dates[hospitalized.current_turn - 1], true), []);
  });
  assert.equal((await O.listOrders(sid)).find(o => o.reason === 'investment_locked_hospital').status, 'cancelled');
  while ((await session()).current_turn <= hospitalized.action_locked_until_turn) {
    const next = await T.advanceTurn(sid);
    assert.equal(next.modelAutomation.status, 'paused');
    assert.equal(next.orderResults.length, 0);
    assert.equal(await countTrades(), tradeCount);
    assert.deepEqual(await holdings(), held);
  }
  assert.equal((await A.state(sid)).paused, false);
  const restarted = await T.advanceTurn(sid);
  assert.equal(restarted.modelAutomation.status, 'reviewed');
  assert.equal((await A.state(sid)).enabled, true);

  // Concurrent end-of-day review and side-job completion share the session lock.
  await db.query('UPDATE user_strategy_automation SET next_review_turn=1 WHERE session_id=$1', [sid]);
  const beforeJob = await session();
  const outcomes = await Promise.allSettled([sync(), J.submitPlay(sid, 'catch_waxon', 0)]);
  assert.ok(outcomes.every(o => o.status === 'fulfilled'));
  assert.equal((await pending()).length, 0);
  assert.equal(Number((await session()).cash), Number(beforeJob.cash) + outcomes[1].value.cashReward);
  assert.equal((await A.state(sid)).paused, true);
  await A.configure(sid, { enabled: false });
  await T.advanceTurn(sid);
  assert.equal((await A.state(sid)).enabled, false);
  assert.equal((await pending()).length, 0);
});
