const { query, withTransaction } = require('../db');
const { badRequest, conflict, notFound } = require('../utils/errors');
const valuation = require('./valuationService');
const { investmentReturn, applyFlow, scoreRound, firstEligibleMonth } = require('./challengePerformance');

async function entry(client, sessionId) {
  const { rows } = await client.query('SELECT * FROM quant_challenges WHERE session_id = $1', [sessionId]);
  return rows[0];
}

// Call BEFORE changing external cash, under the existing session row lock.
// An explicit turn date is required: advanceTurn has not saved current_turn yet.
async function externalFlow(client, session, amount) {
  if (!session.quant_challenge_enabled || !amount) return;
  const challenge = await entry(client, session.id);
  if (!challenge || challenge.reference_asset === null) return;
  const { rows: [turn] } = await client.query(
    'SELECT trade_date FROM game_turns WHERE session_id = $1 AND turn_number = $2',
    [session.id, session.current_turn]);
  const before = await valuation.computeTotalAsset(session.id, client, {
    cash: session.cash, tradeDate: turn.trade_date,
  });
  const next = applyFlow(challenge, before, amount);
  await client.query(`UPDATE quant_challenges SET performance_factor = $2,
    reference_asset = $3, invalid_period = $4 WHERE session_id = $1`,
  [session.id, next.factor, next.reference, next.invalid]);
}

function quantReturnForMonth(history, month, initialCash, currentTotal) {
  const base = month === 1 ? initialCash : history?.find(p => p.turn === (month - 1) * 20)?.totalAsset;
  return base > 0 && Number.isFinite(currentTotal) ? currentTotal / base - 1 : null;
}

// The boundary is arrival at turns 20,40,...,240, after price/order/event processing.
// Final results are immutable; later actions and claims belong to the next period.
async function settleMonth(client, session, totalAsset, quantReplay) {
  const turn = session.current_turn;
  if (!session.quant_challenge_enabled || turn % 20 !== 0) return;
  const challenge = await entry(client, session.id);
  if (!challenge || challenge.last_boundary >= turn) return;
  const month = turn / 20;
  if (month >= challenge.first_month) {
    const playerReturn = investmentReturn(challenge, totalAsset);
    const quantReturn = quantReturnForMonth(quantReplay?.history, month,
      Number(session.initial_cash), quantReplay?.totalAsset);
    const score = scoreRound(playerReturn, quantReturn, Number(challenge.prize_base));
    const reason = playerReturn === null ? 'nonpositive_capital' : quantReturn === null ? 'model_unavailable' : null;
    await client.query(`INSERT INTO quant_challenge_rounds
      (session_id, month_index, end_turn, player_return, quant_return, excess_return, outcome, reason, prize)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (session_id, month_index) DO NOTHING`,
    [session.id, month, turn, playerReturn, quantReturn, score.excess, score.outcome, reason, score.prize]);
  }
  if (month >= challenge.first_month - 1) {
    await client.query(`UPDATE quant_challenges SET performance_factor = 1, reference_asset = $2,
      invalid_period = $3, last_boundary = $4 WHERE session_id = $1`,
    [session.id, totalAsset, totalAsset <= 0, turn]);
  }
}

function roundDto(row) {
  return { month: row.month_index, endTurn: row.end_turn, playerReturn: row.player_return,
    quantReturn: row.quant_return, excessReturn: row.excess_return, outcome: row.outcome,
    reason: row.reason, prize: Number(row.prize), claimed: Boolean(row.claimed_at) };
}

async function overview(sessionId, client = { query }) {
  const challenge = await entry(client, sessionId);
  if (!challenge) return { enrolled: false };
  const { rows } = await client.query(`SELECT * FROM quant_challenge_rounds
    WHERE session_id = $1 ORDER BY month_index DESC`, [sessionId]);
  const rounds = rows.map(roundDto);
  return { enrolled: true, joinedTurn: challenge.joined_turn, firstMonth: challenge.first_month,
    prizeBase: Number(challenge.prize_base), rounds,
    unclaimedPrize: rounds.filter(r => !r.claimed).reduce((sum, r) => sum + r.prize, 0),
    totalClaimed: rounds.filter(r => r.claimed).reduce((sum, r) => sum + r.prize, 0) };
}

async function getState(client, session, quantReplay, totalAsset) {
  const result = await overview(session.id, client);
  const firstMonth = firstEligibleMonth(session.current_turn);
  if (!result.enrolled) return { ...result, canJoin: session.status === 'active' && firstMonth <= 12,
    firstMonth, prizeBase: Number(session.initial_cash) };
  const challenge = await entry(client, session.id);
  const month = Math.ceil(session.current_turn / 20);
  const settled = result.rounds.find(r => r.month === month);
  const live = !settled && month >= challenge.first_month;
  const playerReturn = live ? investmentReturn(challenge, totalAsset) : null;
  const quantReturn = live ? quantReturnForMonth(quantReplay?.history, month,
    Number(session.initial_cash), quantReplay?.totalAsset) : null;
  return { ...result, canClaim: session.status === 'active', current: {
    month, endTurn: month * 20, state: settled ? 'settled' : live ? 'running' : 'waiting',
    playerReturn, quantReturn,
    estimatedPrize: live ? scoreRound(playerReturn, quantReturn, result.prizeBase).prize : 0,
  } };
}

async function enroll(sessionId) {
  return withTransaction(async client => {
    const { rows: [session] } = await client.query('SELECT * FROM game_sessions WHERE id = $1 FOR UPDATE', [sessionId]);
    if (!session) throw notFound('세션을 찾을 수 없습니다');
    if (await entry(client, sessionId)) return overview(sessionId, client);
    if (session.status !== 'active') throw conflict('종료된 게임입니다');
    const firstMonth = firstEligibleMonth(session.current_turn);
    if (firstMonth > 12) throw conflict('참가할 수 있는 다음 달이 남아 있지 않습니다');
    const quant = require('./quantService');
    const loaded = quant.loadArtifact();
    if (!loaded) throw conflict('퀀트 모델 준비 후 참가할 수 있습니다');
    await quant.replaySession(client, session, loaded); // verify the pinned opponent before enrollment
    const atBoundary = session.current_turn % 20 === 0;
    const reference = session.current_turn === 1 || atBoundary
      ? await valuation.computeTotalAsset(sessionId, client, { cash: session.cash }) : null;
    if (reference !== null && reference <= 0) throw conflict('투자 자산이 있어야 참가할 수 있습니다');
    await client.query(`INSERT INTO quant_challenges
      (session_id, joined_turn, first_month, prize_base, reference_asset, last_boundary)
      VALUES ($1,$2,$3,$4,$5,$6)`,
    [sessionId, session.current_turn, firstMonth, Number(session.initial_cash), reference, atBoundary ? session.current_turn : 0]);
    await client.query('UPDATE game_sessions SET quant_challenge_enabled = TRUE WHERE id = $1', [sessionId]);
    return overview(sessionId, client);
  });
}

async function claim(sessionId, month) {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw badRequest('올바른 월차가 필요합니다');
  return withTransaction(async client => {
    const { rows: [session] } = await client.query('SELECT * FROM game_sessions WHERE id = $1 FOR UPDATE', [sessionId]);
    if (!session) throw notFound('세션을 찾을 수 없습니다');
    const { rows: [round] } = await client.query(`SELECT * FROM quant_challenge_rounds
      WHERE session_id = $1 AND month_index = $2`, [sessionId, month]);
    if (!round || Number(round.prize) <= 0) throw conflict('수령 가능한 상금이 없습니다');
    if (round.claimed_at) return { prize: Number(round.prize), cash: Number(session.cash), replayed: true };
    if (session.status !== 'active') throw conflict('게임이 종료되어 상금을 수령할 수 없습니다');
    const prize = Number(round.prize);
    await externalFlow(client, session, prize);
    await client.query('UPDATE game_sessions SET cash = cash + $2, updated_at = NOW() WHERE id = $1', [sessionId, prize]);
    await client.query(`UPDATE quant_challenge_rounds SET claimed_at = NOW()
      WHERE session_id = $1 AND month_index = $2`, [sessionId, month]);
    await client.query(`INSERT INTO event_log (session_id, turn_number, event_type, detail, cash_delta, resolved)
      VALUES ($1,$2,'quant_challenge_prize',$3,$4,TRUE)`,
    [sessionId, session.current_turn, JSON.stringify({ month, excessReturn: round.excess_return, prize }), prize]);
    return { prize, cash: Number(session.cash) + prize, replayed: false };
  });
}

module.exports = { externalFlow, settleMonth, overview, getState, enroll, claim, quantReturnForMonth };
