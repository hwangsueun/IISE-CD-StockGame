// 거래 검증/체결/평균단가/실현손익 (ARCHITECTURE.md §9-3)
// 모든 계산은 서버 권위. 프론트 금액은 신뢰하지 않는다.
const { withTransaction } = require('../db');
const { badRequest, conflict } = require('../utils/errors');
const pricingService = require('./pricingService');

/**
 * 매수/매도 체결.
 * - 현재 턴의 trade_date 종가로 체결한다.
 * - 주식/채권은 정수 수량, 코인은 소수 허용.
 * - 행동제한(기절/입원) 중이면 거래 불가.
 */
async function executeTrade(sessionId, { assetId, tradeType, quantity }) {
  return withTransaction(async (client) => {
    // 세션 행 잠금 (동시 요청 방지)
    const { rows: sRows } = await client.query(
      `SELECT * FROM game_sessions WHERE id = $1 FOR UPDATE`,
      [sessionId]
    );
    const session = sRows[0];
    if (!session) throw badRequest('세션을 찾을 수 없습니다');
    if (session.status !== 'active') throw conflict('종료된 게임입니다');
    if (session.current_turn <= session.action_locked_until_turn) {
      throw conflict('행동제한 중입니다 (기절/입원)', {
        lockedUntilTurn: session.action_locked_until_turn,
      });
    }

    // 자산/수량 검증
    const { rows: aRows } = await client.query(
      `SELECT asset_id, asset_type FROM assets WHERE asset_id = $1 AND is_active = TRUE`,
      [assetId]
    );
    if (!aRows[0]) throw badRequest('유효하지 않은 자산입니다');
    const assetType = aRows[0].asset_type;
    if (assetType !== 'coin' && !Number.isInteger(quantity)) {
      throw badRequest('주식/채권은 정수 수량만 가능합니다');
    }

    // 현재 턴 날짜의 종가로 체결
    const { rows: tRows } = await client.query(
      `SELECT trade_date FROM game_turns WHERE session_id = $1 AND turn_number = $2`,
      [sessionId, session.current_turn]
    );
    const tradeDate = tRows[0].trade_date;
    const price = await pricingService.getPriceAt(assetId, tradeDate, client);
    if (price === null) throw conflict('오늘은 이 자산의 시세가 없습니다 (상장 전/폐지)');

    const fee = 0; // C.TRADE_FEE_RATE 적용 지점 (밸런싱 시 활성화)
    const amount = price * quantity * (1 + (tradeType === 'buy' ? fee : -fee));

    // 보유 현황
    const { rows: hRows } = await client.query(
      `SELECT quantity, avg_price FROM holdings WHERE session_id = $1 AND asset_id = $2 FOR UPDATE`,
      [sessionId, assetId]
    );
    const held = hRows[0] ? Number(hRows[0].quantity) : 0;
    const avgPrice = hRows[0] ? Number(hRows[0].avg_price) : 0;

    let realizedPnl = null;
    let newCash = Number(session.cash);

    if (tradeType === 'buy') {
      if (amount > newCash) throw conflict('현금이 부족합니다', { cash: newCash, required: amount });
      const newQty = held + quantity;
      const newAvg = (held * avgPrice + quantity * price) / newQty;
      await client.query(
        `INSERT INTO holdings (session_id, asset_id, quantity, avg_price)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (session_id, asset_id) DO UPDATE SET quantity = $3, avg_price = $4`,
        [sessionId, assetId, newQty, newAvg]
      );
      newCash -= amount;
    } else {
      if (quantity > held) throw conflict('보유수량이 부족합니다', { held });
      realizedPnl = (price - avgPrice) * quantity;
      const newQty = held - quantity;
      if (newQty === 0) {
        await client.query(`DELETE FROM holdings WHERE session_id = $1 AND asset_id = $2`, [sessionId, assetId]);
      } else {
        await client.query(
          `UPDATE holdings SET quantity = $3 WHERE session_id = $1 AND asset_id = $2`,
          [sessionId, assetId, newQty]
        );
      }
      newCash += amount;
    }

    await client.query(
      `UPDATE game_sessions SET cash = $2, updated_at = NOW() WHERE id = $1`,
      [sessionId, Math.round(newCash)]
    );
    const { rows: tradeRows } = await client.query(
      `INSERT INTO trades (session_id, turn_number, asset_id, trade_type, quantity, price, amount, realized_pnl)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [sessionId, session.current_turn, assetId, tradeType, quantity, price, amount, realizedPnl]
    );

    return {
      tradeId: tradeRows[0].id,
      assetId,
      tradeType,
      quantity,
      price,
      amount,
      realizedPnl,
      cash: Math.round(newCash),
    };
  });
}

module.exports = { executeTrade };
