const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Real PostgreSQL, isolated schema and synthetic prices. Never writes public game data.
// CHALLENGE_TEST_DATABASE_URL=postgresql://... npm test
test('monthly challenge persists, settles 12 periods and pays each prize exactly once', {
  skip: !process.env.CHALLENGE_TEST_DATABASE_URL,
}, async t => {
  const { Pool } = require('pg');
  const admin = new Pool({ connectionString: process.env.CHALLENGE_TEST_DATABASE_URL });
  const schema = `challenge_test_${randomUUID().replaceAll('-', '')}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'challenge-test-'));
  const savedUrl = process.env.DATABASE_URL, savedSignals = process.env.QUANT_SIGNALS_FILE;
  const random = Math.random;
  let db;
  t.after(async () => {
    Math.random = random;
    if (db) await db.pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (savedUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = savedUrl;
    if (savedSignals === undefined) delete process.env.QUANT_SIGNALS_FILE; else process.env.QUANT_SIGNALS_FILE = savedSignals;
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const url = new URL(process.env.CHALLENGE_TEST_DATABASE_URL);
  url.searchParams.set('options', `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.href;
  process.env.QUANT_SIGNALS_FILE = path.join(tmp, 'signals.json');
  db = require('../src/db');
  const client = await db.pool.connect();
  let legacyId;
  try {
    for (const file of fs.readdirSync(path.join(__dirname, '../migrations')).filter(f => f.endsWith('.sql')).sort()) {
      if (file === '012_monthly_challenge_capital.sql') {
        const { rows: [legacy] } = await client.query(`INSERT INTO game_sessions(cash,debt,debt_initial)
          VALUES(40000000,100000000,100000000) RETURNING id`);
        legacyId = legacy.id;
        await client.query(`INSERT INTO quant_challenges(session_id,joined_turn,first_month,prize_base,reference_asset)
          VALUES($1,1,1,50000000,40000000)`, [legacyId]);
        await client.query(`INSERT INTO quant_challenge_rounds
          (session_id,month_index,end_turn,player_return,quant_return,excess_return,outcome,prize,claimed_at)
          VALUES($1,1,20,.05,0,.05,'win',2500000,NOW())`, [legacyId]);
      }
      await client.query(fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8'));
    }
    // The additive migration is safe to reapply.
    await client.query(fs.readFileSync(path.join(__dirname, '../migrations/011_quant_challenge.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, '../migrations/012_monthly_challenge_capital.sql'), 'utf8'));
  } finally { client.release(); }
  const { buildWeekdayCalendar } = require('../src/services/turnSelector');
  const dates = buildWeekdayCalendar('2020-01-02', '2021-01-01').slice(0, 240);
  const closes = dates.map((_, i) => 100 - Math.min(i, 19) * .5);
  const artifact = { schema_version: 3, model_version: 'synthetic-test-only', strategy: 'topk_dropout',
    execution: 'next_market_open', label_price: 'open', rebalance_turns: 1, n_drop: 1, top_k: 1,
    label_horizon: { unit: 'market_sessions', value: 1 },
    models: [{ id: 'm', available_from: '2019-01-01', trained_through: '2018-12-31' }],
    sessions: Object.fromEntries(dates.map((date, i) => [date, {
      signal_date: date, model_id: 'm', ranking: [['CH_A', 2, closes[i]], ['CH_B', 1, 100]],
    }])) };
  fs.writeFileSync(process.env.QUANT_SIGNALS_FILE, JSON.stringify(artifact));
  await db.query(`INSERT INTO assets (asset_id, asset_type, name, masked_name)
    VALUES ('CH_A','stock','fixture A','경쟁종목'),('CH_B','stock','fixture B','보유종목')`);
  for (let i = 0; i < dates.length; i++) {
    await db.query(`INSERT INTO asset_prices (asset_id,trade_date,close_price) VALUES
      ('CH_A',$1,$2),('CH_B',$1,100)`, [dates[i], closes[i]]);
    await db.query(`INSERT INTO stock_price_detail (asset_id,trade_date,close_price,open_price) VALUES
      ('CH_A',$1,$2,$3),('CH_B',$1,100,100)`, [dates[i], closes[i], i <= 1 ? 100 : closes[i]]);
  }
  const challenge = require('../src/services/challengeService');
  const quant = require('../src/services/quantService');
  const turns = require('../src/services/turnService');
  const game = require('../src/services/gameService');
  const repay = require('../src/services/repaymentService');
  const events = require('../src/services/eventEngine');
  const sideJob = require('../src/services/sideJobService');
  const order = require('../src/services/orderService');
  async function makeSession(turn = 1, initialCash = 50_000_000) {
    const { rows: [s] } = await db.query(`INSERT INTO game_sessions
      (difficulty,start_date,cash,initial_cash,debt,debt_initial,current_turn,monthly_living_cost)
      VALUES ('normal',$1,$3,$3,100000000,100000000,$2,800000) RETURNING *`, [dates[0], turn, initialCash]);
    await db.query(`INSERT INTO game_turns (session_id,turn_number,trade_date)
      SELECT $1, ordinal::int, date::date FROM unnest($2::text[]) WITH ORDINALITY AS x(date,ordinal)`, [s.id, dates]);
    await db.query(`INSERT INTO session_snapshots
      (session_id,turn_number,snapshot_type,total_asset,cash,debt,stress,trust)
      VALUES ($1,1,'daily',$2,$2,100000000,0,100)`, [s.id, initialCash]);
    return s.id;
  }
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
  // Disable stochastic events for reproducibility; calendar/faint effects still execute.
  Math.random = () => .99999;
  const legacyRound = (await challenge.overview(legacyId)).rounds[0];
  assert.equal(legacyRound.prizeBase, 50_000_000);
  assert.equal(legacyRound.prize, 2_500_000);
  assert.equal(legacyRound.claimed, true);
  const sid = await makeSession();
  const joins = await Promise.all([challenge.enroll(sid), challenge.enroll(sid)]);
  assert.ok(joins.every(r => r.enrolled && r.firstMonth === 1));
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM quant_challenges WHERE session_id=$1', [sid])).rows[0].n, 1);
  await assert.rejects(challenge.claim(sid, 1), /수령 가능한/);
  await assert.rejects(challenge.claim(sid, '1'), /올바른/);
  await sideJob.submitPlay(sid, 'catch_waxon', 0);
  close((await quant.getQuantPortfolio(sid)).challenge.current.playerReturn, 0);
  // A choice event repayment must also be neutral.
  const { rows: [event] } = await db.query(`INSERT INTO event_log
    (session_id,turn_number,event_type,detail,resolved) VALUES ($1,1,'loan_shark_call','{}',FALSE) RETURNING id`, [sid]);
  await events.resolveEvent(sid, event.id, 'pay', { amount: 100000 });
  close((await quant.getQuantPortfolio(sid)).challenge.current.playerReturn, 0);
  for (let i = 2; i <= 20; i++) {
    if (i === 6) await db.query('UPDATE game_sessions SET stress=100 WHERE id=$1', [sid]);
    const result = await turns.advanceTurn(sid);
    assert.equal(result.turnNumber, i);
    if (i === 6) assert.ok(result.events.some(e => e.eventType === 'faint'));
    if (i === 19) assert.equal((await challenge.overview(sid)).rounds.length, 0);
  }
  let state = await quant.getQuantPortfolio(sid);
  const first = state.challenge.rounds[0];
  close(first.playerReturn, 0);
  close(first.quantReturn, -.095);
  assert.equal(first.prizeBase, 49_960_000); // day-one side job and repayment, before market movement
  assert.equal(first.prize, 4_746_200);
  assert.equal(state.challenge.prizeBase, first.prizeBase); // show this month's frozen base, not next month's
  assert.equal((await turns.getTurnData(sid, 20)).challenge.unclaimedPrize, first.prize);
  const cashBefore = (await game.getSessionState(sid)).cash;
  const claims = await Promise.all([challenge.claim(sid, 1), challenge.claim(sid, 1), challenge.claim(sid, 1)]);
  assert.equal(claims.filter(r => !r.replayed).length, 1);
  assert.equal((await game.getSessionState(sid)).cash, cashBefore + first.prize);
  // Frozen month-end scores cannot change after a prize, side job or repayment.
  await repay.repay(sid, 100000);
  assert.deepEqual((await challenge.overview(sid)).rounds[0], { ...first, claimed: true });
  const monthTwoAssets = (await game.getSessionState(sid)).totalAsset;
  await turns.advanceTurn(sid); // month-start salary minus living expenses
  const monthTwo = (await quant.getQuantPortfolio(sid)).challenge;
  close(monthTwo.current.playerReturn, 0);
  assert.equal(monthTwo.current.prizeBase, monthTwoAssets + 2_200_000);
  // Buy/sell conversion is internal investment cash, not an external deposit.
  await order.submitOrder(sid, { assetId: 'CH_B', tradeType: 'buy', quantity: 1000, orderKey: 'fixture-buy' });
  for (let i = 22; i <= 240; i++) {
    // Keep the debt-survival game active while exercising every real monthly boundary.
    await db.query('UPDATE game_sessions SET trust=100,stress=0 WHERE id=$1', [sid]);
    const result = await turns.advanceTurn(sid);
    assert.equal(result.turnNumber, i);
    assert.equal(result.status, 'active');
    if (i === 22) {
      await sideJob.submitPlay(sid, 'catch_waxon', 0);
      assert.equal((await quant.getQuantPortfolio(sid)).challenge.current.prizeBase, monthTwo.current.prizeBase);
    }
  }
  state = await quant.getQuantPortfolio(sid);
  assert.equal(state.challenge.rounds.length, 12);
  assert.equal(state.challenge.rounds[0].endTurn, 240);
  for (const r of state.challenge.rounds.filter(r => r.month > 1)) {
    close(r.playerReturn, 0); close(r.quantReturn, 0); assert.equal(r.prize, 0);
  }
  assert.equal(state.challenge.rounds.find(r => r.month === 2).prizeBase, monthTwo.current.prizeBase);
  assert.equal(state.challenge.totalClaimed, first.prize);
  await db.query(fs.readFileSync(path.join(__dirname, '../migrations/012_monthly_challenge_capital.sql'), 'utf8'));
  assert.deepEqual((await challenge.overview(sid)).rounds, state.challenge.rounds);
  // Boundary retry is harmless, even with a different supplied asset value.
  await db.withTransaction(async c => {
    const { rows: [s] } = await c.query('SELECT * FROM game_sessions WHERE id=$1 FOR UPDATE', [sid]);
    await challenge.settleMonth(c, s, 999_999_999, { totalAsset: 1, history: [] });
  });
  assert.deepEqual((await challenge.overview(sid)).rounds, state.challenge.rounds);
  assert.equal((await turns.advanceTurn(sid)).status, 'failed');
  assert.equal((await game.getResult(sid)).challenge.totalClaimed, first.prize);

  // A different game's starting capital must propagate through both comparison and award.
  const smaller = await makeSession(1, 30_000_000);
  assert.equal((await quant.getQuantPortfolio(smaller)).challenge.prizeBase, 30_000_000);
  await challenge.enroll(smaller);
  for (let i = 2; i <= 20; i++) await turns.advanceTurn(smaller);
  const smallerRound = (await challenge.overview(smaller)).rounds[0];
  assert.equal(smallerRound.prizeBase, 30_000_000);
  assert.equal(smallerRound.prize, 2_850_000);

  // Joining late cannot claim an already-observed month. The next month uses turn-20 NAV.
  const late = await makeSession(19);
  assert.equal((await challenge.enroll(late)).firstMonth, 2);
  assert.equal((await quant.getQuantPortfolio(late)).challenge.current.prizeBase, null);
  await turns.advanceTurn(late);
  assert.equal((await challenge.overview(late)).rounds.length, 0);
  await turns.advanceTurn(late);
  close((await quant.getQuantPortfolio(late)).challenge.current.playerReturn, 0);
  await assert.rejects(challenge.enroll(await makeSession(221)), /다음 달/);

  // The final month's prize can be collected and used for full repayment on turn 240.
  await db.query(`INSERT INTO assets (asset_id,asset_type,name,masked_name) VALUES ('CH_C','stock','fixture C','마지막달 종목')`);
  for (let i = 219; i < 240; i++) {
    await db.query(`INSERT INTO asset_prices (asset_id,trade_date,close_price) VALUES ('CH_C',$1,$2)`,
      [dates[i], i === 239 ? 110 : 100]);
  }
  const finalMonth = await makeSession(220);
  await db.query('UPDATE game_sessions SET cash=0 WHERE id=$1', [finalMonth]);
  await db.query(`INSERT INTO holdings(session_id,asset_id,quantity,avg_price) VALUES ($1,'CH_C',500000,100)`, [finalMonth]);
  await challenge.enroll(finalMonth);
  for (let i = 221; i <= 240; i++) await turns.advanceTurn(finalMonth);
  const finalRound = (await challenge.overview(finalMonth)).rounds[0];
  assert.equal(finalRound.endTurn, 240);
  assert.equal(finalRound.prizeBase, 52_200_000); // holdings are capital too; only 2.2m is cash
  assert.ok(finalRound.prize > 0);
  const beforeFinalClaim = await game.getSessionState(finalMonth);
  await db.query('UPDATE game_sessions SET debt=$2 WHERE id=$1', [finalMonth, beforeFinalClaim.cash + finalRound.prize]);
  const finalClaim = await challenge.claim(finalMonth, 12);
  assert.equal(finalClaim.cash, beforeFinalClaim.cash + finalRound.prize);
  assert.equal((await repay.repay(finalMonth, finalClaim.cash)).status, 'success');

  // Missing model data must neither award a win nor prevent the turn from advancing.
  const missing = await makeSession();
  await challenge.enroll(missing);
  await db.query('UPDATE game_sessions SET current_turn=19 WHERE id=$1', [missing]);
  fs.renameSync(process.env.QUANT_SIGNALS_FILE, `${process.env.QUANT_SIGNALS_FILE}.saved`);
  await turns.advanceTurn(missing);
  const unavailable = (await challenge.overview(missing)).rounds[0];
  assert.equal(unavailable.outcome, 'unavailable');
  assert.equal(unavailable.prize, 0);
  assert.equal(unavailable.reason, 'model_unavailable');
});
