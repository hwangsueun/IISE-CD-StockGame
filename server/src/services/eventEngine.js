// 이벤트 엔진 (ARCHITECTURE.md §9-5 / 기획서 §8 Events)
// 모든 이벤트는 EVENT_DEFS에 등록하고, 발생/해결 결과를 event_log에 남긴다.
// - 강제(immediate) 이벤트: 발생 즉시 효과 적용, resolved=TRUE
// - 선택형(choice) 이벤트: pending으로 기록, 플레이어가 POST /event로 해결
const { query, withTransaction } = require('../db');
const { badRequest, conflict } = require('../utils/errors');
const C = require('../config/constants');
const stressPolicy = require('./stressPolicy');
const trustPolicy = require('./trustPolicy');
const { clamp100 } = require('../utils/clamp');

/**
 * 이벤트 정의 레지스트리.
 * kind: 'immediate' | 'choice'
 * trigger(ctx): 이 턴에 발생하는지 판단. ctx = { session, turnNumber, tradeDate, totalAsset }
 * apply(ctx): immediate 효과 { cashDelta, stressDelta, trustDelta, detail, lockDays? }
 * choices: 선택형 옵션 [{ key, label, effect(ctx) }]
 */
const EVENT_DEFS = {
  // 신뢰도가 낮을수록 확률 증가 -> 스트레스 상승
  loan_shark_call: {
    kind: 'immediate',
    trigger: ({ session }) =>
      Math.random() < trustPolicy.loanSharkCallProb(session.trust),
    apply: () => ({
      cashDelta: 0,
      stressDelta: C.LOAN_SHARK_CALL.stressDelta,
      trustDelta: 0,
      detail: { message: '사채업자의 독촉 전화가 걸려왔다.' },
    }),
  },

  // 스트레스 100: 기절 -> 3~7거래일 행동제한 + 스트레스 리셋 (기획서 §8)
  faint: {
    kind: 'immediate',
    trigger: ({ session }) => stressPolicy.shouldFaint(session.stress),
    apply: () => {
      const skipDays = stressPolicy.rollFaintSkipDays();
      return {
        cashDelta: 0,
        stressDelta: C.FAINT_RESET_STRESS - 100, // 리셋값으로
        trustDelta: 0,
        lockDays: skipDays,
        detail: { message: `극심한 스트레스로 기절했다. ${skipDays}거래일 동안 거래 불가.`, skipDays },
      };
    },
  },

  // 스트레스 80 초과: 병원행 (병원비 지출, 스트레스 완화) — 기획서 §8
  hospital: {
    kind: 'immediate',
    trigger: ({ session }) =>
      session.stress > C.HOSPITAL_STRESS_THRESHOLD &&
      session.stress < C.STRESS_FAINT_THRESHOLD &&
      Math.random() < 0.15,
    apply: () => ({
      cashDelta: -C.HOSPITAL_COST,
      stressDelta: C.HOSPITAL_STRESS_RELIEF,
      trustDelta: 0,
      detail: { message: '심각한 스트레스로 병원에 다녀왔다.', cost: C.HOSPITAL_COST },
    }),
  },

  // 스트레스 80 초과 구간: 급등주 소식 (기획서 §8 — 주식차트에 급등주 등장)
  surge_stock_tip: {
    kind: 'immediate',
    trigger: ({ session }) =>
      session.stress > C.HOSPITAL_STRESS_THRESHOLD && Math.random() < 0.1,
    // TODO(gamelogic): 다음 턴 상승률 상위 종목을 힌트로 노출할지, 랜덤 종목을 노출할지 확정
    apply: () => ({
      cashDelta: 0,
      stressDelta: 0,
      trustDelta: 0,
      detail: { message: '급등주 소문이 들려온다...', hintAssetId: null },
    }),
  },

  // 선택형 랜덤 이벤트: 여행 (현금 감소, 스트레스 감소)
  travel: {
    kind: 'choice',
    trigger: () => Math.random() < C.RANDOM_EVENT_PROB / 3,
    prompt: '친구가 주말 여행을 제안했다.',
    choices: [
      { key: 'go', label: '간다 (-100만원, 스트레스 -15)', effect: () => ({ cashDelta: -1_000_000, stressDelta: -15, trustDelta: 0 }) },
      { key: 'skip', label: '안 간다 (스트레스 +3)', effect: () => ({ cashDelta: 0, stressDelta: +3, trustDelta: 0 }) },
    ],
  },

  // 선택형 랜덤 이벤트: 결혼식 (축의금/스트레스)
  wedding: {
    kind: 'choice',
    trigger: () => Math.random() < C.RANDOM_EVENT_PROB / 3,
    prompt: '지인의 결혼식 청첩장이 도착했다.',
    choices: [
      { key: 'attend', label: '참석한다 (-10만원)', effect: () => ({ cashDelta: -100_000, stressDelta: -2, trustDelta: 0 }) },
      { key: 'skip', label: '불참한다 (스트레스 +2)', effect: () => ({ cashDelta: 0, stressDelta: +2, trustDelta: 0 }) },
    ],
  },

  // 선택형: 부업 (현금 확보 vs 스트레스 비용)
  side_job: {
    kind: 'choice',
    trigger: () => Math.random() < C.RANDOM_EVENT_PROB / 3,
    prompt: '주말 단기 알바 자리가 났다.',
    choices: [
      { key: 'work', label: '일한다 (+50만원, 스트레스 +10)', effect: () => ({ cashDelta: +500_000, stressDelta: +10, trustDelta: 0 }) },
      { key: 'rest', label: '쉰다', effect: () => ({ cashDelta: 0, stressDelta: 0, trustDelta: 0 }) },
    ],
  },

  // 명절 (공휴일/월별): TODO(gamelogic): 실제 명절 날짜 달력 기반 트리거로 교체
  holiday: {
    kind: 'immediate',
    trigger: ({ tradeDate }) => {
      const d = new Date(tradeDate);
      return (d.getMonth() === 1 || d.getMonth() === 8) && d.getDate() === 1; // 임시: 2월/9월 1일
    },
    apply: () => ({
      cashDelta: +300_000,
      stressDelta: -5,
      trustDelta: 0,
      detail: { message: '명절이다. 가족들에게 용돈을 받았다.' },
    }),
  },

  // 특수 시장 이벤트: 뉴스/거시 조건 기반 리스크 힌트
  // TODO(gamelogic): macro_daily 급변(예: 환율 ±2%, 금리 변경) 조건 트리거 구현
  market_special: {
    kind: 'immediate',
    trigger: () => false,
    apply: () => ({ cashDelta: 0, stressDelta: 0, trustDelta: 0, detail: {} }),
  },
};

/**
 * 턴 진행 시 이벤트 발생 판단 + 즉시 이벤트 효과 적용.
 * turnService.advanceTurn의 트랜잭션 안에서 호출된다.
 * 우선순위: faint > hospital > loan_shark_call > 랜덤/기타. 턴당 최대 EVENT_MAX_PER_TURN건.
 * @returns {Promise<Array>} 발생 이벤트 목록 (프론트 팝업용)
 */
async function rollTurnEvents(client, session, ctx) {
  const fired = [];
  const order = [
    'faint', 'hospital', 'loan_shark_call', 'holiday',
    'surge_stock_tip', 'travel', 'wedding', 'side_job', 'market_special',
  ];

  for (const type of order) {
    if (fired.length >= C.EVENT_MAX_PER_TURN) break;
    const def = EVENT_DEFS[type];
    if (!def.trigger({ session, ...ctx })) continue;

    if (def.kind === 'immediate') {
      const eff = def.apply({ session, ...ctx });
      const newStress = clamp100(session.stress + (eff.stressDelta || 0));
      const newTrust = clamp100(session.trust + (eff.trustDelta || 0));
      const lockUntil = eff.lockDays
        ? session.current_turn + eff.lockDays
        : session.action_locked_until_turn;

      await client.query(
        `UPDATE game_sessions
         SET cash = cash + $2, stress = $3, trust = $4, action_locked_until_turn = $5, updated_at = NOW()
         WHERE id = $1`,
        [session.id, eff.cashDelta || 0, newStress, newTrust, lockUntil]
      );
      await client.query(
        `INSERT INTO event_log (session_id, turn_number, event_type, detail, cash_delta, stress_delta, trust_delta, resolved)
         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)`,
        [session.id, session.current_turn, type, JSON.stringify(eff.detail || {}), eff.cashDelta || 0, eff.stressDelta || 0, eff.trustDelta || 0]
      );
      // 이후 트리거 판정이 갱신된 상태를 보도록 세션 객체 갱신
      session.stress = newStress;
      session.trust = newTrust;
      session.cash = Number(session.cash) + (eff.cashDelta || 0);
      session.action_locked_until_turn = lockUntil;
      fired.push({ eventType: type, kind: 'immediate', ...eff });
    } else {
      // 선택형: pending 기록만 남기고 효과는 resolveEvent에서
      const { rows } = await client.query(
        `INSERT INTO event_log (session_id, turn_number, event_type, detail, resolved)
         VALUES ($1, $2, $3, $4, FALSE) RETURNING id`,
        [session.id, session.current_turn, type, JSON.stringify({
          prompt: def.prompt,
          choices: def.choices.map((c) => ({ key: c.key, label: c.label })),
        })]
      );
      fired.push({
        eventLogId: rows[0].id,
        eventType: type,
        kind: 'choice',
        prompt: def.prompt,
        choices: def.choices.map((c) => ({ key: c.key, label: c.label })),
      });
    }
  }
  return fired;
}

/** 미해결 선택형 이벤트 */
async function getPendingEvents(sessionId) {
  const { rows } = await query(
    `SELECT id AS event_log_id, turn_number, event_type, detail
     FROM event_log WHERE session_id = $1 AND resolved = FALSE ORDER BY id`,
    [sessionId]
  );
  return rows;
}

/** 선택형 이벤트 해결 (POST /event) */
async function resolveEvent(sessionId, eventLogId, choiceKey) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT e.*, s.stress, s.trust, s.cash
       FROM event_log e JOIN game_sessions s ON s.id = e.session_id
       WHERE e.id = $1 AND e.session_id = $2 FOR UPDATE OF e, s`,
      [eventLogId, sessionId]
    );
    const log = rows[0];
    if (!log) throw badRequest('이벤트를 찾을 수 없습니다');
    if (log.resolved) throw conflict('이미 처리된 이벤트입니다');

    const def = EVENT_DEFS[log.event_type];
    const choice = def?.choices?.find((c) => c.key === choiceKey);
    if (!choice) throw badRequest(`유효하지 않은 선택입니다: ${choiceKey}`);

    const eff = choice.effect({});
    const newStress = clamp100(log.stress + (eff.stressDelta || 0));
    const newTrust = clamp100(log.trust + (eff.trustDelta || 0));

    await client.query(
      `UPDATE game_sessions SET cash = cash + $2, stress = $3, trust = $4, updated_at = NOW() WHERE id = $1`,
      [sessionId, eff.cashDelta || 0, newStress, newTrust]
    );
    await client.query(
      `UPDATE event_log
       SET resolved = TRUE, cash_delta = $2, stress_delta = $3, trust_delta = $4,
           detail = detail || $5
       WHERE id = $1`,
      [eventLogId, eff.cashDelta || 0, eff.stressDelta || 0, eff.trustDelta || 0,
       JSON.stringify({ chosen: choiceKey })]
    );
    return { eventLogId, chosen: choiceKey, ...eff, stress: newStress, trust: newTrust };
  });
}

async function getHistory(sessionId) {
  const { rows } = await query(
    `SELECT id, turn_number, event_type, detail, cash_delta, stress_delta, trust_delta, resolved, created_at
     FROM event_log WHERE session_id = $1 ORDER BY id`,
    [sessionId]
  );
  return rows;
}

module.exports = { EVENT_DEFS, rollTurnEvents, getPendingEvents, resolveEvent, getHistory };
