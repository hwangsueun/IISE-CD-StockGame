// 세션 생명주기: 생성, 상태 조회, 승패 판정, 결산 (ARCHITECTURE.md §1, §9)
const { query, withTransaction } = require('../db');
const { notFound, badRequest } = require('../utils/errors');
const C = require('../config/constants');
const turnSelector = require('./turnSelector');
const coinUniverseService = require('./coinUniverseService');
const valuationService = require('./valuationService');

/** 세션 로우 조회 (없으면 404) */
async function getSession(sessionId, client) {
  const q = client || { query };
  const { rows } = await q.query(`SELECT * FROM game_sessions WHERE id = $1`, [sessionId]);
  if (!rows[0]) throw notFound('세션을 찾을 수 없습니다');
  return rows[0];
}

/** 난이도 선택 -> 세션 생성 -> 240턴 날짜 고정. userId 있으면 계정 연결(이어하기) */
async function startGame(difficulty, userId = null) {
  const debt = C.DEBT_BY_DIFFICULTY[difficulty];
  const { startDate, dates } = await turnSelector.selectTurnDates();

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO game_sessions
         (difficulty, start_date, initial_cash, cash, debt_initial, debt,
          stress, trust, monthly_living_cost, user_id)
       VALUES ($1, $2, $3, $3, $4, $4, $5, $6, $7, $8)
       RETURNING *`,
      [difficulty, startDate, C.INITIAL_CASH, debt, C.STRESS_INIT, C.TRUST_INIT,
       C.LIVING_COST_DEFAULT, userId]
    );
    const session = rows[0];
    await turnSelector.createGameTurns(client, session.id, dates);
    // 코인 층화추출 (migration 005) — 240턴 날짜가 확정된 직후, 같은 트랜잭션 안에서 실행해야
    // 세션 생성과 원자적으로 묶인다(둘 중 하나만 커밋되는 상태 방지). dates[0]/dates[dates.length-1]
    // = 세션의 첫/마지막 거래일 (coinUniverseService의 전 기간 생존 조건 판단 기준).
    await coinUniverseService.selectForSession(client, session.id, dates[0], dates[dates.length - 1]);
    return toStateDto(session, Number(session.cash)); // 시작 시 총자산 = 현금
  });
}

/** 거래/상환/이벤트 통합 타임라인 (기능명세서 §기록 게임 로그) */
async function getGameLog(sessionId, limit = 200) {
  const { rows } = await query(
    `SELECT * FROM (
       SELECT 'trade' AS log_type, turn_number, created_at,
              json_build_object('assetId', asset_id, 'tradeType', trade_type,
                                'quantity', quantity, 'price', price,
                                'amount', amount, 'realizedPnl', realized_pnl) AS detail
       FROM trades WHERE session_id = $1
       UNION ALL
       SELECT 'repayment', month_index * 20, created_at,
              json_build_object('monthIndex', month_index, 'due', due_amount,
                                'paid', paid_amount, 'ratio', ratio)
       FROM repayments WHERE session_id = $1
       UNION ALL
       SELECT 'event', turn_number, created_at,
              json_build_object('eventType', event_type, 'detail', detail,
                                'cashDelta', cash_delta, 'stressDelta', stress_delta,
                                'trustDelta', trust_delta)
       FROM event_log WHERE session_id = $1
     ) logs
     ORDER BY turn_number, created_at
     LIMIT $2`,
    [sessionId, limit]
  );
  return rows;
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
 * turnLimitReached: 240턴을 "마친 뒤"의 최종 판정에서만 true.
 * 240턴에 도착한 시점은 마지막 거래일이 아직 남아 있으므로(12개월차 상환 가능)
 * 턴 초과 실패를 적용하지 않는다.
 * @returns {'active'|'success'|'failed'}
 */
async function evaluateEndCondition(client, session, { turnLimitReached = false } = {}) {
  let status = 'active';
  if (Number(session.debt) <= 0) status = 'success';
  else if (session.trust <= C.TRUST_FAIL_THRESHOLD) status = 'failed';
  else if (turnLimitReached) status = 'failed';

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

module.exports = { getSession, startGame, getSessionState, evaluateEndCondition, getResult, toStateDto, getGameLog };
