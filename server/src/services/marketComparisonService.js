const { pool } = require('../db');
const { notFound } = require('../utils/errors');

const INDEX_NAMES = { kospi: '코스피', kosdaq: '코스닥' };
const numeric = value => value === null || value === undefined ? null : Number(value);

function comparePeriod(start, end, label) {
  const playerReturn = start.factor > 0 && end.factor !== null
    ? end.factor / start.factor - 1 : null;
  return {
    label, fromTurn: start.turn, toTurn: end.turn,
    endValue: end.totalAsset,
    netAmount: end.netProfit === null || start.netProfit === null ? null : end.netProfit - start.netProfit,
    playerReturn,
    benchmarks: Object.entries(INDEX_NAMES).map(([code, name]) => {
      const base = start.indices[code]?.value;
      const last = end.indices[code]?.value;
      const returnRate = base > 0 && last > 0 ? last / base - 1 : null;
      return { code, name, returnRate,
        excessReturn: playerReturn !== null && returnRate !== null ? playerReturn - returnRate : null,
        startDate: start.indices[code]?.date ?? null, endDate: end.indices[code]?.date ?? null };
    }),
  };
}

// Replay actual fills and cash movements. At each external flow, value the account
// at that game's close, chain its investment return, then reset the capital base.
// Pending orders and Alpha158's separate account never enter this ledger.
function buildPerformance({ initialCash, turns, trades, events, surges, prices, indices, actualTotal }) {
  let cash = initialCash, reference = initialCash, factor = 1, externalCash = 0;
  let valid = initialCash > 0, missingPrice = false;
  const holdings = new Map(), surgeHoldings = new Map();
  const priceMap = new Map(prices.map(p => [`${p.turn_number}:${p.asset_id}`, numeric(p.price)]));
  const indexMap = new Map(indices.map(p => [`${p.turn_number}:${p.indicator_code}`,
    { value: numeric(p.value), date: p.trade_date }]));
  const actions = [];
  const timingEstimated = events.some(e => e.resolved && Number(e.cash_delta) && e.detail?.chosen && !e.detail.appliedAt);
  for (const t of trades) actions.push({ kind: 'trade', turn: t.turn_number, at: t.created_at, priority: 0, ...t });
  for (const e of events) {
    if (!e.resolved || ['surge_stock_result', 'asset_delisted'].includes(e.event_type) || !Number(e.cash_delta)) continue;
    actions.push({ kind: 'flow', turn: Number(e.detail?.appliedTurn ?? e.turn_number),
      at: e.detail?.appliedAt ?? e.created_at, priority: e.event_type === 'monthly_cashflow' ? 1 : 3, ...e });
  }
  for (const s of surges) {
    if (!(Number(s.invested_amount) > 0)) continue;
    actions.push({ kind: 'surgeBuy', turn: s.buy_turn, at: s.purchased_at || s.created_at, priority: 0, ...s });
    if (s.resolved && s.sell_turn) actions.push({ kind: 'surgeSell', turn: s.sell_turn,
      at: s.resolved_at, priority: 2, ...s });
  }
  actions.sort((a, b) => a.turn - b.turn || new Date(a.at) - new Date(b.at) ||
    a.priority - b.priority || Number(a.id) - Number(b.id));

  function value(turn) {
    let result = cash + [...surgeHoldings.values()].reduce((sum, amount) => sum + amount, 0);
    for (const [asset, quantity] of holdings) {
      if (Math.abs(quantity) < 1e-8) continue;
      const price = priceMap.get(`${turn}:${asset}`);
      if (!(price > 0) || quantity < 0) { missingPrice = true; continue; }
      result += price * quantity;
    }
    return result;
  }
  const atIndices = turn => Object.fromEntries(Object.keys(INDEX_NAMES).map(code => [code, indexMap.get(`${turn}:${code}`)]));
  const baseline = { turn: 1, date: turns[0]?.trade_date, totalAsset: initialCash,
    netProfit: 0, factor: initialCash > 0 ? 1 : null, indices: atIndices(1) };
  const points = [];
  let cursor = 0;
  for (const day of turns) {
    const turn = Number(day.turn_number);
    while (cursor < actions.length && actions[cursor].turn <= turn) {
      const action = actions[cursor++];
      if (action.kind === 'trade') {
        const sign = action.trade_type === 'buy' ? 1 : -1;
        holdings.set(action.asset_id, (holdings.get(action.asset_id) || 0) + sign * Number(action.quantity));
        cash -= sign * Number(action.amount); // actual amount includes execution costs
      } else if (action.kind === 'surgeBuy') {
        cash -= Number(action.invested_amount);
        surgeHoldings.set(action.id, Number(action.invested_amount));
      } else if (action.kind === 'surgeSell') {
        cash += Number(action.invested_amount) + Number(action.cash_delta);
        surgeHoldings.delete(action.id);
      } else {
        const before = value(turn), amount = Number(action.cash_delta);
        if (reference <= 0 || before <= 0 || before + amount <= 0) valid = false;
        if (valid) factor *= before / reference;
        reference = before + amount;
        cash += amount;
        externalCash += amount;
      }
    }
    const totalAsset = value(turn);
    if (totalAsset < 0) valid = false;
    points.push({ turn, date: day.trade_date, totalAsset,
      netProfit: totalAsset - initialCash - externalCash,
      factor: valid && !missingPrice ? factor * totalAsset / reference : null, indices: atIndices(turn) });
  }
  const last = points.at(-1) || baseline;
  // Never silently invent performance when old/imported records don't reconcile.
  const reconciled = Math.abs(last.totalAsset - actualTotal) <= 1;
  const available = reconciled && !missingPrice;
  if (!available) for (const point of points) { point.factor = null; point.netProfit = null; }
  const summary = comparePeriod(baseline, last, '누적');
  if (!available) summary.netAmount = null;
  const periods = {};
  for (const [unit, size] of Object.entries({ day: 1, week: 5, month: 20 })) {
    const rows = [];
    let start = baseline;
    // Game months end at 20, 40, ... and weeks at 5, 10, ...
    // Day one retains the initial baseline, including any first-day costs.
    for (const end of points) {
      if (end.turn % size !== 0 && end !== last) continue;
      const index = Math.ceil(end.turn / size);
      const label = unit === 'day' ? `${end.turn}일차`
        : `${index}${unit === 'week' ? '주차' : '개월차'} · ${(index - 1) * size + 1}–${end.turn}일차`;
      const row = comparePeriod(start, end, label);
      if (!available) row.netAmount = null;
      rows.push(row);
      start = end;
    }
    periods[unit] = rows.reverse();
  }
  periods.all = [summary];
  return { available, reason: !reconciled ? 'history_mismatch' : missingPrice ? 'missing_price' : !valid ? 'nonpositive_capital' : null,
    fromDate: baseline.date, toDate: last.date, currentTurn: last.turn, timingEstimated,
    currentValue: actualTotal, externalCash, summary, periods,
    points: points.map(p => ({ turn: p.turn, date: p.date,
      ...comparePeriod(baseline, p, `${p.turn}일차`) })) };
}

async function getPerformance(sessionId) {
  const client = await pool.connect();
  try {
    // A concurrent turn/side job must not mix old cash with newer ledger rows.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows: [session] } = await client.query('SELECT * FROM game_sessions WHERE id=$1', [sessionId]);
    if (!session) throw notFound('세션을 찾을 수 없습니다');
    const params = [sessionId, session.current_turn];
    const { rows: turns } = await client.query(`SELECT turn_number,trade_date FROM game_turns
      WHERE session_id=$1 AND turn_number<=$2 ORDER BY turn_number`, params);
    // Legacy TIMESTAMP fields store the DB's wall clock; JSON appliedAt has an
    // explicit offset. Normalize both to instants before ordering (Node may be KST).
    const { rows: trades } = await client.query(`SELECT t.*,
      t.created_at AT TIME ZONE current_setting('TimeZone') AS created_at
      FROM trades t WHERE session_id=$1 AND turn_number<=$2 ORDER BY id`, params);
    const { rows: events } = await client.query(`SELECT e.*,
      e.created_at AT TIME ZONE current_setting('TimeZone') AS created_at
      FROM event_log e WHERE session_id=$1 AND turn_number<=$2 ORDER BY id`, params);
    const { rows: surges } = await client.query(`SELECT s.*,
      s.created_at AT TIME ZONE current_setting('TimeZone') AS created_at,
      s.purchased_at AT TIME ZONE current_setting('TimeZone') AS purchased_at,
      s.resolved_at AT TIME ZONE current_setting('TimeZone') AS resolved_at,
      s.spawn_turn AS buy_turn,
      (SELECT e.turn_number FROM event_log e WHERE e.session_id=s.session_id
        AND e.event_type='surge_stock_result' AND (e.detail->>'surgeStockId')::text=s.id::text
        ORDER BY e.id LIMIT 1) AS sell_turn
      FROM surge_stocks s WHERE s.session_id=$1 AND s.spawn_turn<=$2`, params);
    const { rows: prices } = await client.query(`SELECT gt.turn_number,a.asset_id,p.close_price AS price
      FROM game_turns gt
      CROSS JOIN (SELECT DISTINCT asset_id FROM trades WHERE session_id=$1 AND turn_number<=$2) a
      LEFT JOIN LATERAL (SELECT close_price FROM asset_prices p
        WHERE p.asset_id=a.asset_id AND p.trade_date<=gt.trade_date ORDER BY p.trade_date DESC LIMIT 1) p ON TRUE
      WHERE gt.session_id=$1 AND gt.turn_number<=$2`, params);
    const { rows: indices } = await client.query(`SELECT gt.turn_number,i.indicator_code,p.value,p.trade_date
      FROM game_turns gt CROSS JOIN (VALUES ('kospi'),('kosdaq')) i(indicator_code)
      LEFT JOIN LATERAL (SELECT value,trade_date FROM macro_daily d
        WHERE d.indicator_code=i.indicator_code AND d.trade_date<=gt.trade_date AND d.value>0
        ORDER BY d.trade_date DESC LIMIT 1) p ON TRUE
      WHERE gt.session_id=$1 AND gt.turn_number<=$2`, params);
    const actualTotal = await require('./valuationService').computeTotalAsset(sessionId, client);
    const result = buildPerformance({ initialCash: Number(session.initial_cash), turns, trades, events, surges, prices, indices, actualTotal });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

module.exports = { buildPerformance, comparePeriod, getPerformance };
