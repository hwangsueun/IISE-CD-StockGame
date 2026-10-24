const test = require('node:test');
const assert = require('node:assert/strict');

test('market comparison: real fills, external flows, late choices and historical sector API', {
  skip: process.env.MARKET_COMPARISON_INTEGRATION !== '1', timeout: 60000,
}, async t => {
  require('dotenv').config();
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/antsurvival_challenge_20261019');
  const db = require('../src/db');
  const { getPerformance } = require('../src/services/marketComparisonService');
  const orders = require('../src/services/orderService');
  const calendar = require('../src/services/turnSelector');
  const dates = calendar.buildWeekdayCalendar('2014-09-05', '2014-10-03');
  const { rows: [session] } = await db.query(`INSERT INTO game_sessions
    (difficulty,start_date,initial_cash,cash,debt_initial,debt,monthly_living_cost)
    VALUES ('normal',$1,50000000,50000000,100000000,100000000,800000) RETURNING *`, [dates[0]]);
  const sid = session.id;
  t.after(async () => { await db.query('DELETE FROM game_sessions WHERE id=$1', [sid]); await db.pool.end(); });
  await calendar.createGameTurns(db, sid, dates);
  const approx = (a,b) => assert.ok(Math.abs(a-b)<1e-9, `${a} != ${b}`);
  const read = async path => { const res = await fetch(`http://127.0.0.1:3002/api${path}`); return { status: res.status, body: await res.json() }; };

  const sectors = await read(`/assets/sectors?sessionId=${sid}&date=${dates[0]}`);
  assert.equal(sectors.status,200);
  assert.ok(sectors.body.sectors.length > 20);
  assert.deepEqual([...new Set(sectors.body.sectors.map(s=>s.market))].sort(), ['KOSDAQ','KOSPI']);
  for (const quote of sectors.body.sectors) {
    assert.ok(quote.date <= dates[0]);
    const { rows: source } = await db.query(`SELECT value,trade_date FROM macro_daily
      WHERE indicator_code=$1 AND trade_date<=$2 AND value>0 ORDER BY trade_date DESC LIMIT 2`, [quote.code,dates[0]]);
    approx(quote.changeRate, Number(source[0].value)/Number(source[1].value)-1);
  }
  assert.equal((await read(`/assets/sectors?sessionId=${sid}&date=2014-10-03`)).status,409);
  assert.equal((await read(`/assets/sectors?sessionId=${sid}&date=2014-02-30`)).status,400);
  assert.equal((await getPerformance(sid)).summary.playerReturn,0);
  const { rows: [asset] } = await db.query(`SELECT a.asset_id,p.close_price FROM assets a
    JOIN asset_prices p USING(asset_id) JOIN stock_price_detail d USING(asset_id,trade_date)
    WHERE a.asset_type='stock' AND a.is_active AND p.trade_date=$1 AND d.open_price>0
      AND p.close_price BETWEEN 1000 AND 100000 ORDER BY a.asset_id LIMIT 1`, [dates[0]]);
  await orders.submitOrder(sid,{assetId:asset.asset_id,tradeType:'buy',quantity:10});
  assert.equal((await getPerformance(sid)).summary.playerReturn,0); // pending, not bought
  async function settle(turn) {
    return db.withTransaction(async client => {
      const { rows: [s] } = await client.query('SELECT * FROM game_sessions WHERE id=$1 FOR UPDATE',[sid]);
      s.current_turn=turn;
      const fills=await orders.settlePendingOrders(client,s,dates[turn-1],await calendar.isMarketOpen(dates[turn-1],client));
      await client.query('UPDATE game_sessions SET current_turn=$2,cash=$3 WHERE id=$1',[sid,turn,s.cash]);
      return fills;
    });
  }
  await settle(2); // weekday holiday
  const holiday = (await read(`/assets/sectors?sessionId=${sid}`)).body;
  assert.equal(holiday.marketOpen,false);
  assert.equal(holiday.asOfDate,dates[0]);
  assert.equal((await getPerformance(sid)).summary.playerReturn,0);
  const openTurn = dates.indexOf('2014-09-11')+1;
  const fills = await settle(openTurn);
  assert.equal(fills[0].status,'filled');
  const before = await getPerformance(sid);
  assert.equal(before.available,true);
  approx(before.summary.playerReturn,before.currentValue/50000000-1);
  const job = await require('../src/services/sideJobService').submitPlay(sid,'catch_waxon',0);
  const afterJob = await getPerformance(sid);
  approx(afterJob.summary.playerReturn,before.summary.playerReturn);
  approx(afterJob.summary.netAmount,before.summary.netAmount);
  assert.equal(afterJob.externalCash,job.cashReward);
  // An event can have been shown on an earlier day and be answered now.
  const { rows: [event] } = await db.query(`INSERT INTO event_log
    (session_id,turn_number,event_type,detail,resolved) VALUES($1,1,'loan_shark_call','{}',FALSE) RETURNING id`,[sid]);
  await require('../src/services/eventEngine').resolveEvent(sid,event.id,'pay',{amount:1000000});
  const paid=await getPerformance(sid);
  approx(paid.summary.playerReturn,before.summary.playerReturn);
  assert.equal(paid.timingEstimated,false);
  const { rows: [logged] } = await db.query('SELECT detail FROM event_log WHERE id=$1',[event.id]);
  assert.equal(logged.detail.appliedTurn,openTurn);
  assert.ok(logged.detail.appliedAt);
  const { rows: [index] } = await db.query(`SELECT
    (SELECT value FROM macro_daily WHERE indicator_code='kospi' AND trade_date<=$1 ORDER BY trade_date DESC LIMIT 1) AS first,
    (SELECT value FROM macro_daily WHERE indicator_code='kospi' AND trade_date<=$2 ORDER BY trade_date DESC LIMIT 1) AS last`,
  [dates[0],dates[openTurn-1]]);
  approx(paid.summary.benchmarks[0].returnRate,Number(index.last)/Number(index.first)-1);
  const response = await read(`/game/${sid}/portfolio/market-comparison`);
  assert.equal(response.status,200);
  assert.equal(response.body.available,true);
  approx(response.body.summary.playerReturn,paid.summary.playerReturn);
  assert.ok(response.body.points.every(p=>p.turn<=openTurn));
});
