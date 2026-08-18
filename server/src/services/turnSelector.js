// 시작일 선택 + 240평일 턴 생성 (ARCHITECTURE.md §9-1)
// 주말은 게임에서 건너뛰지만, 평일 휴장일은 부업·뉴스·메모 같은 비거래 행동을 위해 턴으로 유지한다.
const { query } = require('../db');
const C = require('../config/constants');

/**
 * DB에 실제 주식 시세가 존재하는 개장일 목록 (오름차순).
 * 채권/코인은 주말 시세가 존재할 수 있으므로 반드시 주식만 기준으로 삼는다.
 */
async function getMarketOpenDates(client) {
  const q = client || { query };
  const { rows } = await q.query(
    `SELECT DISTINCT p.trade_date
     FROM asset_prices p
     JOIN assets a ON a.asset_id = p.asset_id
     WHERE a.asset_type = 'stock'
     ORDER BY p.trade_date`
  );
  return rows.map((r) => r.trade_date);
}

/** YYYY-MM-DD 양 끝을 포함하는 월~금 달력. UTC 연산으로 로컬 타임존 날짜 밀림을 막는다. */
function buildWeekdayCalendar(from, to) {
  if (!from || !to || from > to) return [];
  const dates = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return [];

  while (cursor <= end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/**
 * 게임 턴 달력: 첫~마지막 주식 개장일 사이의 모든 평일.
 * 주식 시세가 없는 평일도 의도적으로 포함한다(휴장일 비거래 행동용).
 */
async function getTradingCalendar(client) {
  const marketOpenDates = await getMarketOpenDates(client);
  if (marketOpenDates.length === 0) return [];
  return buildWeekdayCalendar(marketOpenDates[0], marketOpenDates[marketOpenDates.length - 1]);
}

/** 해당 날짜에 국내 주식 시세가 하나라도 있으면 게임 전체 거래가 가능한 개장일이다. */
async function isMarketOpen(date, client) {
  const q = client || { query };
  const { rows } = await q.query(
    `SELECT EXISTS (
       SELECT 1
       FROM asset_prices p
       JOIN assets a ON a.asset_id = p.asset_id
       WHERE p.trade_date = $1 AND a.asset_type = 'stock'
     ) AS market_open`,
    [date]
  );
  return rows[0]?.market_open === true;
}

/** 현재 턴 뒤에 정산 가능한 주식 개장 턴이 남아 있는지 확인한다. */
async function hasFutureMarketOpen(sessionId, turnNumber, client) {
  const q = client || { query };
  const { rows } = await q.query(
    `SELECT EXISTS (
       SELECT 1
       FROM game_turns gt
       WHERE gt.session_id = $1 AND gt.turn_number > $2
         AND EXISTS (
           SELECT 1
           FROM asset_prices p
           JOIN assets a ON a.asset_id = p.asset_id
           WHERE p.trade_date = gt.trade_date AND a.asset_type = 'stock'
         )
     ) AS has_future_market_open`,
    [sessionId, turnNumber]
  );
  return rows[0]?.has_future_market_open === true;
}

/**
 * GAME_START_RANGE 안에서 시작 개장일을 랜덤 선택하고 240평일을 반환한다.
 * 시작일 + 240평일이 데이터 범위를 넘지 않도록 상한을 보정한다.
 * @returns {Promise<{startDate: string, dates: string[]}>}
 */
async function selectTurnDates(random = Math.random) {
  const range = (process.env.GAME_START_RANGE || `${C.START_RANGE.from}..${C.START_RANGE.to}`).split('..');
  const marketOpenDates = await getMarketOpenDates();
  if (marketOpenDates.length === 0) {
    throw new Error('주식 개장일 데이터가 없습니다 (시드 적재 필요)');
  }
  const marketOpenSet = new Set(marketOpenDates);
  const calendar = buildWeekdayCalendar(marketOpenDates[0], marketOpenDates[marketOpenDates.length - 1]);
  if (calendar.length < C.TOTAL_TURNS) {
    throw new Error(`평일 데이터 부족: ${calendar.length}일 < ${C.TOTAL_TURNS}턴 (시드 적재 필요)`);
  }

  // 첫날은 실제 개장일로 한정하되, 이후에는 평일 휴장일도 정상 턴으로 포함한다.
  // 문자열은 모두 YYYY-MM-DD라 사전식 비교가 날짜 순서와 같다.
  const lastValidStartIdx = calendar.length - C.TOTAL_TURNS;
  const candidates = [];
  for (let i = 0; i <= lastValidStartIdx; i += 1) {
    const date = calendar[i];
    if (date < range[0]) continue;
    if (range[1] && date > range[1]) continue;
    // 첫날과 마지막 날을 모두 개장일로 고정하면 마지막 급등주/강제청산이 휴장일에
    // 걸린 채 게임이 끝나는 상태를 원천적으로 피할 수 있다.
    const finalDate = calendar[i + C.TOTAL_TURNS - 1];
    if (marketOpenSet.has(date) && marketOpenSet.has(finalDate)) candidates.push(i);
  }
  if (candidates.length === 0) {
    throw new Error(
      `GAME_START_RANGE(${range[0]}..${range[1]}) 안에 240턴이 들어가는 시작일이 없습니다 ` +
        `(평일 ${calendar.length}일, 마지막 가능 시작 인덱스 ${lastValidStartIdx})`
    );
  }
  const startIdx = candidates[Math.floor(random() * candidates.length)];
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

module.exports = {
  getMarketOpenDates,
  buildWeekdayCalendar,
  getTradingCalendar,
  isMarketOpen,
  hasFutureMarketOpen,
  selectTurnDates,
  createGameTurns,
};
