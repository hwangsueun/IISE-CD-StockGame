// 거시지표 조회 (macro_context_daily.csv -> macro_daily 적재분)
const { query } = require('../db');

/** 게임 노출 지표의 특정일 값 + 전일 대비 (마켓 모달 지표 탭) */
async function getIndicatorsByDate(date) {
  const { rows } = await query(
    `SELECT i.indicator_code, i.display_name, i.unit, i.display_order,
            d.value,
            LAG(d.value) OVER (PARTITION BY d.indicator_code ORDER BY d.trade_date) AS prev_value
     FROM macro_indicators i
     JOIN macro_daily d ON d.indicator_code = i.indicator_code
     WHERE i.is_game_visible = TRUE
       AND d.trade_date <= $1::date
       AND d.trade_date > $1::date - INTERVAL '10 days'
     ORDER BY i.display_order, d.trade_date`,
    [date]
  );
  // 지표별 마지막(=당일 또는 직전 영업일) 값만 추출
  const latest = new Map();
  for (const r of rows) latest.set(r.indicator_code, r);
  return [...latest.values()]
    .sort((a, b) => a.display_order - b.display_order)
    .map((r) => ({
      code: r.indicator_code,
      name: r.display_name,
      unit: r.unit,
      value: r.value === null ? null : Number(r.value),
      change:
        r.value !== null && r.prev_value !== null
          ? Number(r.value) - Number(r.prev_value)
          : null,
    }));
}

/** 지표 차트용 시계열 (date 이전 days개) */
async function getIndicatorHistory(code, date, days) {
  const { rows } = await query(
    `SELECT trade_date, value FROM macro_daily
     WHERE indicator_code = $1 AND trade_date <= $2
     ORDER BY trade_date DESC LIMIT $3`,
    [code, date, days]
  );
  return rows.reverse().map((r) => ({ date: r.trade_date, value: Number(r.value) }));
}

module.exports = { getIndicatorsByDate, getIndicatorHistory };
