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

/** 총자산 = 현금 + 보유자산 평가액 */
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

module.exports = { getCurrentTradeDate, evaluateHoldings, computeTotalAsset, getPortfolio };
