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
  const range = (process.env.GAME_START_RANGE || `${C.START_RANGE.from}..${C.START_RANGE.to}`).split('..');
  const calendar = await getTradingCalendar();
  if (calendar.length < C.TOTAL_TURNS) {
    throw new Error(`거래일 데이터 부족: ${calendar.length}일 < ${C.TOTAL_TURNS}턴 (시드 적재 필요)`);
  }

  // 2026-07-20 버그 수정: 이전 구현은 `d >= new Date(range[0])`로 비교했다.
  // getTradingCalendar가 돌려주는 trade_date는 Date가 아니라 'YYYY-MM-DD' 문자열이다
  // (src/db.js가 DATE 타입 파서를 문자열 그대로 반환하도록 설정 — 타임존 왜곡 방지).
  // 문자열과 Date의 관계 비교는 양쪽을 숫자로 변환하는데 문자열이 NaN이 되어 **항상 false**였다.
  // 그래서 findIndex가 -1을 반환하고 lo가 0으로 떨어져 GAME_START_RANGE가 무시됐다
  // (실측: 범위를 2014부터로 줘도 2013-01-15 시작 세션이 생성됨).
  // 달력이 전부 'YYYY-MM-DD' 문자열이므로 사전식 비교가 곧 날짜 순서 비교다.
  const fromIdx = calendar.findIndex((d) => d >= range[0]);

  // 상한도 적용한다. 이전 구현은 range[1]을 파싱만 하고 쓰지 않아 240턴 제약으로만 잘렸다.
  // 시작일 상한과 "240턴이 데이터 범위 안에 들어가는 마지막 인덱스" 중 더 이른 쪽을 쓴다.
  const lastValidStartIdx = calendar.length - C.TOTAL_TURNS;
  let toIdx = range[1] ? calendar.findIndex((d) => d > range[1]) : -1;
  if (toIdx === -1) toIdx = calendar.length; // 상한이 달력 끝을 넘으면 끝까지
  const lo = Math.max(0, fromIdx === -1 ? 0 : fromIdx);
  const hi = Math.min(lastValidStartIdx, toIdx - 1);
  if (hi < lo) {
    throw new Error(
      `GAME_START_RANGE(${range[0]}..${range[1]}) 안에 240턴이 들어가는 시작일이 없습니다 ` +
        `(거래일 ${calendar.length}일, 마지막 가능 시작 인덱스 ${lastValidStartIdx})`
    );
  }
  const startIdx = lo + Math.floor(Math.random() * (hi - lo + 1));
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
