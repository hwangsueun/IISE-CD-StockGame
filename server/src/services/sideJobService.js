// 부업 미니게임 (미팅5 §6, 기능명세서 §부업)
// 규칙: 하루 1회 / 입원(행동제한) 중 불가 / 부업한 날은 투자 불가 (중간보고서 §4.5)
// 직접 플레이 점수는 클라이언트가 보내지만 등급/보상 계산은 서버 권위.
// 자동 진행은 점수를 사용하지 않고 서버가 정한 고정 보상만 지급한다.
const { query, withTransaction } = require('../db');
const { badRequest, conflict, notFound } = require('../utils/errors');
const C = require('../config/constants');
const { clamp100 } = require('../utils/clamp');

const GAME_KEYS = Object.keys(C.SIDE_JOB.SCORE_CUTS); // avoid_professor | catch_waxon | sort_characters

function autoOptions() {
  return {
    cashReward: Math.round(C.SIDE_JOB.BASE_PAY * C.SIDE_JOB.AUTO.payRate),
    stressDelta: C.SIDE_JOB.AUTO.stressDelta,
    manualMinReward: Math.min(...Object.values(C.SIDE_JOB.GRADES)
      .map(({ payRate }) => Math.round(C.SIDE_JOB.BASE_PAY * payRate))),
  };
}

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
    `SELECT current_turn, action_locked_until_turn, side_job_turn, status, stress
     FROM game_sessions WHERE id = $1`,
    [sessionId]
  );
  const s = rows[0];
  if (!s) throw notFound('세션을 찾을 수 없습니다');
  const locked = s.current_turn <= s.action_locked_until_turn;
  const doneToday = s.side_job_turn === s.current_turn;
  const exhausted = Number(s.stress) >= C.STRESS_FAINT_THRESHOLD;
  return {
    games: GAME_KEYS,
    basePay: C.SIDE_JOB.BASE_PAY,
    grades: C.SIDE_JOB.GRADES,
    auto: autoOptions(),
    available: s.status === 'active' && !locked && !doneToday && !exhausted,
    reason: locked ? 'hospitalized' : exhausted ? 'stress_limit' : doneToday ? 'already_done' : null,
  };
}

/**
 * 부업 결과 제출: 등급 판정 -> 현금/스트레스 반영 -> 당일 투자 잠금.
 * 잘할수록 돈은 많이 벌고, 스트레스는 적게 오른다.
 */
async function submitPlay(sessionId, gameKey, rawScore, mode = 'manual') {
  if (!GAME_KEYS.includes(gameKey)) throw badRequest(`gameKey는 ${GAME_KEYS.join('|')} 중 하나입니다`);
  if (mode !== 'manual' && mode !== 'auto') throw badRequest('mode는 manual|auto 중 하나입니다');
  const automatic = mode === 'auto';
  let score = null;
  if (!automatic) {
    if (!['number', 'string'].includes(typeof rawScore) ||
      (typeof rawScore === 'string' && rawScore.trim() === '') ||
      !Number.isFinite(Number(rawScore)) || Number(rawScore) < 0) {
      throw badRequest('rawScore는 0 이상의 유한한 숫자여야 합니다');
    }
    score = Number(rawScore);
  }

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
    if (Number(session.stress) >= C.STRESS_FAINT_THRESHOLD) {
      throw conflict('스트레스가 한계에 도달해 부업을 할 수 없습니다');
    }
    if (session.side_job_turn === session.current_turn) {
      throw conflict('부업은 하루 1회만 가능합니다');
    }

    const grade = automatic ? 'auto' : gradeOf(gameKey, score);
    const reward = automatic ? autoOptions() : {
      cashReward: Math.round(C.SIDE_JOB.BASE_PAY * C.SIDE_JOB.GRADES[grade].payRate),
      stressDelta: C.SIDE_JOB.GRADES[grade].stressDelta,
    };
    const { cashReward, stressDelta } = reward;
    const newStress = clamp100(session.stress + stressDelta);

    await require('./challengeService').externalFlow(client, session, cashReward);
    await client.query(
      `UPDATE game_sessions
       SET cash = cash + $2, stress = $3, side_job_turn = $4, updated_at = NOW()
       WHERE id = $1`,
      [sessionId, cashReward, newStress, session.current_turn]
    );
    await client.query(
      `INSERT INTO side_job_plays (session_id, turn_number, game_key, raw_score, grade, cash_reward, stress_delta)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      // 기존 NOT NULL 점수와 5등급 CHECK를 유지한다. 자동 여부와 공개 점수는 event_log에 명시한다.
      [sessionId, session.current_turn, gameKey, automatic ? 0 : score,
       automatic ? 'great_fail' : grade, cashReward, stressDelta]
    );
    await client.query(
      `INSERT INTO event_log (session_id, turn_number, event_type, detail, cash_delta, stress_delta, resolved)
       VALUES ($1, $2, 'side_job', $3, $4, $5, TRUE)`,
      [sessionId, session.current_turn,
       JSON.stringify({ gameKey, mode, rawScore: score, grade }), cashReward, stressDelta]
    );
    session.side_job_turn = session.current_turn;
    session.stress = newStress;
    const restriction = await require('./investmentPolicy').enforce(client, session);

    return {
      gameKey,
      mode,
      rawScore: score,
      grade,
      cashReward,
      stressDelta,
      stress: newStress,
      cash: Number(session.cash) + cashReward,
      tradingLockedToday: true, // 부업한 날은 투자 불가
      investmentRestriction: restriction,
      cancelledOrderCount: restriction?.cancelledOrderCount || 0,
    };
  });
}

/** 부업 이력 */
async function getHistory(sessionId) {
  const { rows } = await query(
    `SELECT p.turn_number, p.game_key,
       CASE WHEN e.detail->>'mode' = 'auto' THEN NULL ELSE p.raw_score END AS raw_score,
       CASE WHEN e.detail->>'mode' = 'auto' THEN 'auto' ELSE p.grade END AS grade,
       CASE WHEN e.detail->>'mode' = 'auto' THEN 'auto' ELSE 'manual' END AS mode,
       p.cash_reward, p.stress_delta, p.created_at
     FROM side_job_plays p
     LEFT JOIN LATERAL (
       SELECT detail FROM event_log
       WHERE session_id = p.session_id AND turn_number = p.turn_number
         AND event_type = 'side_job' AND detail->>'gameKey' = p.game_key
       ORDER BY id DESC LIMIT 1
     ) e ON TRUE
     WHERE p.session_id = $1 ORDER BY p.turn_number`,
    [sessionId]
  );
  return rows;
}

module.exports = { GAME_KEYS, gradeOf, getStatus, submitPlay, getHistory };
