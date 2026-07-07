// 주간/월간/최종 리포트 (ARCHITECTURE.md §11 / 기획서 §7 Weekly 평가서)
const { query } = require('../db');
const { notFound } = require('../utils/errors');
const C = require('../config/constants');
const valuationService = require('./valuationService');

/** 턴 진행 중 스냅샷 기록 (turnService 트랜잭션 안에서 호출) */
async function writeSnapshot(client, sessionId, turnNumber, type, { totalAsset, session, detail }) {
  await client.query(
    `INSERT INTO session_snapshots (session_id, turn_number, snapshot_type, total_asset, cash, debt, stress, trust, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (session_id, turn_number, snapshot_type) DO NOTHING`,
    [sessionId, turnNumber, type, totalAsset, Math.round(Number(session.cash)),
     Number(session.debt), session.stress, session.trust, detail ? JSON.stringify(detail) : null]
  );
}

/**
 * 주간 평가 (기획서: 매주 월요일 지난주 수익률 평가, LLM 사용 예정)
 * weekIndex: 1 ~ 48 (240턴 / 5턴)
 */
async function getWeeklyReport(sessionId, weekIndex) {
  const fromTurn = (weekIndex - 1) * C.TURNS_PER_WEEK + 1;
  const toTurn = weekIndex * C.TURNS_PER_WEEK;
  const { rows } = await query(
    `SELECT turn_number, total_asset, cash, debt, stress, trust
     FROM session_snapshots
     WHERE session_id = $1 AND snapshot_type = 'daily' AND turn_number BETWEEN $2 AND $3
     ORDER BY turn_number`,
    [sessionId, fromTurn, toTurn]
  );
  if (rows.length === 0) throw notFound('해당 주차 기록이 없습니다');
  const first = rows[0];
  const last = rows[rows.length - 1];
  const weekReturn =
    Number(first.total_asset) > 0
      ? (Number(last.total_asset) - Number(first.total_asset)) / Number(first.total_asset)
      : 0;

  return {
    weekIndex,
    fromTurn,
    toTurn,
    startAsset: Number(first.total_asset),
    endAsset: Number(last.total_asset),
    weekReturn,
    // TODO(gamelogic): LLM 기반 투자성향/포트폴리오 평가문 생성 (기획서 §7 Weekly 평가서, §10 Argument)
    // 연동 지점: 이 자리에서 거래이력+수익률을 요약해 LLM 프롬프트로 전달 -> comment 채움
    comment: weekReturn >= 0 ? '지난주 수익이 발생했습니다.' : '지난주 손실이 발생했습니다.',
  };
}

/** 월간 리포트 (20턴 정산 화면) */
async function getMonthlyReport(sessionId, monthIndex) {
  const fromTurn = (monthIndex - 1) * C.TURNS_PER_MONTH + 1;
  const toTurn = monthIndex * C.TURNS_PER_MONTH;

  const [snapshots, trades, repayment, events] = await Promise.all([
    query(
      `SELECT turn_number, total_asset, cash, debt, stress, trust
       FROM session_snapshots
       WHERE session_id = $1 AND snapshot_type = 'daily' AND turn_number BETWEEN $2 AND $3
       ORDER BY turn_number`,
      [sessionId, fromTurn, toTurn]
    ),
    query(
      `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(realized_pnl),0) AS pnl
       FROM trades WHERE session_id = $1 AND turn_number BETWEEN $2 AND $3`,
      [sessionId, fromTurn, toTurn]
    ),
    query(
      `SELECT * FROM repayments WHERE session_id = $1 AND month_index = $2`,
      [sessionId, monthIndex]
    ),
    query(
      `SELECT event_type, COUNT(*)::int AS cnt
       FROM event_log WHERE session_id = $1 AND turn_number BETWEEN $2 AND $3
       GROUP BY event_type`,
      [sessionId, fromTurn, toTurn]
    ),
  ]);

  const snaps = snapshots.rows;
  const first = snaps[0];
  const last = snaps[snaps.length - 1];

  return {
    monthIndex,
    fromTurn,
    toTurn,
    startAsset: first ? Number(first.total_asset) : null,
    endAsset: last ? Number(last.total_asset) : null,
    monthReturn:
      first && Number(first.total_asset) > 0
        ? (Number(last.total_asset) - Number(first.total_asset)) / Number(first.total_asset)
        : null,
    tradeCount: trades.rows[0].cnt,
    realizedPnl: Number(trades.rows[0].pnl),
    repayment: repayment.rows[0] || null,
    events: events.rows,
  };
}

/** 최종 리포트 (엔딩) — 결산 + 월별 추이 */
async function getFinalReport(sessionId) {
  const { rows: sRows } = await query(`SELECT * FROM game_sessions WHERE id = $1`, [sessionId]);
  if (!sRows[0]) throw notFound('세션을 찾을 수 없습니다');
  const session = sRows[0];
  const totalAsset = await valuationService.computeTotalAsset(sessionId);

  const { rows: monthly } = await query(
    `SELECT turn_number, total_asset, debt, stress, trust
     FROM session_snapshots
     WHERE session_id = $1 AND snapshot_type = 'daily' AND turn_number % $2 = 0
     ORDER BY turn_number`,
    [sessionId, C.TURNS_PER_MONTH]
  );
  const { rows: repayments } = await query(
    `SELECT month_index, due_amount, paid_amount, ratio FROM repayments
     WHERE session_id = $1 ORDER BY month_index`,
    [sessionId]
  );

  return {
    status: session.status,
    difficulty: session.difficulty,
    turnsPlayed: session.current_turn,
    initialCash: Number(session.initial_cash),
    debtInitial: Number(session.debt_initial),
    debtRemaining: Number(session.debt),
    finalTotalAsset: totalAsset,
    totalReturn:
      Number(session.initial_cash) > 0
        ? (totalAsset - Number(session.initial_cash)) / Number(session.initial_cash)
        : 0,
    monthlyTrend: monthly,
    repayments,
    // TODO(gamelogic): LLM 투자성향 분석 리포트 (기획서 §10 Argument) 연동 지점
    aiAnalysis: null,
  };
}

module.exports = { writeSnapshot, getWeeklyReport, getMonthlyReport, getFinalReport };
