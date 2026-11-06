// 이벤트 엔진 (미팅4·5 이벤트 분류 체계 / 기능명세서 §이벤트)
//
// 분류: A 플레이어 선택형(부업 - sideJobService가 별도 처리)
//       B 랜덤 기회형(투자 스터디)
//       C 상태 연동형(독촉 전화, 급등주)
//       D 외부 랜덤형(경조사, 명절)
//       E 강제 페널티형(기절·입원)
//
// kind: 'immediate' = 발생 즉시 효과 적용(resolved=TRUE)
//       'choice'    = 선택 대기(resolved=FALSE) -> POST /event { eventLogId, choice, payload? }
const { query, withTransaction } = require('../db');
const { badRequest, conflict } = require('../utils/errors');
const C = require('../config/constants');
const stressPolicy = require('./stressPolicy');
const trustPolicy = require('./trustPolicy');
const surgeStockService = require('./surgeStockService');
const gameService = require('./gameService');
const valuationService = require('./valuationService');
const reportService = require('./reportService');
const { selectStudyKnowledge } = require('../education/investmentStudyKnowledge');
const { clamp100 } = require('../utils/clamp');

const rand = (min, max) => min + Math.random() * (max - min);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
// DATE 컬럼은 db.js 파서가 'YYYY-MM-DD' 문자열로 주지만, Date 객체가 와도 안전하게 처리
const toIsoDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

/**
 * 이벤트 정의 레지스트리.
 * trigger(ctx): 발생 판단. ctx = { session, turnNumber, tradeDate, totalAsset }
 * apply(ctx): immediate 효과 { cashDelta, debtDelta, stressDelta, trustDelta, lockDays, detail }
 * choices: 선택형 [{ key, label, effect(ctx) }]. effect의 ctx.payload = 클라이언트 추가 입력
 */
const EVENT_DEFS = {
  // ------------------------------------------------------------------
  // E. 기절·입원 (강제 페널티형, 미팅5): 스트레스 100 즉시 발동, 게임오버 아님
  //    3~5일 투자·부업 불가 / 병원비 정액 차감(현금 부족분은 대출 잔금 증가)
  //    스트레스 0 리셋(신뢰도 유지) / 입원 중 자산 가격은 계속 변동
  // ------------------------------------------------------------------
  faint: {
    kind: 'immediate',
    trigger: ({ session }) => stressPolicy.shouldFaint(session.stress),
    apply: ({ session }) => {
      const skipDays = stressPolicy.rollFaintSkipDays();
      const cash = Number(session.cash);
      const cashPaid = Math.min(cash, C.HOSPITAL_COST);
      const debtAdded = C.HOSPITAL_COST - cashPaid; // 현금 부족분 -> 대출 잔금 증가
      return {
        cashDelta: -cashPaid,
        debtDelta: debtAdded,
        stressDelta: C.FAINT_RESET_STRESS - session.stress, // 0으로 리셋
        lockDays: skipDays,
        detail: {
          message: `극심한 스트레스로 기절했다. ${skipDays}평일 동안 투자·부업 불가.`,
          skipDays, hospitalCost: C.HOSPITAL_COST, cashPaid, debtAdded,
        },
      };
    },
  },

  // ------------------------------------------------------------------
  // C. 독촉 전화 (상태 연동형, 미팅5 §3): 확률 = 20 − 신뢰도×0.15 (%)
  //    "사채업자의 전화"(loan_shark_call)는 신뢰도 기반 랜덤 이벤트로 매 평일 턴 판정한다.
  //    상환("사채업자 방문", repaymentService)과는 별개다. 전화를 받는다고 상환 의무가
  //    생기지 않으며, 끊어도(hang_up) 페널티만 있을 뿐 강제 상환은 없다.
  //    유형별 스트레스 즉시 반영 + 팝업에서 지불액 입력 가능 (기능명세서)
  // ------------------------------------------------------------------
  loan_shark_call: {
    kind: 'choice',
    trigger: ({ session }) =>
      Math.random() < trustPolicy.loanSharkCallProb(session.trust),
    onFire: ({ session }) => {
      // 전화 수신 자체의 스트레스는 즉시 반영 (유형은 신뢰도 구간으로 결정)
      const tier = trustPolicy.loanSharkTier(session.trust);
      return { stressDelta: tier.stressDelta, detail: { tier: tier.type, label: tier.label } };
    },
    prompt: '사채업자에게 전화가 걸려왔다...',
    choices: [
      {
        key: 'pay', label: '일부 상환한다 (금액 입력)',
        // payload: { amount } — 즉시 부채 상환 (상환 실적은 월말 정산과 별개 기록)
        effect: ({ session, payload }) => {
          const amount = Math.max(0, Math.floor(Number(payload?.amount) || 0));
          const paid = Math.min(amount, Number(session.cash), Number(session.debt));
          return { cashDelta: -paid, debtDelta: -paid, stressDelta: paid > 0 ? -3 : 0, detail: { paid } };
        },
      },
      { key: 'hang_up', label: '전화를 끊는다', effect: () => ({ stressDelta: +2 }) },
    ],
  },

  // ------------------------------------------------------------------
  // C. 급등주 (상태 연동형, 미팅5 §4): 스트레스 높을수록 확률 상승, 입원 중 불가
  //    개장일에 임시 작전주 등장 -> 매수는 POST /surge/buy, 정산은 다음 개장 턴
  // ------------------------------------------------------------------
  surge_stock: {
    kind: 'immediate',
    trigger: ({ session, marketOpen, hasFutureMarketOpen }) =>
      marketOpen === true &&
      hasFutureMarketOpen === true &&
      session.current_turn < C.TOTAL_TURNS &&
      session.current_turn > session.action_locked_until_turn &&
      Math.random() < surgeStockService.spawnProb(session.stress),
    applyAsync: async (client, ctx) => {
      const spawned = await surgeStockService.spawn(client, ctx.session);
      return {
        detail: {
          message: `급등주 소문이 돈다: ${spawned.displayName}`,
          ...spawned,
        },
      };
    },
  },

  // ------------------------------------------------------------------
  // B. 투자 스터디 (랜덤 기회형, 미팅5 §B): 수락/거절, 현금 수익 없음
  //    기본: 스트레스 −6~−12 + 금융 지식·연결 퀴즈 / 확률형 점검 과제 (미래 예측 아님)
  // ------------------------------------------------------------------
  invest_study: {
    kind: 'choice',
    trigger: () => Math.random() < C.INVEST_STUDY.prob,
    prompt: '투자 스터디 모임에 초대받았다. 참여하면 금융 지식을 얻을 수 있다.',
    choices: [
      {
        key: 'join', label: '참여한다',
        effect: ({ studyHistory = [] } = {}) => {
          const cfg = C.INVEST_STUDY;
          const rare = Math.random() < cfg.rareProb;
          const hint = rare || Math.random() < cfg.hintProb;
          const stressDelta = rare ? cfg.rareStress : Math.round(rand(cfg.baseStress.min, cfg.baseStress.max));
          const lesson = selectStudyKnowledge(studyHistory);
          return {
            stressDelta,
            detail: {
              insightId: lesson.id,
              insightTitle: lesson.title,
              insightTopic: lesson.topic,
              insight: lesson.insight,
              quiz: lesson.quiz,
              directionHint: hint ? buildDirectionHint() : null,
              omenHint: rare ? buildOmenHint() : null,
              rare,
            },
          };
        },
      },
      { key: 'decline', label: '거절한다 (기회 소멸)', effect: () => ({}) },
    ],
  },

  // ------------------------------------------------------------------
  // D. 경조사 = 지인 결혼식 초대 (선택형): 참석(축의금 + 스트레스 랜덤) / 불참(스트레스 증가)
  // ------------------------------------------------------------------
  condolence: {
    kind: 'choice',
    trigger: () => Math.random() < C.CONDOLENCE.prob,
    prompt: '지인의 결혼식 초대장이 도착했다.',
    choices: [
      {
        key: 'attend', label: `참석한다 (-${C.CONDOLENCE.attendCost.toLocaleString()}원)`,
        effect: ({ session }) => {
          const cfg = C.CONDOLENCE;
          // 축의금 낼 현금이 없으면 참석하지 못하고 불참과 같은 결과가 된다
          if (Number(session.cash) < cfg.attendCost) {
            return { stressDelta: cfg.declineStress, detail: { outcome: 'broke', cost: 0 } };
          }
          const down = Math.random() < cfg.attendDownProb;
          return {
            cashDelta: -cfg.attendCost,
            stressDelta: down ? -cfg.attendStressAbs : +cfg.attendStressAbs,
            detail: { outcome: down ? 'down' : 'up', cost: cfg.attendCost },
          };
        },
      },
      {
        key: 'decline', label: '불참한다 (스트레스 증가)',
        effect: () => ({ stressDelta: C.CONDOLENCE.declineStress, detail: { outcome: 'decline', cost: 0 } }),
      },
    ],
  },

  // ------------------------------------------------------------------
  // D. 명절 (미팅4 §8): 랜덤 결과 — 사촌동생 용돈(지출) / 아늑한 우리집(스트레스 하락)
  // ------------------------------------------------------------------
  holiday: {
    kind: 'immediate',
    // 설날/추석 당일(HOLIDAY.DATES)이 직전 게임 평일~이번 게임 평일 사이에 있으면 발동.
    // 평일 명절은 당일, 주말 명절은 다음 평일에 정확히 1회 발생한다.
    trigger: ({ tradeDate, prevTradeDate }) => {
      if (!prevTradeDate) return false;
      const cur = toIsoDate(tradeDate);
      const prev = toIsoDate(prevTradeDate);
      return C.HOLIDAY.DATES.some((h) => prev < h && h <= cur);
    },
    apply: () => {
      const r = pick(C.HOLIDAY.RESULTS);
      return { cashDelta: r.cashDelta, stressDelta: r.stressDelta, detail: { result: r.key, label: r.label } };
    },
  },

  // 여행 (선택형, 미팅4 §8: 스트레스 하락 + 현금 지출)
  travel: {
    kind: 'choice',
    trigger: () => Math.random() < C.TRAVEL.prob,
    prompt: '주말 여행을 떠나볼까?',
    choices: [
      {
        key: 'go', label: `간다 (-${C.TRAVEL.cost.toLocaleString()}원, 스트레스 ${C.TRAVEL.stressDelta})`,
        effect: ({ session }) =>
          Number(session.cash) >= C.TRAVEL.cost
            ? { cashDelta: -C.TRAVEL.cost, stressDelta: C.TRAVEL.stressDelta }
            : { stressDelta: +2, detail: { message: '여행 갈 돈이 없다...' } },
      },
      { key: 'skip', label: '안 간다', effect: () => ({ stressDelta: C.TRAVEL.declineStress }) },
    ],
  },
};

// --- 추가 학습 과제. 실제 다음 턴 가격이나 랜덤 이벤트를 알고 주는 예측 신호가 아니다.
// 기존 응답 키는 유지하되, 아직 존재하지 않는 미래 데이터에 대한 단정은 하지 않는다.
function buildDirectionHint() {
  return { scope: 'study', text: '점검 과제: 같은 기간의 시장지수와 내 보유 종목 수익률을 나란히 비교해 보세요.' };
}
function buildOmenHint() {
  return { scope: 'budget', text: '생활비와 상환 예정액을 계산해 투자에 쓰지 않을 현금을 구분해 보세요.' };
}

// --- 발생/적용 -------------------------------------------------------

/**
 * 턴 진행 시 이벤트 발생 판단 + 적용 (turnService 트랜잭션 안에서 호출)
 * 우선순위: 기절(E) > 명절(D) > 독촉전화(C) > 급등주(C) > 경조사(D) > 스터디(B) > 여행
 * 명절은 달력 확정 이벤트라 랜덤 이벤트보다 앞에 둔다 — 발동 윈도우(직전~이번 게임 날짜)가
 * 한 턴뿐이라, EVENT_MAX_PER_TURN에 밀리면 그 명절이 영영 소실되기 때문.
 */
async function rollTurnEvents(client, session, ctx) {
  const fired = [];
  const order = ['faint', 'holiday', 'loan_shark_call', 'surge_stock', 'condolence', 'invest_study', 'travel'];

  for (const type of order) {
    if (fired.length >= C.EVENT_MAX_PER_TURN && type !== 'faint') continue; // 기절은 한도 무시하고 항상 판정
    const def = EVENT_DEFS[type];
    // Hospital days pass automatically; do not interrupt recovery with new optional choices.
    if (def.kind === 'choice' && session.current_turn <= session.action_locked_until_turn) continue;
    if (!def.trigger({ session, ...ctx })) continue;

    if (def.kind === 'immediate') {
      const eff = def.applyAsync
        ? await def.applyAsync(client, { session, ...ctx })
        : def.apply({ session, ...ctx });
      await applyEffect(client, session, type, eff);
      fired.push({ eventType: type, kind: 'immediate', ...eff });
    } else {
      // 선택형: 발생 시점 효과(onFire)가 있으면 즉시 반영하고, 선택은 pending으로
      let fireDetail = {};
      if (def.onFire) {
        const fireEff = def.onFire({ session, ...ctx });
        await applyEffect(client, session, `${type}_received`, fireEff);
        fireDetail = fireEff.detail || {};
      }
      const { rows } = await client.query(
        `INSERT INTO event_log (session_id, turn_number, event_type, detail, resolved)
         VALUES ($1, $2, $3, $4, FALSE) RETURNING id`,
        [session.id, session.current_turn, type, JSON.stringify({
          prompt: def.prompt,
          ...fireDetail,
          choices: def.choices.map((c) => ({ key: c.key, label: c.label })),
        })]
      );
      fired.push({
        eventLogId: rows[0].id,
        eventType: type,
        kind: 'choice',
        prompt: def.prompt,
        ...fireDetail,
        choices: def.choices.map((c) => ({ key: c.key, label: c.label })),
      });
    }
  }
  return fired;
}

/** 효과를 세션/로그에 반영 (session 객체도 갱신해 이후 판정이 최신 상태를 보게 함) */
async function applyEffect(client, session, eventType, eff) {
  const cashDelta = eff.cashDelta || 0;
  const debtDelta = eff.debtDelta || 0;
  const newStress = clamp100(session.stress + (eff.stressDelta || 0));
  const newTrust = clamp100(session.trust + (eff.trustDelta || 0));
  const lockUntil = eff.lockDays
    ? session.current_turn + eff.lockDays
    : session.action_locked_until_turn;

  await require('./challengeService').externalFlow(client, session, cashDelta);
  await client.query(
    `UPDATE game_sessions
     SET cash = cash + $2, debt = debt + $3, stress = $4, trust = $5,
         action_locked_until_turn = $6, updated_at = NOW()
     WHERE id = $1`,
    [session.id, cashDelta, debtDelta, newStress, newTrust, lockUntil]
  );
  await client.query(
    `INSERT INTO event_log (session_id, turn_number, event_type, detail, cash_delta, stress_delta, trust_delta, resolved)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)`,
    [session.id, session.current_turn, eventType, JSON.stringify(eff.detail || {}),
     cashDelta, eff.stressDelta || 0, eff.trustDelta || 0]
  );
  session.cash = Number(session.cash) + cashDelta;
  session.debt = Number(session.debt) + debtDelta;
  session.stress = newStress;
  session.trust = newTrust;
  session.action_locked_until_turn = lockUntil;
  const blocked = await require('./investmentPolicy').enforce(client, session);
  if (blocked) eff.investmentRestriction = blocked;
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

/** 선택형 이벤트 해결 (POST /event { eventLogId, choice, payload? }) */
async function resolveEvent(sessionId, eventLogId, choiceKey, payload) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT e.id AS log_id, e.event_type, e.resolved, s.*
       FROM event_log e JOIN game_sessions s ON s.id = e.session_id
       WHERE e.id = $1 AND e.session_id = $2 FOR UPDATE OF e, s`,
      [eventLogId, sessionId]
    );
    const row = rows[0];
    if (!row) throw badRequest('이벤트를 찾을 수 없습니다');
    if (row.resolved) throw conflict('이미 처리된 이벤트입니다');

    const def = EVENT_DEFS[row.event_type];
    const choice = def?.choices?.find((c) => c.key === choiceKey);
    if (!choice) throw badRequest(`유효하지 않은 선택입니다: ${choiceKey}`);

    const session = { ...row, id: sessionId };
    let studyHistory = [];
    if (row.event_type === 'invest_study' && choiceKey === 'join') {
      // 세션 행 잠금 안에서 이력 조회와 선택을 함께 처리해 동시 해결 때도 순서를 유지한다.
      // 기존 JSONB detail을 사용하므로 새 테이블/컬럼 없이 과거 이력과 호환된다.
      const history = await client.query(
        `SELECT detail FROM event_log
         WHERE session_id = $1 AND event_type = 'invest_study' AND resolved = TRUE
           AND detail ? 'insight'
         ORDER BY id DESC`,
        [sessionId]
      );
      studyHistory = history.rows;
    }
    const eff = choice.effect({ session, payload, studyHistory });
    const cashDelta = eff.cashDelta || 0;
    const debtDelta = eff.debtDelta || 0;
    const newStress = clamp100(row.stress + (eff.stressDelta || 0));
    const newTrust = clamp100(row.trust + (eff.trustDelta || 0));
    await require('./challengeService').externalFlow(client, session, cashDelta);
    session.cash = Number(row.cash) + cashDelta;
    session.debt = Number(row.debt) + debtDelta;
    session.stress = newStress;
    session.trust = newTrust;
    await require('./investmentPolicy').enforce(client, session);

    await client.query(
      `UPDATE game_sessions
       SET cash = cash + $2, debt = debt + $3, stress = $4, trust = $5, updated_at = NOW()
       WHERE id = $1`,
      [sessionId, cashDelta, debtDelta, newStress, newTrust]
    );
    await client.query(
      `UPDATE event_log
       SET resolved = TRUE, cash_delta = $2, stress_delta = $3, trust_delta = $4,
           detail = detail || $5::jsonb || jsonb_build_object('appliedAt', NOW(), 'appliedTurn', $6::int)
       WHERE id = $1`,
      [eventLogId, cashDelta, eff.stressDelta || 0, eff.trustDelta || 0,
       JSON.stringify({ chosen: choiceKey, ...(eff.detail || {}) }), session.current_turn]
    );

    // 선택 효과(예: 독촉 전화에서 마지막 부채 상환)까지 적용한 상태로 즉시 종료를 판정한다.
    // 종료 시 급등주 원금을 먼저 중립 환급한 뒤 세션/스냅샷을 같은 트랜잭션에서 확정한다.
    const status = await gameService.evaluateEndCondition(client, session);
    let surgeResults = [];
    let totalAsset = null;
    if (status !== 'active') {
      surgeResults = await surgeStockService.closePendingAtGameEnd(client, session);
      session.cash = Math.round(Number(session.cash));
      session.debt = Math.round(Number(session.debt));
      await client.query(
        `UPDATE game_sessions
         SET cash = $2, debt = $3, stress = $4, trust = $5, status = $6, updated_at = NOW()
         WHERE id = $1`,
        [sessionId, session.cash, session.debt, session.stress, session.trust, status]
      );
      totalAsset = await valuationService.computeTotalAsset(sessionId, client, { cash: session.cash });
      await reportService.syncTerminalSnapshots(client, sessionId, session.current_turn, {
        totalAsset,
        session,
      });
    }

    return {
      eventLogId, chosen: choiceKey, ...eff,
      cash: session.cash,
      debt: session.debt,
      stress: session.stress,
      trust: session.trust,
      status,
      finished: status !== 'active',
      surgeResults,
      ...(totalAsset === null ? {} : { totalAsset }),
    };
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
