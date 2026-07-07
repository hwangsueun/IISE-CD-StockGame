// 시작일 선택 + 240거래일 생성 (ARCHITECTURE.md §9-1)
// 거래일 기준 = asset_prices에 실제 가격이 존재하는 날짜 (KOSPI∪KOSDAQ 달력과 동일하게 적재됨)
const { query } = require('../db');
const C = require('../config/constants');

/** DB에 존재하는 전체 거래일 목록 (오름차순) */
async function getTradingCalendar() {
  const { rows } = await query(
    `SELECT DISTINCT trade_date FROM asset_prices ORDER BY trade_date`
  );
  return rows.map((r) => r.trade_date);
}

/**
 * GAME_START_RANGE 안에서 시작 거래일을 랜덤 선택하고 240거래일을 반환한다.
 * 시작일 + 240거래일이 데이터 범위를 넘지 않도록 상한을 보정한다.
 * @returns {Promise<{startDate: string, dates: Date[]}>}
 */
async function selectTurnDates() {
  const range = (process.env.GAME_START_RANGE || `${C.DATA_RANGE.from}..${C.DATA_RANGE.to}`).split('..');
  const calendar = await getTradingCalendar();
  if (calendar.length < C.TOTAL_TURNS) {
    throw new Error(`거래일 데이터 부족: ${calendar.length}일 < ${C.TOTAL_TURNS}턴 (시드 적재 필요)`);
  }
  const fromIdx = calendar.findIndex((d) => d >= new Date(range[0]));
  const lastValidStartIdx = calendar.length - C.TOTAL_TURNS; // 240턴이 들어가는 마지막 시작 인덱스
  const lo = Math.max(0, fromIdx);
  const hi = Math.min(lastValidStartIdx, calendar.length - C.TOTAL_TURNS);
  const startIdx = lo + Math.floor(Math.random() * Math.max(1, hi - lo + 1));
  const dates = calendar.slice(startIdx, startIdx + C.TOTAL_TURNS);
  return { startDate: dates[0], dates };
}

/** 세션의 game_turns 240행 생성 */
async function createGameTurns(client, sessionId, dates) {
  const values = [];
  const params = [sessionId];
  dates.forEach((d, i) => {
    params.push(d);
    values.push(`($1, ${i + 1}, $${params.length})`);
  });
  await client.query(
    `INSERT INTO game_turns (session_id, turn_number, trade_date) VALUES ${values.join(',')}`,
    params
  );
}

module.exports = { getTradingCalendar, selectTurnDates, createGameTurns };
