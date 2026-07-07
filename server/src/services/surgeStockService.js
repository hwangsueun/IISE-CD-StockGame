// 급등주 이벤트 (미팅5 §4, 기능명세서 §이벤트/급등주)
// 흐름: 스트레스 구간별 확률로 당일 장에 임시 작전주 등장
//   -> 플레이어 매수(금액 입력)/관망 선택
//   -> 다음 턴에 결과 공개 (수익률 구간별 자산/스트레스 변화)
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

/** 급등주 등장 (eventEngine의 surge_stock_tip 트리거 안에서 호출, 같은 트랜잭션) */
async function spawn(client, session) {
  const name = C.SURGE_STOCK.NAMES[Math.floor(Math.random() * C.SURGE_STOCK.NAMES.length)];
  const buyPrice = 1000 * (1 + Math.floor(Math.random() * 50)); // 1,000~50,000원 임시가
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
    `SELECT s.*, g.current_turn
     FROM surge_stocks s JOIN game_sessions g ON g.id = s.session_id
     WHERE s.session_id = $1 AND s.resolved = FALSE
     ORDER BY s.id DESC LIMIT 1`,
    [sessionId]
  );
  const s = rows[0];
  if (!s) return null;
  return {
    surgeStockId: s.id,
    displayName: s.display_name,
    buyPrice: Number(s.buy_price),
    investedAmount: Number(s.invested_amount),
    canBuy: s.spawn_turn === s.current_turn && Number(s.invested_amount) === 0,
  };
}

/** 매수 (금액 입력). 관망은 그냥 아무것도 안 하면 된다. */
async function buy(sessionId, surgeStockId, amount, client) {
  const q = client || { query };
  if (!(amount > 0)) throw badRequest('amount(>0)가 필요합니다');
  const { rows } = await q.query(
    `SELECT s.*, g.cash, g.current_turn
     FROM surge_stocks s JOIN game_sessions g ON g.id = s.session_id
     WHERE s.id = $1 AND s.session_id = $2`,
    [surgeStockId, sessionId]
  );
  const s = rows[0];
  if (!s) throw notFound('급등주를 찾을 수 없습니다');
  if (s.resolved) throw conflict('이미 종료된 급등주입니다');
  if (s.spawn_turn !== s.current_turn) throw conflict('매수 가능 시간이 지났습니다');
  if (Number(s.invested_amount) > 0) throw conflict('이미 매수했습니다');
  if (amount > Number(s.cash)) throw conflict('현금이 부족합니다', { cash: Number(s.cash) });

  await q.query(
    `UPDATE surge_stocks SET invested_amount = $2 WHERE id = $1`, [surgeStockId, amount]
  );
  await q.query(
    `UPDATE game_sessions SET cash = cash - $2, updated_at = NOW() WHERE id = $1`,
    [sessionId, amount]
  );
  return { surgeStockId, investedAmount: amount };
}

/** 결과 가중치 추첨 */
function rollOutcome() {
  const outcomes = C.SURGE_STOCK.OUTCOMES;
  const total = outcomes.reduce((s, o) => s + o.weight, 0);
  let r = Math.random() * total;
  for (const o of outcomes) {
    r -= o.weight;
    if (r <= 0) return o;
  }
  return outcomes[outcomes.length - 1];
}

/**
 * 다음 턴 진행 시 미해결 급등주 정산 (turnService.advanceTurn 트랜잭션 안에서 호출)
 * - 매수분: 수익률 추첨 -> 자동 매도 정산 + 스트레스 반영
 * - 관망분: 결과만 기록하고 제거
 * @returns 정산 결과 (프론트 연출용) 또는 null
 */
async function resolvePending(client, session) {
  const { rows } = await client.query(
    `SELECT * FROM surge_stocks
     WHERE session_id = $1 AND resolved = FALSE AND spawn_turn < $2`,
    [session.id, session.current_turn]
  );
  const results = [];
  for (const s of rows) {
    const outcome = rollOutcome();
    const ret = outcome.retMin + Math.random() * (outcome.retMax - outcome.retMin);
    const invested = Number(s.invested_amount);
    const proceeds = invested > 0 ? Math.round(invested * (1 + ret)) : 0;
    const cashDelta = proceeds; // 매수금은 이미 차감됨 -> 정산액 전액 입금
    const stressDelta = invested > 0 ? outcome.stressDelta : 0; // 관망이면 심리 영향 없음

    await client.query(
      `UPDATE surge_stocks
       SET resolved = TRUE, outcome = $2, return_rate = $3, cash_delta = $4, stress_delta = $5
       WHERE id = $1`,
      [s.id, outcome.key, ret, invested > 0 ? proceeds - invested : 0, stressDelta]
    );
    if (invested > 0) {
      session.cash = Number(session.cash) + cashDelta;
      session.stress = clamp100(session.stress + stressDelta);
      await client.query(
        `INSERT INTO event_log (session_id, turn_number, event_type, detail, cash_delta, stress_delta, resolved)
         VALUES ($1, $2, 'surge_stock_result', $3, $4, $5, TRUE)`,
        [session.id, session.current_turn,
         JSON.stringify({ displayName: s.display_name, outcome: outcome.key, returnRate: ret, invested }),
         proceeds - invested, stressDelta]
      );
    }
    results.push({
      displayName: s.display_name,
      invested,
      outcome: outcome.key,
      returnRate: ret,
      pnl: invested > 0 ? proceeds - invested : 0,
      stressDelta,
    });
  }
  return results;
}

module.exports = { spawnProb, spawn, getActive, buy, resolvePending, rollOutcome };
