// 총자산/수익률/자산군 비중 평가 (ARCHITECTURE.md §11)
const { query } = require('../db');
const { notFound } = require('../utils/errors');
const C = require('../config/constants');

const DASHBOARD_UNITS = ['day', 'week', 'month', 'all'];
const DASHBOARD_ASSET_TYPES = ['all', 'stock', 'bond', 'coin'];
const DASHBOARD_BUCKET_SIZE = {
  day: 1,
  week: C.TURNS_PER_WEEK,
  month: C.TURNS_PER_MONTH,
  all: null,
};

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
async function evaluateHoldings(sessionId, client, { tradeDate } = {}) {
  const q = client || { query };
  const valuationDate = tradeDate || await getCurrentTradeDate(sessionId, client);
  const { rows } = await q.query(
    `SELECT valued.* FROM (
       SELECT h.asset_id, h.quantity, h.avg_price,
              a.asset_type, a.masked_name AS name, a.sector,
              (SELECT p.close_price FROM asset_prices p
               WHERE p.asset_id = h.asset_id AND p.trade_date <= $2
               ORDER BY p.trade_date DESC LIMIT 1) AS price,
              FALSE AS is_event_asset
       FROM holdings h
       JOIN assets a ON a.asset_id = h.asset_id
       WHERE h.session_id = $1

       UNION ALL

       SELECT 'SURGE_' || s.id::text AS asset_id,
              s.quantity::numeric AS quantity,
              s.buy_price AS avg_price,
              'stock' AS asset_type,
              s.display_name AS name,
              '급등주 이벤트' AS sector,
              s.buy_price AS price,
              TRUE AS is_event_asset
       FROM surge_stocks s
       WHERE s.session_id = $1
         AND s.resolved = FALSE
         AND s.quantity > 0
         AND s.invested_amount > 0
     ) valued`,
    [sessionId, valuationDate]
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
        `(session ${sessionId}, trade_date <= ${valuationDate}); falling back to avg_price`
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
      isEventAsset: Boolean(r.is_event_asset),
      unrealizedPnl: value - cost,
      returnRate: cost > 0 ? (value - cost) / cost : 0,
    };
  });
}

/**
 * 총자산 = 현금 + 보유자산 평가액.
 *
 * 일반 조회는 DB의 현재 cash/current_turn을 쓴다. turnService처럼 트랜잭션 안에서 세션 행을
 * 최종 UPDATE하기 전에 평가할 때는 메모리상의 cash와 다음 tradeDate를 override로 전달한다.
 */
async function computeTotalAsset(sessionId, client, { cash: cashOverride, tradeDate } = {}) {
  const q = client || { query };
  let cash = cashOverride;
  if (cashOverride === undefined) {
    const { rows } = await q.query(`SELECT cash FROM game_sessions WHERE id = $1`, [sessionId]);
    if (!rows[0]) throw notFound('세션을 찾을 수 없습니다');
    cash = rows[0].cash;
  }
  const holdings = await evaluateHoldings(sessionId, client, { tradeDate });
  const holdingsValue = holdings.reduce((s, h) => s + h.value, 0);
  return Math.round(Number(cash) + holdingsValue);
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
 * 수익률 추이: 턴별 총자산 스냅샷 + 초기자본 대비 수익률.
 *
 * 신규 세션은 1턴 시작 스냅샷을 기록한다. 이 기능 도입 전에 만들어진 세션에는 그 행이
 * 없으므로, 첫 기록이 2턴 이후라면 1턴 초기자본 기준점을 합성해 기존 저장 데이터도 같은
 * API 계약으로 반환한다.
 */
async function getPortfolioHistory(sessionId) {
  const { rows: sRows } = await query(
    `SELECT initial_cash, debt_initial FROM game_sessions WHERE id = $1`,
    [sessionId]
  );
  if (!sRows[0]) throw notFound('세션을 찾을 수 없습니다');

  const initialCapital = Number(sRows[0].initial_cash);
  const initialDebt = Number(sRows[0].debt_initial);
  const { rows } = await query(
    `SELECT turn_number, total_asset, debt
       FROM session_snapshots
      WHERE session_id = $1 AND snapshot_type = 'daily'
      ORDER BY turn_number`,
    [sessionId]
  );

  const snapshots = rows.map((r) => ({
    turn: Number(r.turn_number),
    totalAsset: Number(r.total_asset),
    debt: Number(r.debt),
  }));
  if (snapshots.length === 0 || snapshots[0].turn > 1) {
    snapshots.unshift({ turn: 1, totalAsset: initialCapital, debt: initialDebt });
  }

  return {
    initialCapital,
    points: snapshots.map(({ turn, totalAsset, debt }) => ({
      turn,
      totalAsset,
      netAsset: totalAsset - debt,
      returnRate: initialCapital > 0 ? (totalAsset - initialCapital) / initialCapital : 0,
    })),
  };
}

const timeValue = (value) => {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const valueForScope = (point, assetType) =>
  assetType === 'all' ? point.totalAsset : point.byType[assetType] || 0;

function tradeFlowsBetween(trades, fromCreatedAt, toCreatedAt, assetType) {
  // 전체 자산에서 매매는 현금과 보유자산 사이의 내부 이동이므로 별도 현금흐름이 아니다.
  if (assetType === 'all') return { netFlow: 0, buyAmount: 0 };
  const from = timeValue(fromCreatedAt);
  const to = timeValue(toCreatedAt);
  return trades.reduce((flows, trade) => {
    const at = timeValue(trade.createdAt);
    if (trade.assetType !== assetType || at <= from || at > to) return flows;
    flows.netFlow += trade.netFlow;
    if (trade.netFlow > 0) flows.buyAmount += trade.netFlow;
    return flows;
  }, { netFlow: 0, buyAmount: 0 });
}

function makeDashboardPeriod(start, end, trades, assetType, unit, index) {
  const startValue = valueForScope(start, assetType);
  const endValue = valueForScope(end, assetType);
  const { netFlow, buyAmount } = tradeFlowsBetween(trades, start.createdAt, end.createdAt, assetType);
  // 개별 자산군은 매수(+)·매도(-) 자금 이동을 제외해야 매수 자체가 수익으로 잡히지 않는다.
  const netAmount = endValue - startValue - netFlow;
  // 한 구간 안에서 전량 매도해 순현금흐름이 음수가 되더라도 수익률 분모가 사라지지 않게,
  // 기초 평가액과 그 구간의 총매수액을 실제 투입원금으로 본다.
  const investedBase = startValue + buyAmount;
  const returnRate = investedBase > 0 ? netAmount / investedBase : 0;
  const labels = {
    day: `${index}일차`,
    week: `${index}주차`,
    month: `${index}개월차`,
    all: '전체',
  };
  return {
    index,
    label: labels[unit],
    startValue: Math.round(startValue),
    endValue: Math.round(endValue),
    netFlow: Math.round(netFlow),
    investedBase: Math.round(investedBase),
    netAmount: Math.round(netAmount),
    returnRate,
  };
}

/**
 * 일/주/월은 "최근 N턴" 필터가 아니라 전체 플레이 구간을 나누는 집계 단위다.
 * 1턴=1일, 5턴=1주, 20턴=1개월이며 마지막 구간은 현재까지 완료된 턴으로 정상 집계한다.
 * 달력상 주·월이 끝나지 않았다는 별도 상태나 턴 범위 표현은 두지 않으며, 최신 구간부터 반환한다.
 */
function buildDashboardPeriods(points, trades, unit, assetType, currentPoint) {
  if (!points.length) return { periods: [], summary: null };
  const start = points[0];
  const live = currentPoint || points[points.length - 1];
  const bucketSize = DASHBOARD_BUCKET_SIZE[unit];
  const summary = makeDashboardPeriod(start, live, trades, assetType, 'all', 1);

  if (unit === 'all') return { periods: [summary], summary };
  if (points.length < 2) return { periods: [], summary };

  const periods = [];
  let startIndex = 0;
  while (startIndex < points.length - 1) {
    const startPoint = points[startIndex];
    const targetTurn = startPoint.turn + bucketSize;
    let endIndex = startIndex + 1;
    while (endIndex + 1 < points.length && points[endIndex + 1].turn <= targetTurn) {
      endIndex += 1;
    }
    const endPoint = points[endIndex];
    periods.push(makeDashboardPeriod(
      startPoint,
      endPoint,
      trades,
      assetType,
      unit,
      periods.length + 1
    ));
    startIndex = endIndex;
  }
  return { periods: periods.reverse(), summary };
}

function buildAllocation(portfolio, assetType) {
  const byType = { stock: 0, bond: 0, coin: 0 };
  for (const holding of portfolio.holdings) byType[holding.assetType] += holding.value;

  let rows;
  if (assetType === 'all') {
    rows = [
      { key: 'cash', label: '현금', value: portfolio.cash },
      { key: 'stock', label: '주식', value: byType.stock },
      { key: 'bond', label: '채권', value: byType.bond },
      { key: 'coin', label: '코인', value: byType.coin },
    ];
  } else {
    rows = portfolio.holdings
      .filter((holding) => holding.assetType === assetType)
      .map((holding) => ({
        key: holding.assetId,
        label: holding.name,
        value: holding.value,
      }))
      .sort((a, b) => b.value - a.value);
  }

  const total = rows.reduce((sum, row) => sum + Math.max(0, row.value), 0);
  return rows
    .filter((row) => row.value > 0)
    .map((row) => ({ ...row, value: Math.round(row.value), weight: total > 0 ? row.value / total : 0 }));
}

/**
 * 자산 포트폴리오 대시보드.
 * - assetType: all | stock | bond | coin
 * - unit: day(1턴) | week(5턴) | month(20턴) | all
 */
async function getPortfolioDashboard(sessionId, unit = 'day', assetType = 'all') {
  const { rows: sessionRows } = await query(
    `SELECT initial_cash, debt_initial, current_turn FROM game_sessions WHERE id = $1`,
    [sessionId]
  );
  if (!sessionRows[0]) throw notFound('세션을 찾을 수 없습니다');
  const session = sessionRows[0];

  const [{ rows: snapshotRows }, { rows: positionRows }, { rows: tradeRows }, portfolio] = await Promise.all([
    query(
      `SELECT s.turn_number, s.total_asset, s.cash, s.debt, s.created_at, gt.trade_date
         FROM session_snapshots s
         JOIN game_turns gt ON gt.session_id = s.session_id AND gt.turn_number = s.turn_number
        WHERE s.session_id = $1 AND s.snapshot_type = 'daily'
        ORDER BY s.turn_number`,
      [sessionId]
    ),
    query(
      `SELECT s.turn_number, a.asset_type, t.asset_id,
              SUM(CASE WHEN t.trade_type = 'buy' THEN t.quantity ELSE -t.quantity END) AS quantity,
              px.close_price
         FROM session_snapshots s
         JOIN game_turns gt ON gt.session_id = s.session_id AND gt.turn_number = s.turn_number
         JOIN trades t ON t.session_id = s.session_id AND t.created_at <= s.created_at
         JOIN assets a ON a.asset_id = t.asset_id
         LEFT JOIN LATERAL (
           SELECT p.close_price
             FROM asset_prices p
            WHERE p.asset_id = t.asset_id AND p.trade_date <= gt.trade_date
            ORDER BY p.trade_date DESC LIMIT 1
         ) px ON TRUE
        WHERE s.session_id = $1 AND s.snapshot_type = 'daily'
        GROUP BY s.turn_number, a.asset_type, t.asset_id, px.close_price
       HAVING ABS(SUM(CASE WHEN t.trade_type = 'buy' THEN t.quantity ELSE -t.quantity END)) > 0.00000001
        ORDER BY s.turn_number, a.asset_type, t.asset_id`,
      [sessionId]
    ),
    query(
      `SELECT flow.created_at, flow.asset_type, flow.trade_type, flow.amount
       FROM (
         SELECT t.created_at, a.asset_type, t.trade_type, t.amount, t.id::bigint AS sort_id
           FROM trades t JOIN assets a ON a.asset_id = t.asset_id
          WHERE t.session_id = $1

         UNION ALL

         SELECT COALESCE(s.purchased_at, s.created_at), 'stock', 'buy',
                s.invested_amount, (s.id::bigint * 2) AS sort_id
           FROM surge_stocks s
          WHERE s.session_id = $1 AND s.invested_amount > 0

         UNION ALL

         SELECT s.resolved_at, 'stock', 'sell',
                s.invested_amount + s.cash_delta, (s.id::bigint * 2 + 1) AS sort_id
           FROM surge_stocks s
          WHERE s.session_id = $1
            AND s.invested_amount > 0
            AND s.resolved = TRUE
            AND s.resolved_at IS NOT NULL
            AND s.cash_delta IS NOT NULL
       ) flow
       ORDER BY flow.created_at, flow.sort_id`,
      [sessionId]
    ),
    getPortfolio(sessionId),
  ]);

  const byTurn = new Map();
  for (const row of positionRows) {
    const turn = Number(row.turn_number);
    if (!byTurn.has(turn)) byTurn.set(turn, { stock: 0, bond: 0, coin: 0 });
    if (row.close_price !== null) {
      byTurn.get(turn)[row.asset_type] += Number(row.quantity) * Number(row.close_price);
    }
  }

  const initialCapital = Number(session.initial_cash);
  const initialDebt = Number(session.debt_initial);
  const points = snapshotRows.map((row) => ({
    turn: Number(row.turn_number),
    createdAt: row.created_at,
    totalAsset: Number(row.total_asset),
    cash: Number(row.cash),
    debt: Number(row.debt),
    byType: byTurn.get(Number(row.turn_number)) || { stock: 0, bond: 0, coin: 0 },
  }));
  if (!points.length || points[0].turn > 1) {
    points.unshift({
      turn: 1,
      createdAt: '1970-01-01T00:00:00.000Z',
      totalAsset: initialCapital,
      cash: initialCapital,
      debt: initialDebt,
      byType: { stock: 0, bond: 0, coin: 0 },
    });
  }

  const currentByType = { stock: 0, bond: 0, coin: 0 };
  for (const holding of portfolio.holdings) currentByType[holding.assetType] += holding.value;
  const currentPoint = {
    turn: Number(session.current_turn),
    createdAt: '9999-12-31T23:59:59.999Z',
    totalAsset: portfolio.totalAsset,
    cash: portfolio.cash,
    debt: portfolio.debt,
    byType: currentByType,
  };
  // 2턴 이후의 마지막 daily 스냅샷은 턴 진입 직후 값이다. 같은 턴 내 거래까지 보이도록
  // 현재 포트폴리오로 치환한다. 1턴은 초기 기준점을 보존한다.
  if (currentPoint.turn > 1) {
    const last = points[points.length - 1];
    if (last.turn === currentPoint.turn) points[points.length - 1] = currentPoint;
    else if (last.turn < currentPoint.turn) points.push(currentPoint);
  }

  const trades = tradeRows.map((row) => ({
    createdAt: row.created_at,
    assetType: row.asset_type,
    netFlow: (row.trade_type === 'buy' ? 1 : -1) * Number(row.amount),
  }));
  const { periods, summary } = buildDashboardPeriods(points, trades, unit, assetType, currentPoint);
  const currentValue = valueForScope(currentPoint, assetType);

  return {
    assetType,
    unit,
    turnsPerBucket: DASHBOARD_BUCKET_SIZE[unit],
    currentTurn: Number(session.current_turn),
    currentValue: Math.round(currentValue),
    summary,
    allocation: buildAllocation(portfolio, assetType),
    periods,
  };
}

module.exports = {
  getCurrentTradeDate,
  evaluateHoldings,
  computeTotalAsset,
  getPortfolio,
  getRealizedPnl,
  getPortfolioHistory,
  getPortfolioDashboard,
  DASHBOARD_UNITS,
  DASHBOARD_ASSET_TYPES,
  buildDashboardPeriods,
};
