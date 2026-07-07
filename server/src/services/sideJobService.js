// 부업 미니게임 (미팅5 §6, 기능명세서 §부업)
// 규칙: 하루 1회 / 입원(행동제한) 중 불가 / 부업한 날은 투자 불가 (중간보고서 §4.5)
// 점수는 클라이언트가 보내지만 등급/보상 계산은 서버 권위.
const { query, withTransaction } = require('../db');
const { badRequest, conflict, notFound } = require('../utils/errors');
const C = require('../config/constants');
const { clamp100 } = require('../utils/clamp');

const GAME_KEYS = Object.keys(C.SIDE_JOB.SCORE_CUTS); // avoid_professor | catch_waxon | passenger_tetris

/** 원점수 -> 등급 (게임별 컷) */
function gradeOf(gameKey, rawScore) {
  const cuts = C.SIDE_JOB.SCORE_CUTS[gameKey];
  for (const cut of cuts) {
    if (rawScore >= cut.min) return cut.grade;
  }
  return 'great_fail';
}

/** 오늘 부업 가능 여부 (부업 메뉴 진입 시 표시) */
async function getStatus(sessionId) {
  const { rows } = await query(
    `SELECT current_turn, action_locked_until_turn, side_job_turn, status
     FROM game_sessions WHERE id = $1`,
    [sessionId]
  );
  const s = rows[0];
  if (!s) throw notFound('세션을 찾을 수 없습니다');
  const locked = s.current_turn <= s.action_locked_until_turn;
  const doneToday = s.side_job_turn === s.current_turn;
  return {
    games: GAME_KEYS,
    basePay: C.SIDE_JOB.BASE_PAY,
    grades: C.SIDE_JOB.GRADES,
    available: s.status === 'active' && !locked && !doneToday,
    reason: locked ? 'hospitalized' : doneToday ? 'already_done' : null,
  };
}

/**
 * 부업 결과 제출: 등급 판정 -> 현금/스트레스 반영 -> 당일 투자 잠금.
 * 잘할수록 돈은 많이 벌고, 스트레스는 적게 오른다.
 */
async function submitPlay(sessionId, gameKey, rawScore) {
  if (!GAME_KEYS.includes(gameKey)) throw badRequest(`gameKey는 ${GAME_KEYS.join('|')} 중 하나입니다`);
  if (!(Number(rawScore) >= 0)) throw badRequest('rawScore(>=0)가 필요합니다');

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM game_sessions WHERE id = $1 FOR UPDATE`, [sessionId]
    );
    const session = rows[0];
    if (!session) throw notFound('세션을 찾을 수 없습니다');
    if (session.status !== 'active') throw conflict('종료된 게임입니다');
    if (session.current_turn <= session.action_locked_until_turn) {
      throw conflict('입원 중에는 부업을 할 수 없습니다');
    }
    if (session.side_job_turn === session.current_turn) {
      throw conflict('부업은 하루 1회만 가능합니다');
    }

    const grade = gradeOf(gameKey, Number(rawScore));
    const { payRate, stressDelta } = C.SIDE_JOB.GRADES[grade];
    const cashReward = Math.round(C.SIDE_JOB.BASE_PAY * payRate);
    const newStress = clamp100(session.stress + stressDelta);

    await client.query(
      `UPDATE game_sessions
       SET cash = cash + $2, stress = $3, side_job_turn = $4, updated_at = NOW()
       WHERE id = $1`,
      [sessionId, cashReward, newStress, session.current_turn]
    );
    await client.query(
      `INSERT INTO side_job_plays (session_id, turn_number, game_key, raw_score, grade, cash_reward, stress_delta)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [sessionId, session.current_turn, gameKey, rawScore, grade, cashReward, stressDelta]
    );
    await client.query(
      `INSERT INTO event_log (session_id, turn_number, event_type, detail, cash_delta, stress_delta, resolved)
       VALUES ($1, $2, 'side_job', $3, $4, $5, TRUE)`,
      [sessionId, session.current_turn,
       JSON.stringify({ gameKey, rawScore, grade }), cashReward, stressDelta]
    );

    return {
      gameKey,
      rawScore: Number(rawScore),
      grade,
      cashReward,
      stressDelta,
      stress: newStress,
      cash: Number(session.cash) + cashReward,
      tradingLockedToday: true, // 부업한 날은 투자 불가
    };
  });
}

/** 부업 이력 */
async function getHistory(sessionId) {
  const { rows } = await query(
    `SELECT turn_number, game_key, raw_score, grade, cash_reward, stress_delta, created_at
     FROM side_job_plays WHERE session_id = $1 ORDER BY turn_number`,
    [sessionId]
  );
  return rows;
}

module.exports = { GAME_KEYS, gradeOf, getStatus, submitPlay, getHistory };
