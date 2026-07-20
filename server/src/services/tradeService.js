// 거래 검증/체결/평균단가/실현손익 (ARCHITECTURE.md §9-3)
// 모든 계산은 서버 권위. 프론트 금액은 신뢰하지 않는다.
const { withTransaction } = require('../db');
const { badRequest, conflict } = require('../utils/errors');
const { roundTradeAmount } = require('../utils/money');
const C = require('../config/constants');
const pricingService = require('./pricingService');
const coinUniverseService = require('./coinUniverseService');

/**
 * 코인 수량 검증: 최소 거래 단위(C.COIN_MIN_TRADE_UNIT) 이상 + 그 배수 +
 * 소수 자릿수 상한(C.COIN_MAX_DECIMALS) 이내. 극소수량(예: 1e-18) 거래로
 * 평가액 계산에 부동소수 노이즈가 끼는 것을 막는다.
 * 배율 정수화 후 비교해 부동소수 표현 오차(예: 0.1+0.2 문제)를 피한다.
 */
function assertCoinQuantity(quantity) {
  const unit = C.COIN_MIN_TRADE_UNIT;
  const maxDecimals = C.COIN_MAX_DECIMALS;
  if (quantity < unit) {
    throw badRequest(`코인 최소 거래 수량은 ${unit} 이상이어야 합니다`);
  }
  const scale = 10 ** maxDecimals;
  const scaledQty = quantity * scale;
  const roundedQty = Math.round(scaledQty);
  if (Math.abs(scaledQty - roundedQty) > 1e-6) {
    throw badRequest(`코인 수량은 소수 ${maxDecimals}자리까지만 가능합니다`);
  }
  const scaledUnit = Math.round(unit * scale);
  if (scaledUnit > 0 && roundedQty % scaledUnit !== 0) {
    throw badRequest(`코인 수량은 최소 거래 단위(${unit})의 배수여야 합니다`);
  }
}

/**
 * 매수/매도 체결.
 * - 현재 턴의 trade_date 종가로 체결한다.
 * - 주식/채권은 정수 수량, 코인은 최소 거래 단위 이상의 소수를 허용한다.
 * - 상장기간(assets.listed_from/listed_to) 밖이면 거래를 차단한다 (coin_info 조인 없음, 003).
 * - 행동제한(기절/입원) 중이면 거래 불가.
 */
async function executeTrade(sessionId, { assetId, tradeType, quantity }) {
  // 수량 1차 검증: 자산 타입과 무관하게 유한한 양수여야 한다. 이 단계는 DB 조회 전에
  // 걸러내 불필요한 트랜잭션/행잠금을 열지 않는다. 코인은 assetType을 알아야
  // 최소단위/소수자릿수를 검증할 수 있으므로 트랜잭션 안에서 이어서 검증한다.
  // (DB의 CHECK(quantity > 0)가 최종 방어선이지만, 그전에 400으로 명확히 거절해야
  //  NaN/Infinity 등이 500 제약조건 위반으로 새지 않는다.)
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
    throw badRequest('quantity는 0보다 큰 유한한 숫자여야 합니다');
  }
  // tradeType도 서비스 레이어에서 재확인한다: 아래 로직은 'buy'가 아니면 전부 매도로 취급하므로
  // (컨트롤러를 거치지 않는 향후 호출 경로가 생기면) 오타/이상값이 조용히 매도로 처리될 수 있다.
  if (tradeType !== 'buy' && tradeType !== 'sell') {
    throw badRequest("tradeType은 'buy' 또는 'sell'이어야 합니다");
  }

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
    // 부업한 날에는 투자 불가 (중간보고서 §4.5)
    if (session.side_job_turn === session.current_turn) {
      throw conflict('부업한 날에는 투자할 수 없습니다');
    }

    // 자산 조회: 상장기간도 함께 확보한다. coin_info는 조인하지 않는다 —
    // listed_from/listed_to가 전 자산 공통 단일 기준이다 (migration 003).
    const { rows: aRows } = await client.query(
      `SELECT asset_id, asset_type, listed_from, listed_to
       FROM assets WHERE asset_id = $1 AND is_active = TRUE`,
      [assetId]
    );
    if (!aRows[0]) throw badRequest('유효하지 않은 자산입니다');
    const { asset_type: assetType, listed_from: listedFrom, listed_to: listedTo } = aRows[0];

    // 세션 코인 유니버스 게이트 (migration 005): 코인은 세션 시작 시 층화추출된 20개만 매수
    // 가능하다. 매도는 의도적으로 게이트하지 않는다 — 이 비대칭은 정상 흐름 보호 목적이다.
    // 정상 흐름에서는 매수 자체가 막히므로 유니버스 밖 코인을 보유하게 될 일이 없지만,
    // 혹시라도(과거 세션 잔여 데이터, 향후 유니버스 로직 변경 등) 어떤 경위로 유니버스 밖
    // 코인을 보유한 상태가 생기면 매도까지 막았을 때 그 자금이 영구히 묶여버린다.
    // 주식/채권은 전역 자산이라 이 게이트와 무관하다(assetType === 'coin'일 때만 적용).
    if (assetType === 'coin' && tradeType === 'buy') {
      const universeIds = await coinUniverseService.getSessionCoinIds(sessionId, client);
      if (!universeIds.includes(assetId)) {
        throw conflict('이 세션에서 거래할 수 없는 코인입니다 (세션 유니버스 밖)', { assetId });
      }
    }

    if (assetType === 'coin') {
      assertCoinQuantity(quantity);
    } else if (!Number.isInteger(quantity)) {
      throw badRequest('주식/채권은 정수 수량만 가능합니다');
    }

    // 현재 턴 날짜의 종가로 체결
    const { rows: tRows } = await client.query(
      `SELECT trade_date FROM game_turns WHERE session_id = $1 AND turn_number = $2`,
      [sessionId, session.current_turn]
    );
    const tradeDate = tRows[0].trade_date;

    // 상장기간 검증 (NULL = 제약 없음). 시세 NULL(휴장/결측)과 원인을 구분할 수 있도록
    // getPriceAt 조회보다 먼저 확인한다 — 상장 전/폐지는 데이터 결측과 다른 문제다.
    if (listedFrom && tradeDate < listedFrom) {
      throw conflict('아직 상장되지 않은 자산입니다 (상장일 이전)', { listedFrom });
    }
    if (listedTo && tradeDate > listedTo) {
      throw conflict('상장폐지된 자산입니다 (더 이상 거래할 수 없습니다)', { listedTo });
    }

    const price = await pricingService.getPriceAt(assetId, tradeDate, client);
    if (price === null) throw conflict('오늘은 이 자산의 시세가 없습니다 (휴장일 등 데이터 결측)');

    const fee = 0; // C.TRADE_FEE_RATE 적용 지점 (밸런싱 시 활성화)
    // 체결금액 반올림: 매수는 올림/매도는 내림 (utils/money.js 규칙 참조).
    // trades.amount와 game_sessions.cash가 항상 정수 KRW로 정합하도록 여기서 한 번만 반올림한다.
    const rawAmount = price * quantity * (1 + (tradeType === 'buy' ? fee : -fee));
    const amount = roundTradeAmount(tradeType, rawAmount);

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
      // 실현손익 = 반올림된 실입금액 - 매도분 원가. price 원값이 아닌 amount(반올림 후)
      // 기준으로 계산해야 trades.realized_pnl 합계가 실제 현금 흐름과 어긋나지 않는다.
      realizedPnl = amount - avgPrice * quantity;
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

    const amount = roundTradeAmount('sell', price * quantity); // 강제청산도 매도이므로 내림
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
