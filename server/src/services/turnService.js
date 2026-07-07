// 턴 진행 오케스트레이션 (ARCHITECTURE.md §9-2 턴 종료 순서)
// 1. 입력 검증 -> 2. (거래는 tradeService가 개별 처리) -> 3. 다음 턴 가격
// -> 4. 보유자산 평가 -> 5. 뉴스 노출량 -> 6. 이벤트 -> 7. 상태 반영 -> 8. 자동저장
const { query, withTransaction } = require('../db');
const { notFound, conflict } = require('../utils/errors');
const C = require('../config/constants');
const gameService = require('./gameService');
const pricingService = require('./pricingService');
const valuationService = require('./valuationService');
const stressPolicy = require('./stressPolicy');
const repaymentService = require('./repaymentService');
const eventEngine = require('./eventEngine');
const newsService = require('./newsService');
const reportService = require('./reportService');
const { clamp100 } = require('../utils/clamp');

/** 세션+턴 -> 날짜 */
async function getTurnDate(sessionId, turnNumber, client) {
  const q = client || { query };
  const { rows } = await q.query(
    `SELECT trade_date FROM game_turns WHERE session_id = $1 AND turn_number = $2`,
    [sessionId, turnNumber]
  );
  if (!rows[0]) throw notFound('턴 정보를 찾을 수 없습니다');
  return rows[0].trade_date;
}

/**
 * GET /turn/:turnNumber 응답 (§8-5 응답 예시 형태)
 * 자산 시세 + 뉴스(제한 반영) + 상태 + 상환 턴 여부
 */
async function getTurnData(sessionId, turnNumber) {
  const session = await gameService.getSession(sessionId);
  const date = await getTurnDate(sessionId, turnNumber);
  const iso = toIso(date);

  const [prices, assets, newsResult, totalAsset] = await Promise.all([
    pricingService.getPricesAt(iso),
    query(`SELECT asset_id, asset_type, masked_name AS name, sector FROM assets WHERE is_active = TRUE`),
    newsService.getNewsByDate(iso, { sessionId }),
    valuationService.computeTotalAsset(sessionId),
  ]);

  const assetRows = assets.rows
    .map((a) => ({
      assetId: a.asset_id,
      assetType: a.asset_type,
      name: a.name,
      sector: a.sector,
      price: prices[a.asset_id]?.price ?? null,
      changeRate: prices[a.asset_id]?.changeRate ?? null,
    }))
    .filter((a) => a.price !== null); // 해당일 시세 없는 자산(상장 전/폐지)은 목록 제외

  return {
    turnNumber,
    date: iso,
    monthIndex: repaymentService.monthIndexOf(turnNumber),
    isRepaymentTurn: repaymentService.isRepaymentTurn(turnNumber),
    isMonthStart: turnNumber % C.TURNS_PER_MONTH === 1,
    state: {
      cash: Number(session.cash),
      totalAsset,
      debt: Number(session.debt),
      stress: session.stress,
      trust: session.trust,
    },
    assets: assetRows,
    news: newsResult.news,
    newsLimit: newsResult.newsLimit,
    actionLocked: session.current_turn <= session.action_locked_until_turn,
  };
}

/**
 * POST /next-turn — 턴 종료 & 다음 턴 시작. 전 과정 단일 트랜잭션(자동저장).
 * 반환: 새 턴 스냅샷 + 발생 이벤트 + 월초/주간 처리 결과
 */
async function advanceTurn(sessionId) {
  const result = await withTransaction(async (client) => {
    const { rows: sRows } = await client.query(
      `SELECT * FROM game_sessions WHERE id = $1 FOR UPDATE`,
      [sessionId]
    );
    const session = sRows[0];
    if (!session) throw notFound('세션을 찾을 수 없습니다');
    if (session.status !== 'active') throw conflict('종료된 게임입니다');
    if (session.current_turn >= C.TOTAL_TURNS) {
      // 240턴 종료: 승패 판정만
      const status = await gameService.evaluateEndCondition(client, session);
      return { finished: true, status };
    }

    const nextTurn = session.current_turn + 1;
    const nextDate = await getTurnDate(sessionId, nextTurn, client);
    session.current_turn = nextTurn;

    // --- 월초 처리: 월급 지급 + 생활비 차감 (기획서 §7 Monthly turn) ---
    let monthly = null;
    if (nextTurn % C.TURNS_PER_MONTH === 1 && nextTurn > 1) {
      const livingCost = Number(session.monthly_living_cost) || C.LIVING_COST_DEFAULT;
      const livingStress = stressPolicy.livingCostStressDelta(livingCost);
      const cashDelta = C.MONTHLY_SALARY - livingCost;
      session.cash = Number(session.cash) + cashDelta;
      session.stress = clamp100(session.stress + livingStress);
      monthly = { salary: C.MONTHLY_SALARY, livingCost, stressDelta: livingStress };
      await client.query(
        `INSERT INTO event_log (session_id, turn_number, event_type, detail, cash_delta, stress_delta, resolved)
         VALUES ($1, $2, 'monthly_cashflow', $3, $4, $5, TRUE)`,
        [sessionId, nextTurn, JSON.stringify(monthly), cashDelta, livingStress]
      );
    }

    // --- 보유자산 평가 + 자연 스트레스 변동 ---
    const totalAssetBefore = await valuationService.computeTotalAsset(sessionId, client);
    const dailyDelta = stressPolicy.dailyStressDelta({
      totalAsset: totalAssetBefore,
      debt: Number(session.debt),
    });
    session.stress = clamp100(session.stress + dailyDelta);

    // --- 이벤트 발생 판단/적용 ---
    const events = await eventEngine.rollTurnEvents(client, session, {
      turnNumber: nextTurn,
      tradeDate: nextDate,
      totalAsset: totalAssetBefore,
    });

    // --- 상태 반영 + 자동저장 ---
    await client.query(
      `UPDATE game_sessions
       SET current_turn = $2, cash = $3, stress = $4, trust = $5, updated_at = NOW()
       WHERE id = $1`,
      [sessionId, nextTurn, Math.round(Number(session.cash)), session.stress, session.trust]
    );

    // --- 주간/일간 스냅샷 (리포트·차트용) ---
    await reportService.writeSnapshot(client, sessionId, nextTurn, 'daily', {
      totalAsset: totalAssetBefore,
      session,
    });
    if (nextTurn % C.TURNS_PER_WEEK === 1 && nextTurn > 1) {
      await reportService.writeSnapshot(client, sessionId, nextTurn, 'weekly', {
        totalAsset: totalAssetBefore,
        session,
      });
    }

    // --- 승패 판정 (신뢰도 0 등) ---
    const status = await gameService.evaluateEndCondition(client, session);

    return {
      finished: status !== 'active',
      status,
      turnNumber: nextTurn,
      date: toIso(nextDate),
      isRepaymentTurn: repaymentService.isRepaymentTurn(nextTurn),
      monthly,
      events,
      newsLimit: stressPolicy.newsLimitFor(session.stress),
      state: {
        cash: Math.round(Number(session.cash)),
        totalAsset: totalAssetBefore,
        debt: Number(session.debt),
        stress: session.stress,
        trust: session.trust,
      },
      actionLocked: nextTurn <= session.action_locked_until_turn,
    };
  });
  return result;
}

function toIso(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

module.exports = { getTurnDate, getTurnData, advanceTurn };
