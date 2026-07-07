// 거시지표 wide CSV -> macro_daily (long) 적재
// 원천: $DATA_DIR/market_indicator/data/processed/macro_context_daily.csv
// 컬럼명 = macro_indicators.indicator_code (001_init.sql 시드와 1:1)
const path = require('path');
const { iterateCsv } = require('./lib/csv');
const { bulkInsert, pool } = require('./lib/db');

async function importMacro(csvPath) {
  const { rows } = await pool.query(`SELECT indicator_code FROM macro_indicators`);
  const known = new Set(rows.map((r) => r.indicator_code));

  let count = 0;
  await iterateCsv(csvPath, async (batch) => {
    const out = [];
    for (const row of batch) {
      const date = row.date;
      if (!date) continue;
      for (const [col, raw] of Object.entries(row)) {
        if (col === 'date' || !known.has(col)) continue;
        const v = raw === '' ? null : Number(raw);
        if (v === null || Number.isNaN(v)) continue;
        out.push([col, date, v]);
      }
    }
    count += await bulkInsert('macro_daily', ['indicator_code', 'trade_date', 'value'], out);
  }, 500);
  console.log(`[import_macro] macro_daily ${count}행`);
  return count;
}

module.exports = { importMacro };

if (require.main === module) {
  const fp =
    process.env.MACRO_CSV ||
    path.join(process.env.DATA_DIR || '.', 'market_indicator/data/processed/macro_context_daily.csv');
  importMacro(fp)
    .then(() => pool.end())
    .catch((e) => { console.error(e); process.exit(1); });
}
