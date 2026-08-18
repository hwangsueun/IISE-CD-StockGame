// 급등주 이벤트 (미팅5 §4, 기능명세서 §이벤트/급등주)
// 흐름: 스트레스 구간별 확률로 당일 장에 임시 작전주 등장
//   -> 플레이어 매수(1개 이상의 정수 수량)/관망 선택
//   -> 다음 개장 턴에 결과 공개 (수익률 구간별 자산/스트레스 변화)
//   -> 작전주는 자동 매도 후 시장에서 제거
const { query } = require('../db');
const { badRequest, conflict, notFound } = require('../utils/errors');
const C = require('../config/constants');
const stressPolicy = require('./stressPolicy');
const { clamp100 } = require('../utils/clamp');

/** 스트레스 구간별 발생 확률 (입원 중 발생 불가 — eventEngine 트리거에서 차단) */
function spawnProb(stress) {
  const band = stressPolicy.bandFor(stress).band;
  return C.SURGE_STOCK.PROB_BY_BAND[band] ?? 0;
}

/** 급등주 등장 (eventEngine의 surge_stock 트리거 안에서 호출, 같은 트랜잭션) */
async function spawn(client, session, random = Math.random) {
  // 한 세션에는 아직 정산되지 않은 이벤트성 종목이 하나만 존재해야 한다.
  // advanceTurn이 세션 행을 잠그지만, 이 서비스 자체도 중복 생성을 fail-close 한다.
  const { rows: activeRows } = await client.query(
    `SELECT id FROM surge_stocks
     WHERE session_id = $1 AND resolved = FALSE
     ORDER BY id DESC LIMIT 1 FOR UPDATE`,
    [session.id]
  );
  if (activeRows[0]) throw conflict('이미 진행 중인 급등주 이벤트가 있습니다');

  const name = C.SURGE_STOCK.NAMES[Math.floor(random() * C.SURGE_STOCK.NAMES.length)];
  const buyPrice = 1000 * (1 + Math.floor(random() * 50)); // 1,000~50,000원 이벤트 가격
  const { rows } = await client.query(
    `INSERT INTO surge_stocks (session_id, spawn_turn, display_name, buy_price)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [session.id, session.current_turn, name, buyPrice]
  );
  return { surgeStockId: rows[0].id, displayName: name, buyPrice, spawnTurn: session.current_turn };
}

/** 당일 매수 가능한(미해결) 급등주 조회 */
async function getActive(sessionId) {
  const { rows } = await query(
    `SELECT s.*, g.current_turn, g.cash, g.status,
            g.action_locked_until_turn, g.side_job_turn,
            EXISTS (
              SELECT 1 FROM asset_prices p
              JOIN assets a ON a.asset_id = p.asset_id
              WHERE p.trade_date = gt.trade_date AND a.asset_type = 'stock'
            ) AS market_open,
            EXISTS (
              SELECT 1 FROM game_turns future_gt
              WHERE future_gt.session_id = g.id
                AND future_gt.turn_number > g.current_turn
                AND EXISTS (
                  SELECT 1 FROM asset_prices future_p
                  JOIN assets future_a ON future_a.asset_id = future_p.asset_id
                  WHERE future_p.trade_date = future_gt.trade_date
                    AND future_a.asset_type = 'stock'
                )
            ) AS has_future_market_open
     FROM surge_stocks s JOIN game_sessions g ON g.id = s.session_id
     JOIN game_turns gt ON gt.session_id = g.id AND gt.turn_number = g.current_turn
     WHERE s.session_id = $1 AND s.resolved = FALSE
     ORDER BY s.id DESC LIMIT 1`,
    [sessionId]
  );
  const s = rows[0];
  if (!s) return null;
  const buyPrice = Number(s.buy_price);
  const cash = Number(s.cash);
  const quantity = Number(s.quantity);
  const currentTurn = Number(s.current_turn);
  const spawnTurn = Number(s.spawn_turn);
  const maxBuyQuantity = buyPrice > 0 ? Math.floor(cash / buyPrice) : 0;
  return {
    surgeStockId: s.id,
    displayName: s.display_name,
    spawnTurn,
    buyPrice,
    quantity,
    investedAmount: Number(s.invested_amount),
    maxBuyQuantity,
    marketOpen: s.market_open === true,
    hasFutureMarketOpen: s.has_future_market_open === true,
    canBuy:
      s.status === 'active' &&
      s.market_open === true &&
      s.has_future_market_open === true &&
      spawnTurn === currentTurn &&
      currentTurn > Number(s.action_locked_until_turn) &&
      Number(s.side_job_turn) !== currentTurn &&
      quantity === 0 &&
      Number(s.invested_amount) === 0 &&
      maxBuyQuantity >= 1,
  };
}

/** 매수 (정수 수량 입력). 관망은 매수 API를 호출하지 않으면 된다. */
async function buy(sessionId, surgeStockId, quantity, client) {
  const q = client || { query };
  if (!Number.isSafeInteger(surgeStockId) || surgeStockId <= 0) {
    throw badRequest('surgeStockId는 1 이상의 정수여야 합니다');
  }
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw badRequest('quantity는 1 이상의 정수여야 합니다');
  }

  const { rows } = await q.query(
    `SELECT s.*, g.cash, g.current_turn, g.status,
            g.action_locked_until_turn, g.side_job_turn,
            EXISTS (
              SELECT 1 FROM asset_prices p
              JOIN assets a ON a.asset_id = p.asset_id
              WHERE p.trade_date = gt.trade_date AND a.asset_type = 'stock'
            ) AS market_open,
            EXISTS (
              SELECT 1 FROM game_turns future_gt
              WHERE future_gt.session_id = g.id
                AND future_gt.turn_number > g.current_turn
                AND EXISTS (
                  SELECT 1 FROM asset_prices future_p
                  JOIN assets future_a ON future_a.asset_id = future_p.asset_id
                  WHERE future_p.trade_date = future_gt.trade_date
                    AND future_a.asset_type = 'stock'
                )
            ) AS has_future_market_open
     FROM surge_stocks s JOIN game_sessions g ON g.id = s.session_id
     JOIN game_turns gt ON gt.session_id = g.id AND gt.turn_number = g.current_turn
     WHERE s.id = $1 AND s.session_id = $2
     FOR UPDATE OF s, g`,
    [surgeStockId, sessionId]
  );
  const s = rows[0];
  if (!s) throw notFound('급등주를 찾을 수 없습니다');
  if (s.status !== 'active') throw conflict('종료된 게임입니다');
  if (s.resolved) throw conflict('이미 종료된 급등주입니다');
  if (s.market_open !== true) throw conflict('오늘은 휴장일이라 급등주를 매수할 수 없습니다');
  if (s.has_future_market_open !== true) {
    throw conflict('게임 종료 전 정산 가능한 개장일이 없습니다');
  }
  if (Number(s.spawn_turn) !== Number(s.current_turn)) throw conflict('매수 가능 시간이 지났습니다');
  if (Number(s.current_turn) <= Number(s.action_locked_until_turn)) {
    throw conflict('현재 턴에는 투자 행동을 할 수 없습니다');
  }
  if (Number(s.side_job_turn) === Number(s.current_turn)) {
    throw conflict('부업을 한 턴에는 투자할 수 없습니다');
  }

  const buyPrice = Number(s.buy_price);
  const cash = Number(s.cash);
  const totalAmount = buyPrice * quantity;
  if (!Number.isSafeInteger(buyPrice) || buyPrice <= 0 || !Number.isSafeInteger(totalAmount)) {
    throw conflict('급등주 체결 금액을 계산할 수 없습니다');
  }
  const existingQuantity = Number(s.quantity);
  const existingAmount = Number(s.invested_amount);
  if (existingQuantity > 0 || existingAmount > 0) {
    // 같은 수량 요청의 응답만 유실된 경우에는 현금을 다시 차감하지 않고 확정 결과를 재전송한다.
    if (existingQuantity === quantity && existingAmount === totalAmount) {
      return {
        surgeStockId,
        quantity: existingQuantity,
        buyPrice,
        totalAmount: existingAmount,
        cashAfter: cash,
        replayed: true,
      };
    }
    throw conflict('이미 다른 수량으로 매수했습니다');
  }
  const maxBuyQuantity = Math.floor(cash / buyPrice);
  if (quantity > maxBuyQuantity) {
    throw conflict('현금이 부족합니다', { cash, buyPrice, maxBuyQuantity });
  }

  const bought = await q.query(
    `UPDATE surge_stocks
     SET quantity = $2, invested_amount = $3, purchased_at = NOW()
     WHERE id = $1 AND resolved = FALSE AND quantity = 0 AND invested_amount = 0
     RETURNING id`,
    [surgeStockId, quantity, totalAmount]
  );
  if (!bought.rows[0]) throw conflict('이미 매수했거나 종료된 급등주입니다');

  const debited = await q.query(
    `UPDATE game_sessions
     SET cash = cash - $2, updated_at = NOW()
     WHERE id = $1 AND status = 'active' AND cash >= $2
     RETURNING cash`,
    [sessionId, totalAmount]
  );
  if (!debited.rows[0]) throw conflict('현금이 부족합니다', { cash, buyPrice, maxBuyQuantity });

  return {
    surgeStockId,
    quantity,
    buyPrice,
    totalAmount,
    cashAfter: Number(debited.rows[0].cash),
  };
}

/** 결과 가중치 추첨 */
function rollOutcome(random = Math.random) {
  const outcomes = C.SURGE_STOCK.OUTCOMES;
  const total = outcomes.reduce((s, o) => s + o.weight, 0);
  let r = random() * total;
  for (const o of outcomes) {
    r -= o.weight;
    if (r <= 0) return o;
  }
  return outcomes[outcomes.length - 1];
}

/**
 * 다음 개장 턴 진행 시 미해결 급등주 정산 (turnService.advanceTurn 트랜잭션 안에서 호출)
 * - 매수분: 수익률 추첨 -> 자동 매도 정산 + 스트레스 반영
 * - 관망분: 결과 추첨 없이 관망 상태로 정리
 * @returns 정산 결과 목록
 */
async function resolvePending(client, session, random = Math.random, marketOpen = false) {
  if (marketOpen !== true) return [];
  const { rows } = await client.query(
    `SELECT * FROM surge_stocks
     WHERE session_id = $1 AND resolved = FALSE AND spawn_turn < $2
     ORDER BY id FOR UPDATE`,
    [session.id, session.current_turn]
  );
  const results = [];
  for (const s of rows) {
    const invested = Number(s.invested_amount);
    const quantity = Number(s.quantity);

    if (invested <= 0) {
      await client.query(
        `UPDATE surge_stocks
         SET resolved = TRUE, resolved_at = NOW(),
             outcome = 'skipped', return_rate = 0, cash_delta = 0, stress_delta = 0
         WHERE id = $1 AND resolved = FALSE`,
        [s.id]
      );
      results.push({
        surgeStockId: s.id,
        displayName: s.display_name,
        purchased: false,
        quantity: 0,
        buyPrice: Number(s.buy_price),
        investedAmount: 0,
        outcome: 'skipped',
        returnRate: 0,
        proceeds: 0,
        pnl: 0,
        stressDelta: 0,
      });
      continue;
    }

    const outcome = rollOutcome(random);
    const ret = outcome.retMin + random() * (outcome.retMax - outcome.retMin);
    const proceeds = Math.round(invested * (1 + ret));
    const pnl = proceeds - invested;
    const stressDelta = outcome.stressDelta;

    await client.query(
      `UPDATE surge_stocks
       SET resolved = TRUE, resolved_at = NOW(),
           outcome = $2, return_rate = $3, cash_delta = $4, stress_delta = $5
       WHERE id = $1 AND resolved = FALSE`,
      [s.id, outcome.key, ret, pnl, stressDelta]
    );
    session.cash = Number(session.cash) + proceeds; // 매수 원금은 이미 차감되어 정산액 전액 입금
    session.stress = clamp100(Number(session.stress) + stressDelta);
    await client.query(
      `INSERT INTO event_log (session_id, turn_number, event_type, detail, cash_delta, stress_delta, resolved)
       VALUES ($1, $2, 'surge_stock_result', $3, $4, $5, TRUE)`,
      [session.id, session.current_turn,
       JSON.stringify({
         surgeStockId: s.id,
         displayName: s.display_name,
         quantity,
         buyPrice: Number(s.buy_price),
         investedAmount: invested,
         outcome: outcome.key,
         returnRate: ret,
         proceeds,
         pnl,
       }),
       pnl, stressDelta]
    );
    results.push({
      surgeStockId: s.id,
      displayName: s.display_name,
      purchased: true,
      quantity,
      buyPrice: Number(s.buy_price),
      investedAmount: invested,
      outcome: outcome.key,
      returnRate: ret,
      proceeds,
      pnl,
      stressDelta,
    });
  }
  return results;
}

/**
 * 최종 턴을 넘긴 레거시 세션의 미정산 급등주를 중립 정리한다.
 * 매수분은 손익 없이 원금만 환급하고, 관망분은 skipped 처리한다.
 */
async function closePendingAtGameEnd(client, session) {
  const { rows } = await client.query(
    `SELECT * FROM surge_stocks
     WHERE session_id = $1 AND resolved = FALSE
     ORDER BY id FOR UPDATE`,
    [session.id]
  );
  const results = [];

  for (const s of rows) {
    const invested = Number(s.invested_amount);
    const quantity = Number(s.quantity);
    const purchased = invested > 0;
    const outcome = purchased ? 'cancelled' : 'skipped';

    await client.query(
      `UPDATE surge_stocks
       SET resolved = TRUE, resolved_at = NOW(),
           outcome = $2, return_rate = 0, cash_delta = 0, stress_delta = 0
       WHERE id = $1 AND resolved = FALSE`,
      [s.id, outcome]
    );

    if (purchased) {
      session.cash = Number(session.cash) + invested;
      await client.query(
        `INSERT INTO event_log (session_id, turn_number, event_type, detail, cash_delta, stress_delta, resolved)
         VALUES ($1, $2, 'surge_stock_result', $3, 0, 0, TRUE)`,
        [session.id, session.current_turn,
         JSON.stringify({
           surgeStockId: s.id,
           displayName: s.display_name,
           quantity,
           buyPrice: Number(s.buy_price),
           investedAmount: invested,
           outcome,
           returnRate: 0,
           proceeds: invested,
           pnl: 0,
           reason: 'game_end',
         })]
      );
    }

    results.push({
      surgeStockId: s.id,
      displayName: s.display_name,
      purchased,
      quantity: purchased ? quantity : 0,
      buyPrice: Number(s.buy_price),
      investedAmount: purchased ? invested : 0,
      outcome,
      returnRate: 0,
      proceeds: purchased ? invested : 0,
      pnl: 0,
      stressDelta: 0,
    });
  }
  return results;
}

module.exports = {
  spawnProb,
  spawn,
  getActive,
  buy,
  resolvePending,
  closePendingAtGameEnd,
  rollOutcome,
};
