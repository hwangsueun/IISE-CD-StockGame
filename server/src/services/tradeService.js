// Orders are queued at the close and settled by orderService at a later open.
const { quoteTradeAmount } = require('./executionService');
const pricingService = require('./pricingService');

async function executeTrade(sessionId, order) {
  return require('./orderService').submitOrder(sessionId, order);
}

/**
 * 상장폐지 강제청산 (ARCHITECTURE.md §9-2, migration 003 §4).
 * turnService.advanceTurn이 다음 턴 가격 조회 직후 / 보유자산 평가 이전에,
 * 자신의 단일 트랜잭션 안에서 호출한다 (별도 트랜잭션 아님).
 *
 * 대상: 다음 턴 거래일(nextTradeDate)이 assets.listed_to를 지난 보유자산 전부.
 * 체결가: listed_to 날짜의 close_price (마지막 시세). 그 날짜에 정확한 시세가
 * 없으면(데이터 결측) listed_to 이전 최신 종가로 대체하고 경고 로그를 남긴다.
 * 최후 수단으로도 못 찾으면 avg_price로 대체한다(실현손익 0으로 청산, 게임 진행은 막지 않음).
 *
 * session.cash/stress 등은 turnService의 다른 단계들과 동일하게 in-memory로만 갱신한다.
 * 최종 영속화는 advanceTurn 마지막의 단일 UPDATE가 담당한다 (surgeStockService.resolvePending과 동일 패턴).
 *
 * @returns {Array} 청산 결과 목록 (없으면 빈 배열)
 */
async function liquidateDelisted(client, session, nextTradeDate) {
  const { rows } = await client.query(
    `SELECT h.asset_id, h.quantity, h.avg_price,
            a.asset_type, a.masked_name AS name, a.listed_to
     FROM holdings h
     JOIN assets a ON a.asset_id = h.asset_id
     WHERE h.session_id = $1 AND a.listed_to IS NOT NULL AND a.listed_to < $2
     FOR UPDATE OF h`,
    [session.id, nextTradeDate]
  );

  const results = [];
  for (const row of rows) {
    const quantity = Number(row.quantity);
    const avgPrice = Number(row.avg_price);

    let price = await pricingService.getPriceAt(row.asset_id, row.listed_to, client);
    if (price === null) {
      // listed_to 당일 종가가 비어 있는 데이터 결측 방어: 그 이전 최신 종가로 대체.
      const { rows: fallback } = await client.query(
        `SELECT close_price FROM asset_prices
         WHERE asset_id = $1 AND trade_date <= $2
         ORDER BY trade_date DESC LIMIT 1`,
        [row.asset_id, row.listed_to]
      );
      price = fallback[0] ? Number(fallback[0].close_price) : avgPrice;
      console.warn(
        `[tradeService.liquidateDelisted] ${row.asset_id}: listed_to(${row.listed_to}) 종가 없음. ` +
        `대체가 ${price} 사용 (session ${session.id})`
      );
    }

    const amount = quoteTradeAmount('sell', price, quantity); // 강제청산도 공통 매도 규칙
    const realizedPnl = amount - avgPrice * quantity;

    await client.query(`DELETE FROM holdings WHERE session_id = $1 AND asset_id = $2`, [session.id, row.asset_id]);

    const { rows: tradeRows } = await client.query(
      `INSERT INTO trades (session_id, turn_number, asset_id, trade_type, quantity, price, amount, realized_pnl, is_forced)
       VALUES ($1, $2, $3, 'sell', $4, $5, $6, $7, TRUE) RETURNING id`,
      [session.id, session.current_turn, row.asset_id, quantity, price, amount, realizedPnl]
    );

    session.cash = Number(session.cash) + amount;

    await client.query(
      `INSERT INTO event_log (session_id, turn_number, event_type, detail, cash_delta, resolved)
       VALUES ($1, $2, 'asset_delisted', $3, $4, TRUE)`,
      [
        session.id, session.current_turn,
        JSON.stringify({
          assetId: row.asset_id,
          name: row.name, // masked_name — 원 회사명 노출 금지 규칙 준수
          assetType: row.asset_type,
          quantity,
          price,
          amount,
          realizedPnl,
          listedTo: row.listed_to,
          message: `${row.name}이(가) 상장폐지되어 보유 수량이 자동 청산되었습니다.`,
        }),
        amount,
      ]
    );

    results.push({
      tradeId: tradeRows[0].id,
      assetId: row.asset_id,
      name: row.name,
      assetType: row.asset_type,
      quantity,
      price,
      amount,
      realizedPnl,
    });
  }
  return results;
}

module.exports = { executeTrade, liquidateDelisted };
