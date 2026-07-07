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
const { clamp100 } = require('../utils/clamp');

const rand = (min, max) => min + Math.random() * (max - min);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

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
          message: `극심한 스트레스로 기절했다. ${skipDays}거래일 동안 투자·부업 불가.`,
          skipDays, hospitalCost: C.HOSPITAL_COST, cashPaid, debtAdded,
        },
      };
    },
  },

  // ------------------------------------------------------------------
  // C. 독촉 전화 (상태 연동형, 미팅5 §3): 확률 = 50 − 신뢰도×0.45 (%)
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
  //    당일 장에 임시 작전주 등장 -> 매수는 POST /surge/buy, 정산은 다음 턴
  // ------------------------------------------------------------------
  surge_stock: {
    kind: 'immediate',
    trigger: ({ session }) =>
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
  //    기본: 스트레스 −6~−12 + 금융 인사이트 / 40% 방향성 힌트 / 10% 희귀(−15 + 전조 힌트)
  // ------------------------------------------------------------------
  invest_study: {
    kind: 'choice',
    trigger: () => Math.random() < C.INVEST_STUDY.prob,
    prompt: '투자 스터디 모임에 초대받았다. 참여하면 금융 지식을 얻을 수 있다.',
    choices: [
      {
        key: 'join', label: '참여한다',
        effect: () => {
          const cfg = C.INVEST_STUDY;
          const rare = Math.random() < cfg.rareProb;
          const hint = rare || Math.random() < cfg.hintProb;
          const stressDelta = rare ? cfg.rareStress : Math.round(rand(cfg.baseStress.min, cfg.baseStress.max));
          return {
            stressDelta,
            detail: {
              insight: buildInsight(),                       // 금융 인사이트 1개 (항상)
              directionHint: hint ? buildDirectionHint() : null, // 시장 방향성 힌트
              omenHint: rare ? buildOmenHint() : null,           // 이벤트 전조 힌트
              rare,
            },
          };
        },
      },
      { key: 'decline', label: '거절한다 (기회 소멸)', effect: () => ({}) },
    ],
  },

  // ------------------------------------------------------------------
  // D. 경조사 (외부 랜덤형, 미팅4 §14): 거부 불가, 비용 확정 차감, 스트레스 방향 랜덤
  // ------------------------------------------------------------------
  condolence: {
    kind: 'immediate',
    trigger: () => Math.random() < C.CONDOLENCE.prob,
    apply: () => {
      const t = pick(C.CONDOLENCE.TYPES);
      const down = Math.random() < t.downProb;
      return {
        cashDelta: -t.cost,
        stressDelta: down ? -t.stressAbs : +t.stressAbs,
        detail: { type: t.key, label: t.label, cost: t.cost },
      };
    },
  },

  // ------------------------------------------------------------------
  // D. 명절 (미팅4 §8): 랜덤 결과 — 사촌동생 용돈(지출) / 아늑한 우리집(스트레스 하락)
  // ------------------------------------------------------------------
  holiday: {
    kind: 'immediate',
    // TODO(data): 실제 설/추석 달력 기반 트리거로 교체 (임시: 2/1, 9/1 근처)
    trigger: ({ tradeDate }) => {
      const d = new Date(tradeDate);
      return (d.getMonth() === 1 || d.getMonth() === 8) && d.getDate() <= 2;
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

// --- 투자 스터디 힌트 생성 -------------------------------------------
// TODO(gamelogic): 실제 다음 턴 가격/뉴스 데이터 기반 힌트로 교체.
// 힌트는 "정답 공개가 아닌 판단을 돕는 간접 신호"여야 한다 (미팅5).
function buildInsight() {
  return pick([
    '분산 투자는 개별 종목 리스크를 줄여준다.',
    '금리가 오르면 일반적으로 채권 가격은 내려간다.',
    '거래량이 실리지 않은 급등은 오래가지 못하는 경우가 많다.',
    'PER이 낮다고 무조건 저평가는 아니다. 업종 평균과 비교하라.',
  ]);
}
function buildDirectionHint() {
  return { scope: 'market', text: '다음 주 시장 변동성이 커질 조짐이 있다.' };
}
function buildOmenHint() {
  return { scope: 'event', text: '조만간 큰 지출이 생길 것 같은 예감이 든다.' };
}

// --- 발생/적용 -------------------------------------------------------

/**
 * 턴 진행 시 이벤트 발생 판단 + 적용 (turnService 트랜잭션 안에서 호출)
 * 우선순위: 기절(E) > 독촉전화(C) > 급등주(C) > 경조사/명절(D) > 스터디(B) > 여행
 */
async function rollTurnEvents(client, session, ctx) {
  const fired = [];
  const order = ['faint', 'loan_shark_call', 'surge_stock', 'condolence', 'holiday', 'invest_study', 'travel'];

  for (const type of order) {
    if (fired.length >= C.EVENT_MAX_PER_TURN && type !== 'faint') continue; // 기절은 한도 무시하고 항상 판정
    const def = EVENT_DEFS[type];
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
    const eff = choice.effect({ session, payload });
    const cashDelta = eff.cashDelta || 0;
    const debtDelta = eff.debtDelta || 0;
    const newStress = clamp100(row.stress + (eff.stressDelta || 0));
    const newTrust = clamp100(row.trust + (eff.trustDelta || 0));

    await client.query(
      `UPDATE game_sessions
       SET cash = cash + $2, debt = debt + $3, stress = $4, trust = $5, updated_at = NOW()
       WHERE id = $1`,
      [sessionId, cashDelta, debtDelta, newStress, newTrust]
    );
    await client.query(
      `UPDATE event_log
       SET resolved = TRUE, cash_delta = $2, stress_delta = $3, trust_delta = $4,
           detail = detail || $5
       WHERE id = $1`,
      [eventLogId, cashDelta, eff.stressDelta || 0, eff.trustDelta || 0,
       JSON.stringify({ chosen: choiceKey, ...(eff.detail || {}) })]
    );
    return {
      eventLogId, chosen: choiceKey, ...eff,
      cash: Number(row.cash) + cashDelta,
      debt: Number(row.debt) + debtDelta,
      stress: newStress, trust: newTrust,
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
