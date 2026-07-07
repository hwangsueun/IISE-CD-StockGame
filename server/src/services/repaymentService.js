// 월말 상환 (ARCHITECTURE.md §9 / 기획서 §7 월말 상환 플로우)
// 20, 40, ..., 240턴이 상환 턴. 상환 요구액 = debt_initial / 12 균등.
const { query, withTransaction } = require('../db');
const { badRequest, conflict } = require('../utils/errors');
const C = require('../config/constants');
const trustPolicy = require('./trustPolicy');
const gameService = require('./gameService');
const { clamp100 } = require('../utils/clamp');

/** 현재 턴이 상환 턴인지 */
function isRepaymentTurn(turnNumber) {
  return turnNumber % C.TURNS_PER_MONTH === 0;
}

/** 이번 달 인덱스 (1~12) */
function monthIndexOf(turnNumber) {
  return Math.ceil(turnNumber / C.TURNS_PER_MONTH);
}

/** 월 상환 요구액 */
function dueAmountOf(debtInitial) {
  return Math.ceil(Number(debtInitial) / C.REPAYMENT_MONTHS);
}

/**
 * 상환 실행. 상환 턴에만 허용, 월별 1회.
 * 비율에 따라 신뢰도/스트레스 변화 + 전액 상환 시 즉시 성공 종료.
 */
async function repay(sessionId, amount) {
  return withTransaction(async (client) => {
    const { rows: sRows } = await client.query(
      `SELECT * FROM game_sessions WHERE id = $1 FOR UPDATE`,
      [sessionId]
    );
    const session = sRows[0];
    if (!session) throw badRequest('세션을 찾을 수 없습니다');
    if (session.status !== 'active') throw conflict('종료된 게임입니다');
    if (!isRepaymentTurn(session.current_turn)) {
      throw conflict('상환 턴이 아닙니다 (20턴 주기 월말에만 가능)');
    }
    const monthIndex = monthIndexOf(session.current_turn);
    const { rows: dup } = await client.query(
      `SELECT 1 FROM repayments WHERE session_id = $1 AND month_index = $2`,
      [sessionId, monthIndex]
    );
    if (dup[0]) throw conflict('이번 달 상환은 이미 완료했습니다');

    const cash = Number(session.cash);
    if (amount > cash) throw conflict('현금이 부족합니다', { cash });
    const paid = Math.min(amount, Number(session.debt)); // 초과 상환 방지

    const due = dueAmountOf(session.debt_initial);
    const ratio = due > 0 ? paid / due : 1;
    const { trustDelta, stressDelta } = trustPolicy.repaymentEffect(ratio);

    const newDebt = Number(session.debt) - paid;
    const newTrust = clamp100(session.trust + trustDelta);
    const newStress = clamp100(session.stress + stressDelta);

    await client.query(
      `UPDATE game_sessions
       SET cash = cash - $2, debt = $3, trust = $4, stress = $5, updated_at = NOW()
       WHERE id = $1`,
      [sessionId, paid, newDebt, newTrust, newStress]
    );
    await client.query(
      `INSERT INTO repayments (session_id, month_index, due_amount, paid_amount, ratio, trust_delta, stress_delta)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [sessionId, monthIndex, due, paid, ratio, trustDelta, stressDelta]
    );
    await client.query(
      `INSERT INTO event_log (session_id, turn_number, event_type, detail, cash_delta, stress_delta, trust_delta, resolved)
       VALUES ($1, $2, 'repayment', $3, $4, $5, $6, TRUE)`,
      [sessionId, session.current_turn, JSON.stringify({ monthIndex, due, paid, ratio }), -paid, stressDelta, trustDelta]
    );

    // 전액 상환 -> 즉시 성공 종료
    const status = await gameService.evaluateEndCondition(client, {
      ...session,
      debt: newDebt,
      trust: newTrust,
    });

    return {
      monthIndex,
      dueAmount: due,
      paidAmount: paid,
      ratio,
      trustDelta,
      stressDelta,
      debtRemaining: newDebt,
      cash: cash - paid,
      status,
    };
  });
}

/**
 * 상환 턴(20의 배수)을 상환 기록 없이 지나친 경우 자동 미납(ratio 0) 처리.
 * 기절 등으로 월말을 경과해도 미납이 반드시 기록되게 한다 (미팅5 §E).
 * turnService.advanceTurn 트랜잭션 안에서 호출 — session 객체의 stress/trust를 갱신해 두면
 * advanceTurn의 최종 UPDATE가 저장한다.
 * @returns 미납 처리 시 요약, 해당 없으면 null
 */
async function recordMissedIfUnpaid(client, session) {
  const turn = session.current_turn;
  if (!isRepaymentTurn(turn)) return null;
  const monthIndex = monthIndexOf(turn);
  const { rows: dup } = await client.query(
    `SELECT 1 FROM repayments WHERE session_id = $1 AND month_index = $2`,
    [session.id, monthIndex]
  );
  if (dup[0]) return null;

  const due = dueAmountOf(session.debt_initial);
  const { trustDelta, stressDelta, label } = trustPolicy.repaymentEffect(0);
  session.trust = clamp100(session.trust + trustDelta);
  session.stress = clamp100(session.stress + stressDelta);

  await client.query(
    `INSERT INTO repayments (session_id, month_index, due_amount, paid_amount, ratio, trust_delta, stress_delta)
     VALUES ($1, $2, $3, 0, 0, $4, $5)`,
    [session.id, monthIndex, due, trustDelta, stressDelta]
  );
  await client.query(
    `INSERT INTO event_log (session_id, turn_number, event_type, detail, cash_delta, stress_delta, trust_delta, resolved)
     VALUES ($1, $2, 'repayment', $3, 0, $4, $5, TRUE)`,
    [session.id, turn,
     JSON.stringify({ monthIndex, due, paid: 0, ratio: 0, auto: true, label }),
     stressDelta, trustDelta]
  );
  return { monthIndex, dueAmount: due, paidAmount: 0, ratio: 0, trustDelta, stressDelta, auto: true };
}

async function getHistory(sessionId) {
  const { rows } = await query(
    `SELECT month_index, due_amount, paid_amount, ratio, trust_delta, stress_delta, created_at
     FROM repayments WHERE session_id = $1 ORDER BY month_index`,
    [sessionId]
  );
  return rows;
}

module.exports = { isRepaymentTurn, monthIndexOf, dueAmountOf, repay, recordMissedIfUnpaid, getHistory };
