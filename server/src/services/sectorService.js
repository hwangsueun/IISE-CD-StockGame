const { query } = require('../db');
const { badRequest, notFound, conflict } = require('../utils/errors');

function sectorQuote(row) {
  const price = row.price === null ? null : Number(row.price);
  const previous = row.previous_price === null ? null : Number(row.previous_price);
  return { code: row.indicator_code, sector: row.display_name,
    market: row.indicator_code.startsWith('sector_kosdaq_') ? 'KOSDAQ' : 'KOSPI',
    value: price, date: row.trade_date, previousDate: row.previous_date,
    changeRate: price > 0 && previous > 0 ? price / previous - 1 : null };
}

async function getSectors(sessionId, requestedDate) {
  if (!sessionId) throw badRequest('sessionId가 필요합니다');
  const { rows: [session] } = await query(`SELECT gt.trade_date FROM game_sessions s
    JOIN game_turns gt ON gt.session_id=s.id AND gt.turn_number=s.current_turn WHERE s.id=$1`, [sessionId]);
  if (!session) throw notFound('세션을 찾을 수 없습니다');
  const date = requestedDate || session.trade_date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0,10) !== date) throw badRequest('날짜를 확인해 주세요');
  if (date > session.trade_date) throw conflict('아직 진행하지 않은 날짜입니다');
  const { rows } = await query(`SELECT i.indicator_code,i.display_name,p.value AS price,p.trade_date,
    prev.value AS previous_price,prev.trade_date AS previous_date
    FROM macro_indicators i
    JOIN LATERAL (SELECT value,trade_date FROM macro_daily d
      WHERE d.indicator_code=i.indicator_code AND d.trade_date<=$1 AND d.value>0
      ORDER BY d.trade_date DESC LIMIT 1) p ON TRUE
    LEFT JOIN LATERAL (SELECT value,trade_date FROM macro_daily d
      WHERE d.indicator_code=i.indicator_code AND d.trade_date<p.trade_date AND d.value>0
      ORDER BY d.trade_date DESC LIMIT 1) prev ON TRUE
    WHERE i.indicator_code ~ '^sector_(kospi|kosdaq)_[0-9]+$'`, [date]);
  const sectors = rows.map(sectorQuote).sort((a,b) => (b.changeRate ?? -Infinity) - (a.changeRate ?? -Infinity) || a.sector.localeCompare(b.sector, 'ko'));
  const asOfDate = sectors.map(s => s.date).sort().at(-1) || null;
  return { date, asOfDate, marketOpen: asOfDate === date, sectors };
}

module.exports = { sectorQuote, getSectors };
