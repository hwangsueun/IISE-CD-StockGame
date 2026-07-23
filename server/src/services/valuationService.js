// 총자산/수익률/자산군 비중 평가 (ARCHITECTURE.md §11)
const { query } = require('../db');
const { notFound } = require('../utils/errors');

/** 세션의 현재 턴 날짜 */
async function getCurrentTradeDate(sessionId, client) {
  const q = client || { query };
  const { rows } = await q.query(
    `SELECT gt.trade_date
     FROM game_sessions gs
     JOIN game_turns gt ON gt.session_id = gs.id AND gt.turn_number = gs.current_turn
     WHERE gs.id = $1`,
    [sessionId]
  );
  if (!rows[0]) throw notFound('세션 턴 정보를 찾을 수 없습니다');
  return rows[0].trade_date;
}

/**
 * 보유자산 평가 목록.
 * 오늘 시세가 없는 자산(거래정지 등)은 직전 거래일 종가로 평가한다.
 *
 * 상장폐지(assets.listed_to 경과) 보유자산은 여기 남지 않는다: turnService.advanceTurn이
 * 다음 턴 가격 조회 직후 / 이 평가 이전에 tradeService.liquidateDelisted로 강제청산하며
 * holdings 행을 즉시 DELETE하기 때문이다 (§9-2). 이 함수는 캐시를 두지 않고 매번 holdings를
 * 다시 조회하므로, 청산 이후의 모든 호출(포트폴리오 화면 포함)에 즉시 반영된다.
 */
async function evaluateHoldings(sessionId, client) {
  const q = client || { query };
  const tradeDate = await getCurrentTradeDate(sessionId, client);
  const { rows } = await q.query(
    `SELECT h.asset_id, h.quantity, h.avg_price,
            a.asset_type, a.masked_name AS name, a.sector,
            (SELECT p.close_price FROM asset_prices p
             WHERE p.asset_id = h.asset_id AND p.trade_date <= $2
             ORDER BY p.trade_date DESC LIMIT 1) AS price
     FROM holdings h
     JOIN assets a ON a.asset_id = h.asset_id
     WHERE h.session_id = $1`,
    [sessionId, tradeDate]
  );
  return rows.map((r) => {
    const quantity = Number(r.quantity);
    const avgPrice = Number(r.avg_price);
    // r.price === null: 이 자산의 asset_prices에 tradeDate 이전 시세가 단 하나도 없다는 뜻.
    // 매수 시점에 tradeService가 반드시 그 날짜의 시세를 확인하므로(없으면 매수 자체를 막는다),
    // 보유 중인데 시세가 전혀 없는 상태는 정상 흐름에서는 나오지 않는다. 상장폐지도 여기 해당하지
    // 않는다 — 그 경우는 강제청산으로 holdings에서 먼저 제거된다(위 함수 설명 참고).
    // 즉 이 분기를 타면 asset_prices 데이터 결손(또는 holdings가 트레이드 경로 밖에서 생성된
    // 경우) 같은 비정상 상태이므로, 게임 진행을 막지 않기 위해 avg_price로 대체 평가하되
    // 운영에서 원인을 추적할 수 있도록 경고를 남긴다.
    if (r.price === null) {
      console.warn(
        `[valuationService.evaluateHoldings] no price found for held asset ${r.asset_id} ` +
        `(session ${sessionId}, trade_date <= ${tradeDate}); falling back to avg_price`
      );
    }
    const price = r.price === null ? avgPrice : Number(r.price);
    const value = price * quantity;
    const cost = avgPrice * quantity;
    return {
      assetId: r.asset_id,
      assetType: r.asset_type,
      name: r.name,
      sector: r.sector,
      quantity,
      avgPrice,
      price,
      value,
      unrealizedPnl: value - cost,
      returnRate: cost > 0 ? (value - cost) / cost : 0,
    };
  });
}

/**
 * 총자산 = 현금 + 보유자산 평가액.
 *
 * 주의(기존 동작, 이번 작업 범위 밖): turnService.advanceTurn 트랜잭션 안에서 client와 함께
 * 호출될 때, 여기서 읽는 game_sessions.cash는 DB의 "현재" 값이다. 강제청산/월급·생활비/
 * 급등주 정산은 advanceTurn이 session.cash를 메모리에서만 갱신하고 실제 UPDATE는 훨씬
 * 뒤(상태 반영 단계)에 한 번에 실행하므로, 그 UPDATE 이전에 이 함수가 호출되면(현재
 * advanceTurn의 호출 시점이 그렇다) 이번 턴에 반영된 현금 변동이 반영되지 않은 값을 반환한다.
 * 그 결과가 dailyReturn 계산과 daily 스냅샷에 쓰인다. 이 함수 자체의 문제라기보다 호출 시점의
 * 문제이며, 강제청산 도입 이전부터 월급/급등주 정산에도 동일하게 있던 특성이다.
 */
async function computeTotalAsset(sessionId, client) {
  const q = client || { query };
  const { rows } = await q.query(`SELECT cash FROM game_sessions WHERE id = $1`, [sessionId]);
  if (!rows[0]) throw notFound('세션을 찾을 수 없습니다');
  const holdings = await evaluateHoldings(sessionId, client);
  const holdingsValue = holdings.reduce((s, h) => s + h.value, 0);
  return Math.round(Number(rows[0].cash) + holdingsValue);
}

/** 포트폴리오 화면 응답: 보유자산 + 자산군 비중 + 요약 */
async function getPortfolio(sessionId) {
  const { rows } = await query(
    `SELECT cash, debt FROM game_sessions WHERE id = $1`,
    [sessionId]
  );
  if (!rows[0]) throw notFound('세션을 찾을 수 없습니다');
  const cash = Number(rows[0].cash);
  const holdings = await evaluateHoldings(sessionId);
  const holdingsValue = holdings.reduce((s, h) => s + h.value, 0);
  const totalAsset = cash + holdingsValue;

  const byType = { stock: 0, bond: 0, coin: 0 };
  for (const h of holdings) byType[h.assetType] += h.value;
  const weights = {
    cash: totalAsset > 0 ? cash / totalAsset : 1,
    stock: totalAsset > 0 ? byType.stock / totalAsset : 0,
    bond: totalAsset > 0 ? byType.bond / totalAsset : 0,
    coin: totalAsset > 0 ? byType.coin / totalAsset : 0,
  };

  return {
    cash,
    debt: Number(rows[0].debt),
    totalAsset: Math.round(totalAsset),
    netAsset: Math.round(totalAsset - Number(rows[0].debt)),
    holdings,
    weights,
    unrealizedPnl: holdings.reduce((s, h) => s + h.unrealizedPnl, 0),
  };
}

/**
 * 기간별/자산군별/종목별 실현손익 (기능명세서 §자산 포트폴리오)
 * @param {'daily'|'weekly'|'monthly'|'yearly'|'all'} period 현재 턴 기준 조회 구간
 * @param {'stock'|'bond'|'coin'|undefined} assetType 자산군 필터
 * @returns { period, totalPnl, tradeCount, byAsset: [{assetId, name, assetType, pnl, tradeCount}] }
 */
async function getRealizedPnl(sessionId, period = 'all', assetType) {
  const { rows: sRows } = await query(
    `SELECT current_turn FROM game_sessions WHERE id = $1`, [sessionId]
  );
  if (!sRows[0]) throw notFound('세션을 찾을 수 없습니다');
  const currentTurn = sRows[0].current_turn;

  // 턴 기준 구간: 일=현재 턴, 주=5턴, 월=20턴, 연=240턴, 전체=1턴부터
  const TURNS = { daily: 1, weekly: 5, monthly: 20, yearly: 240, all: currentTurn };
  const span = TURNS[period] ?? TURNS.all;
  const fromTurn = Math.max(1, currentTurn - span + 1);

  const params = [sessionId, fromTurn];
  let typeFilter = '';
  if (assetType) {
    params.push(assetType);
    typeFilter = `AND a.asset_type = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT t.asset_id, a.masked_name AS name, a.asset_type,
            COALESCE(SUM(t.realized_pnl), 0) AS pnl,
            COUNT(*)::int AS trade_count
     FROM trades t JOIN assets a ON a.asset_id = t.asset_id
     WHERE t.session_id = $1 AND t.turn_number >= $2 ${typeFilter}
     GROUP BY t.asset_id, a.masked_name, a.asset_type
     ORDER BY pnl DESC`,
    params
  );
  const byAsset = rows.map((r) => ({
    assetId: r.asset_id,
    name: r.name,
    assetType: r.asset_type,
    pnl: Number(r.pnl),
    tradeCount: r.trade_count,
  }));
  return {
    period,
    fromTurn,
    toTurn: currentTurn,
    assetType: assetType || 'all',
    totalPnl: byAsset.reduce((s, r) => s + r.pnl, 0),
    tradeCount: byAsset.reduce((s, r) => s + r.tradeCount, 0),
    byAsset,
  };
}

/**
 * 수익률 추이: 턴별 총자산 스냅샷(session_snapshots daily) + 초기자본 대비 수익률.
 * 대시보드 라인차트용 단일 측정치 시계열이다.
 * @returns { initialCapital, points: [{turn, totalAsset, netAsset, returnRate}] }
 */
async function getPortfolioHistory(sessionId) {
  const { rows: sRows } = await query(
    `SELECT initial_cash FROM game_sessions WHERE id = $1`, [sessionId]
  );
  if (!sRows.length) throw notFound('세션을 찾을 수 없습니다');
  const initialCapital = Number(sRows[0].initial_cash);

  const { rows } = await query(
    `SELECT turn_number, total_asset, debt
       FROM session_snapshots
      WHERE session_id = $1 AND snapshot_type = 'daily'
      ORDER BY turn_number`,
    [sessionId]
  );

  const points = rows.map((r) => {
    const totalAsset = Number(r.total_asset);
    return {
      turn: r.turn_number,
      totalAsset,
      netAsset: totalAsset - Number(r.debt),
      // 초기자본 대비 수익률 (0 = 본전). 단일 측정치라 축이 하나다.
      returnRate: initialCapital > 0 ? (totalAsset - initialCapital) / initialCapital : 0,
    };
  });

  return { initialCapital, points };
}

module.exports = {
  getCurrentTradeDate, evaluateHoldings, computeTotalAsset,
  getPortfolio, getRealizedPnl, getPortfolioHistory,
};
