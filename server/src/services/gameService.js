// 세션 생명주기: 생성, 상태 조회, 승패 판정, 결산 (ARCHITECTURE.md §1, §9)
const { query, withTransaction } = require('../db');
const { notFound, badRequest } = require('../utils/errors');
const C = require('../config/constants');
const turnSelector = require('./turnSelector');
const valuationService = require('./valuationService');

/** 세션 로우 조회 (없으면 404) */
async function getSession(sessionId, client) {
  const q = client || { query };
  const { rows } = await q.query(`SELECT * FROM game_sessions WHERE id = $1`, [sessionId]);
  if (!rows[0]) throw notFound('세션을 찾을 수 없습니다');
  return rows[0];
}

/** 난이도 선택 -> 세션 생성 -> 240턴 날짜 고정 */
async function startGame(difficulty) {
  const debt = C.DEBT_BY_DIFFICULTY[difficulty];
  const { startDate, dates } = await turnSelector.selectTurnDates();

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO game_sessions
         (difficulty, start_date, initial_cash, cash, debt_initial, debt,
          stress, trust, monthly_living_cost)
       VALUES ($1, $2, $3, $3, $4, $4, $5, $6, $7)
       RETURNING *`,
      [difficulty, startDate, C.INITIAL_CASH, debt, C.STRESS_INIT, C.TRUST_INIT, C.LIVING_COST_DEFAULT]
    );
    const session = rows[0];
    await turnSelector.createGameTurns(client, session.id, dates);
    return toStateDto(session, Number(session.cash)); // 시작 시 총자산 = 현금
  });
}

/** 현재 상태 DTO (총자산 평가 포함) */
async function getSessionState(sessionId) {
  const session = await getSession(sessionId);
  const totalAsset = await valuationService.computeTotalAsset(sessionId);
  return toStateDto(session, totalAsset);
}

/**
 * 승패 판정. next-turn / repay 후 호출된다.
 * - 성공: 부채 전액 상환 (debt <= 0)
 * - 실패: 240턴 종료 후 미상환, 또는 신뢰도 0
 * @returns {'active'|'success'|'failed'}
 */
async function evaluateEndCondition(client, session) {
  let status = 'active';
  if (Number(session.debt) <= 0) status = 'success';
  else if (session.trust <= C.TRUST_FAIL_THRESHOLD) status = 'failed';
  else if (session.current_turn >= C.TOTAL_TURNS) status = 'failed';

  if (status !== 'active') {
    await client.query(
      `UPDATE game_sessions SET status = $2, updated_at = NOW() WHERE id = $1`,
      [session.id, status]
    );
  }
  return status;
}

/** 최종 결산 (엔딩 화면) */
async function getResult(sessionId) {
  const session = await getSession(sessionId);
  if (session.status === 'active') throw badRequest('게임이 아직 진행 중입니다');
  const totalAsset = await valuationService.computeTotalAsset(sessionId);
  const { rows: tradeStats } = await query(
    `SELECT COUNT(*)::int AS trade_count,
            COALESCE(SUM(realized_pnl), 0)::numeric AS realized_pnl_sum
     FROM trades WHERE session_id = $1`,
    [sessionId]
  );
  return {
    sessionId,
    status: session.status,
    difficulty: session.difficulty,
    turnsPlayed: session.current_turn,
    initialCash: Number(session.initial_cash),
    debtInitial: Number(session.debt_initial),
    debtRemaining: Number(session.debt),
    finalCash: Number(session.cash),
    finalTotalAsset: totalAsset,
    stress: session.stress,
    trust: session.trust,
    tradeCount: tradeStats[0].trade_count,
    realizedPnlSum: Number(tradeStats[0].realized_pnl_sum),
  };
}

function toStateDto(session, totalAsset) {
  return {
    sessionId: session.id,
    status: session.status,
    difficulty: session.difficulty,
    startDate: session.start_date,
    currentTurn: session.current_turn,
    actionLockedUntilTurn: session.action_locked_until_turn,
    cash: Number(session.cash),
    totalAsset,
    debt: Number(session.debt),
    debtInitial: Number(session.debt_initial),
    stress: session.stress,
    trust: session.trust,
    monthlyLivingCost: Number(session.monthly_living_cost),
  };
}

module.exports = { getSession, startGame, getSessionState, evaluateEndCondition, getResult, toStateDto };
