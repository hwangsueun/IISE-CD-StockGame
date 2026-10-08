const crypto = require('node:crypto');
const { query, withTransaction } = require('../db');
const { badRequest, conflict, notFound } = require('../utils/errors');
const { quoteTradeAmount, fillOpenOrder } = require('./executionService');
const turnSelector = require('./turnSelector');

function dto(row) {
  return { orderId: row.id, assetId: row.asset_id, name: row.masked_name, tradeType: row.side,
    quantity: Number(row.quantity), referencePrice: Number(row.reference_price), cashBudget: Number(row.cash_budget),
    status: row.status, decisionTurn: row.decision_turn, decisionDate: row.decision_date,
    executionTurn: row.execution_turn, executionDate: row.execution_date,
    filledQuantity: Number(row.filled_quantity), price: row.execution_price == null ? null : Number(row.execution_price),
    amount: row.amount == null ? null : Number(row.amount), reason: row.reason };
}

async function listOrders(sessionId, client) {
  const { rows } = await (client || { query }).query(`SELECT o.*,a.masked_name FROM market_orders o
    JOIN assets a USING(asset_id) WHERE o.session_id=$1 AND o.owner='player' ORDER BY o.id DESC LIMIT 100`, [sessionId]);
  return rows.map(dto);
}

async function submitOrder(sessionId, { assetId, tradeType, quantity, orderKey = crypto.randomUUID() }) {
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || !['buy','sell'].includes(tradeType)) throw badRequest('주식 주문 수량은 양의 정수여야 합니다');
  if (typeof orderKey !== 'string' || orderKey.length > 100 || !orderKey) throw badRequest('주문 식별자가 올바르지 않습니다');
  return withTransaction(async (client) => {
    const { rows: [session] } = await client.query('SELECT * FROM game_sessions WHERE id=$1 FOR UPDATE', [sessionId]);
    if (!session) throw notFound('세션을 찾을 수 없습니다');
    const { rows: [existing] } = await client.query(`SELECT * FROM market_orders WHERE session_id=$1 AND owner='player' AND order_key=$2`, [sessionId, orderKey]);
    if (existing) {
      if (existing.asset_id !== assetId || existing.side !== tradeType || Number(existing.quantity) !== quantity) throw conflict('같은 주문 식별자로 다른 주문을 보낼 수 없습니다');
      return { ...dto(existing), cash: Number(session.cash), replayed: true };
    }
    if (session.status !== 'active') throw conflict('종료된 게임입니다');
    if (session.current_turn <= session.action_locked_until_turn) throw conflict('현재는 투자 행동을 할 수 없습니다');
    if (session.side_job_turn === session.current_turn) throw conflict('부업을 한 턴에는 주문할 수 없습니다');
    const { rows: [turn] } = await client.query('SELECT trade_date FROM game_turns WHERE session_id=$1 AND turn_number=$2', [sessionId, session.current_turn]);
    if (!turn || !await turnSelector.isMarketOpen(turn.trade_date, client)) throw conflict('휴장일에는 새 주문을 예약할 수 없습니다');
    if (!await turnSelector.hasFutureMarketOpen(sessionId, session.current_turn, client)) throw conflict('게임 종료 전 체결 가능한 다음 개장일이 없습니다');
    const { rows: [asset] } = await client.query(`SELECT a.*,p.close_price,d.open_price FROM assets a
      LEFT JOIN asset_prices p ON p.asset_id=a.asset_id AND p.trade_date=$2
      LEFT JOIN stock_price_detail d ON d.asset_id=a.asset_id AND d.trade_date=$2
      WHERE a.asset_id=$1 AND a.is_active=TRUE`, [assetId, turn.trade_date]);
    if (!asset) throw badRequest('유효하지 않은 자산입니다');
    if (asset.asset_type !== 'stock') throw conflict('시가 데이터가 없는 채권·코인은 주문을 지원하지 않습니다');
    if (!(Number(asset.open_price) > 0) || !(Number(asset.close_price) > 0)) throw conflict('현재 거래 가능한 시가·종가 데이터가 없습니다');
    if ((asset.listed_from && turn.trade_date < asset.listed_from) || (asset.listed_to && turn.trade_date > asset.listed_to)) throw conflict('상장 기간 밖의 종목입니다');
    const { rows: pending } = await client.query(`SELECT * FROM market_orders WHERE session_id=$1 AND owner='player' AND status='pending'`, [sessionId]);
    if (pending.some(o => o.asset_id === assetId)) throw conflict('이 종목의 대기 주문을 먼저 취소해 주세요');
    const { rows: [held] } = await client.query('SELECT quantity FROM holdings WHERE session_id=$1 AND asset_id=$2', [sessionId, assetId]);
    const referencePrice = Number(asset.close_price);
    const budget = tradeType === 'buy' ? quoteTradeAmount('buy', referencePrice, quantity) : 0;
    const buyingPower = Number(session.cash) - pending.filter(o => o.side === 'buy').reduce((sum,o) => sum+Number(o.cash_budget),0)
      + pending.filter(o => o.side === 'sell').reduce((sum,o) => sum+quoteTradeAmount('sell',Number(o.reference_price),Number(o.quantity)),0);
    if (tradeType === 'buy' && budget > buyingPower) throw conflict('예약 가능한 예산이 부족합니다', { availableBudget: Math.max(0,buyingPower) });
    if (tradeType === 'sell' && quantity > Number(held?.quantity || 0)) throw conflict('보유수량이 부족합니다');
    const { rows: [order] } = await client.query(`INSERT INTO market_orders
      (session_id,owner,order_key,asset_id,side,decision_turn,decision_date,quantity,reference_price,cash_budget)
      VALUES ($1,'player',$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [sessionId,orderKey,assetId,tradeType,session.current_turn,turn.trade_date,quantity,referencePrice,budget]);
    return { ...dto(order), cash: Number(session.cash) };
  });
}

async function cancelOrder(sessionId, orderId) {
  return withTransaction(async client => {
    await client.query('SELECT id FROM game_sessions WHERE id=$1 FOR UPDATE', [sessionId]);
    const { rows: [order] } = await client.query(`UPDATE market_orders SET status='cancelled',reason='user_cancelled',updated_at=NOW()
      WHERE id=$2 AND session_id=$1 AND owner='player' AND status='pending' RETURNING *`, [sessionId,orderId]);
    if (!order) throw conflict('취소 가능한 대기 주문이 없습니다');
    return dto(order);
  });
}

async function cancelAtEnd(client, sessionId) {
  await client.query(`UPDATE market_orders SET status='cancelled',reason='game_ended',updated_at=NOW()
    WHERE session_id=$1 AND status='pending'`, [sessionId]);
}

async function settlePendingOrders(client, session, date, marketOpen) {
  if (!marketOpen) return [];
  const { rows: orders } = await client.query(`SELECT o.*,a.listed_from,a.listed_to,d.open_price FROM market_orders o
    JOIN assets a USING(asset_id) LEFT JOIN stock_price_detail d ON d.asset_id=o.asset_id AND d.trade_date=$2
    WHERE o.session_id=$1 AND o.owner='player' AND o.status='pending' AND o.decision_turn<$3
    ORDER BY CASE o.side WHEN 'sell' THEN 0 ELSE 1 END,o.asset_id,o.id FOR UPDATE OF o`, [session.id,date,session.current_turn]);
  const results=[];
  for (const order of orders) {
    const { rows: [held] } = await client.query('SELECT quantity,avg_price FROM holdings WHERE session_id=$1 AND asset_id=$2 FOR UPDATE', [session.id,order.asset_id]);
    const listed = (!order.listed_from || date >= order.listed_from) && (!order.listed_to || date <= order.listed_to);
    const fill = fillOpenOrder({ side: order.side, quantity: Number(order.quantity), cashBudget: Number(order.cash_budget) },
      { openPrice: listed ? Number(order.open_price) : NaN, cash: Number(session.cash), heldQuantity: Number(held?.quantity || 0), avgPrice: Number(held?.avg_price || 0) });
    if (fill.filledQuantity > 0) {
      const oldQuantity=Number(held?.quantity || 0);
      const oldAverage=Number(held?.avg_price || 0);
      const nextQuantity=oldQuantity + (order.side === 'buy' ? fill.filledQuantity : -fill.filledQuantity);
      if (nextQuantity === 0) await client.query('DELETE FROM holdings WHERE session_id=$1 AND asset_id=$2', [session.id,order.asset_id]);
      else await client.query(`INSERT INTO holdings(session_id,asset_id,quantity,avg_price) VALUES($1,$2,$3,$4)
        ON CONFLICT(session_id,asset_id) DO UPDATE SET quantity=$3,avg_price=$4`,
      [session.id,order.asset_id,nextQuantity,order.side === 'buy' ? (oldQuantity*oldAverage+fill.filledQuantity*fill.price)/nextQuantity : oldAverage]);
      session.cash=Number(session.cash)+(order.side === 'buy' ? -fill.amount : fill.amount);
      await client.query(`INSERT INTO trades(session_id,turn_number,asset_id,trade_type,quantity,price,amount,realized_pnl,order_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [session.id,session.current_turn,order.asset_id,order.side,fill.filledQuantity,fill.price,fill.amount,fill.realizedPnl,order.id]);
    }
    const { rows: [updated] } = await client.query(`UPDATE market_orders SET status=$2,execution_turn=$3,execution_date=$4,
      filled_quantity=$5,execution_price=$6,amount=$7,realized_pnl=$8,reason=$9,updated_at=NOW() WHERE id=$1 RETURNING *`,
    [order.id,fill.status,session.current_turn,date,fill.filledQuantity,fill.price,fill.amount,fill.realizedPnl,fill.reason]);
    results.push(dto(updated));
  }
  return results;
}

module.exports = { submitOrder, listOrders, cancelOrder, cancelAtEnd, settlePendingOrders };
