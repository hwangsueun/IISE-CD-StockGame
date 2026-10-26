const test = require('node:test');
const assert = require('node:assert/strict');

test('investment stress excludes account cash flows and preserves actual market losses', {
  skip: process.env.INVESTMENT_STRESS_INTEGRATION !== '1', timeout: 120000,
}, async t => {
  require('dotenv').config();
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/antsurvival_challenge_20261019');
  const db = require('../src/db');
  const turns = require('../src/services/turnService');
  const repayments = require('../src/services/repaymentService');
  const jobs = require('../src/services/sideJobService');
  const events = require('../src/services/eventEngine');
  const games = require('../src/services/gameService');
  const calendars = require('../src/services/turnSelector');
  const ids = [];
  const random = Math.random;
  // Only this test process: exclude unrelated random events from the stress assertion.
  Math.random = () => 0.99999;
  t.after(async () => {
    Math.random = random;
    for (const id of ids) await db.query('DELETE FROM game_sessions WHERE id=$1', [id]);
    await db.pool.end();
  });

  async function create({ turn = 2, cash = 50000000, stress = 0, start = '2020-01-06' } = {}) {
    const dates = calendars.buildWeekdayCalendar(start, '2021-06-30').slice(0, 240);
    const { rows: [session] } = await db.query(`INSERT INTO game_sessions
      (difficulty,start_date,current_turn,initial_cash,cash,debt_initial,debt,monthly_living_cost,stress,trust)
      VALUES('normal',$1,$2,$3,$3,100000000,100000000,800000,$4,100) RETURNING *`,
    [start, turn, cash, stress]);
    ids.push(session.id);
    await calendars.createGameTurns(db, session.id, dates);
    // The snapshot deliberately precedes the player's current-turn cash movements.
    await db.query(`INSERT INTO session_snapshots
      (session_id,turn_number,snapshot_type,total_asset,cash,debt,stress,trust)
      VALUES($1,$2,'daily',$3,$3,100000000,$4,100)`, [session.id, turn, cash, stress]);
    return { ...session, dates };
  }

  for (const stress of [0, 95]) {
    const s = await create({ turn: 20, stress });
    const paid = await repayments.repay(s.id, 8333334);
    assert.equal(paid.stressDelta, 0);
    const next = await turns.advanceTurn(s.id);
    assert.equal(next.dailyReturn, 0, 'repayment and salary are not investment returns');
    assert.equal(next.state.stress, stress);
    assert.equal(next.state.cash, 43866666);
    assert.equal(next.actionLocked, false);
    assert.ok(!next.events.some(e => e.eventType === 'faint'));
  }

  const salary = await create({ turn: 20, cash: 1000000, stress: 50 });
  await repayments.repay(salary.id, 0);
  const salaryStress = (await games.getSessionState(salary.id)).stress;
  const salaryNext = await turns.advanceTurn(salary.id);
  assert.equal(salaryNext.dailyReturn, 0, 'salary must not count as a profitable investment');
  assert.equal(salaryNext.state.stress, salaryStress);

  const job = await create({ cash: 300000, stress: 50 });
  const pay = await jobs.submitPlay(job.id, 'catch_waxon', 0);
  assert.ok(pay.cashReward / 300000 > 0.05);
  const afterJob = await turns.advanceTurn(job.id);
  assert.equal(afterJob.dailyReturn, 0);
  assert.equal(afterJob.state.stress, pay.stress, 'job stress is not offset by a fake investment gain');

  const trip = await create({ cash: 1000000, stress: 50 });
  const { rows: [invitation] } = await db.query(`INSERT INTO event_log
    (session_id,turn_number,event_type,detail,resolved) VALUES($1,2,'travel','{}',FALSE) RETURNING id`, [trip.id]);
  await events.resolveEvent(trip.id, invitation.id, 'go');
  const afterTrip = await games.getSessionState(trip.id);
  assert.ok(afterTrip.cash < 950000);
  const tripNext = await turns.advanceTurn(trip.id);
  assert.equal(tripNext.dailyReturn, 0);
  assert.equal(tripNext.state.stress, afterTrip.stress, 'travel cost must not add investment-loss stress');

  const empty = await create({ turn: 20, cash: 8333334 });
  await repayments.repay(empty.id, 8333334);
  const funded = await turns.advanceTurn(empty.id);
  assert.equal(funded.dailyReturn, 0);
  assert.equal(funded.state.stress, 0);
  assert.equal(funded.state.cash, 2200000);

  // Actual held-stock losses still reach both existing stress bands.
  for (const [minimum, maximum, delta, turn] of [[-0.14, -0.06, 5, 4], [-0.30, -0.16, 12, 8]]) {
    const s = await create({ turn, cash: 0, stress: 20, start: '2020-03-09' });
    const { rows: [stock] } = await db.query(`SELECT p.asset_id,p.close_price AS before,q.close_price AS after
      FROM asset_prices p JOIN asset_prices q ON q.asset_id=p.asset_id JOIN assets a ON a.asset_id=p.asset_id
      WHERE p.trade_date=$1 AND q.trade_date=$2 AND a.asset_type='stock'
        AND (a.listed_to IS NULL OR a.listed_to >= $2) AND p.close_price>0 AND q.close_price>0
        AND q.close_price/p.close_price-1 BETWEEN $3 AND $4
      ORDER BY p.asset_id LIMIT 1`, [s.dates[turn - 1], s.dates[turn], minimum, maximum]);
    assert.ok(stock, 'real daily price data must contain the target loss band');
    await db.query('INSERT INTO holdings(session_id,asset_id,quantity,avg_price) VALUES($1,$2,10,$3)',
      [s.id, stock.asset_id, stock.before]);
    const next = await turns.advanceTurn(s.id);
    assert.ok(Math.abs(next.dailyReturn - (Number(stock.after) / Number(stock.before) - 1)) < 1e-10);
    assert.equal(next.state.stress, 20 + delta);
  }
});
