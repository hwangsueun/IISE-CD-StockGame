const { query } = require('../db');
const { badRequest } = require('../utils/errors');

function validateDate(date) {
  if (date === undefined || date === null || date === '') return null;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw badRequest('date는 실제 날짜(YYYY-MM-DD)여야 합니다');
  }
  return date;
}

const METRICS = ['revenue', 'operating_income', 'net_income', 'total_assets', 'total_liabilities', 'total_equity'];
const iso = value => value instanceof Date ? value.toISOString().slice(0, 10) : value;
function publicStatement(row) {
  return {
    fiscal_year: Number(row.fiscal_year), period: 'annual',
    period_start: iso(row.period_start), period_end: iso(row.period_end),
    basis: row.fs_div, currency: row.currency,
    ...Object.fromEntries(METRICS.map(key => [key, row[key] == null ? null : String(row[key])])),
    metric_labels: Object.fromEntries(Object.entries(row.metric_labels || {}).filter(([key, value]) =>
      METRICS.includes(key) && typeof value === 'string')),
  };
}

async function getFinancialStatements(assetId, date, executor = { query }) {
  const cutoff = validateDate(date);
  // Select a single published version per actual reporting period. A correction must
  // never replace a prior receipt before its own availability date.
  const { rows } = await executor.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (period_end) *
       FROM stock_financial_statements
       WHERE asset_id = $1 AND ($2::date IS NULL OR available_date <= $2::date)
       ORDER BY period_end,
         CASE WHEN fs_div = 'CFS' THEN 0 ELSE 1 END,
         available_date DESC, receipt_no DESC
     ) periods ORDER BY period_end DESC, period_start DESC LIMIT 4`,
    [assetId, cutoff]
  );
  const financials = rows.map(publicStatement);
  let status = 'available';
  if (!financials.length) {
    const { rows: coverage } = await executor.query(
      'SELECT EXISTS(SELECT 1 FROM stock_financial_statements WHERE asset_id=$1) AS collected', [assetId]);
    status = coverage[0]?.collected ? 'not_yet_available' : 'not_collected';
  }
  return { financials, financialsMeta: { status, period: 'annual', sourceName: 'DART 사업보고서' } };
}

module.exports = { getFinancialStatements, publicStatement, validateDate };
