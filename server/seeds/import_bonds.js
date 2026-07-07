// 채권 시세 적재
// 국고채: $DATA_DIR/bond_universe/data/kr_treasury_yields_long.csv (date,series,yield_pct)
// 회사채(AA-/BBB-): macro_daily의 corp_*_3y_rate 사용 (import_macro 이후 실행)
// 수익률 -> 가격지수 변환: 게임 거래용 근사치. 시작 100, 일 수익 = 쿠폰수익(y/250) - 듀레이션*Δy
const path = require('path');
const { readCsv } = require('./lib/csv');
const { bulkInsert, pool } = require('./lib/db');

const SERIES_TO_ASSET = {
  KTB_3Y: { assetId: 'BOND_KTB3Y', duration: 2.7 },
  KTB_10Y: { assetId: 'BOND_KTB10Y', duration: 8.5 },
};
const MACRO_TO_ASSET = {
  corp_aa_minus_3y_rate: { assetId: 'BOND_CORPAA', duration: 2.6 },
  corp_bbb_minus_3y_rate: { assetId: 'BOND_CORPBBB', duration: 2.5 },
};

/** 수익률 시계열 -> 가격지수/asset_prices 행 생성 */
function buildPriceRows(assetId, duration, series) {
  // series: [{date, y(%)}] 날짜 오름차순
  const priceRows = [];
  const detailRows = [];
  let index = 100;
  let prevY = null;
  let prevIndex = null;
  for (const { date, y } of series) {
    if (prevY !== null) {
      const carry = prevY / 100 / 250;              // 일할 쿠폰 수익
      const priceMove = -duration * ((y - prevY) / 100); // 금리 변동 손익
      index = index * (1 + carry + priceMove);
    }
    const changeRate = prevIndex ? (index - prevIndex) / prevIndex : null;
    // 게임 거래단가: 지수 * 100원 -> 1만원 안팎 (밸런싱 시 조정)
    priceRows.push([assetId, date, Math.round(index * 100 * 100) / 100, changeRate, 'KRW']);
    detailRows.push([assetId, date, y, index]);
    prevY = y;
    prevIndex = index;
  }
  return { priceRows, detailRows };
}

async function importBonds(treasuryCsv) {
  // --- 국고채 ---
  const rows = await readCsv(treasuryCsv);
  const bySeries = new Map();
  for (const r of rows) {
    const s = r.series;
    if (!SERIES_TO_ASSET[s]) continue;
    if (!bySeries.has(s)) bySeries.set(s, []);
    const y = Number(r.yield_pct);
    if (!Number.isNaN(y)) bySeries.get(s).push({ date: r.date, y });
  }
  let count = 0;
  for (const [s, series] of bySeries) {
    series.sort((a, b) => (a.date < b.date ? -1 : 1));
    const { assetId, duration } = SERIES_TO_ASSET[s];
    const { priceRows, detailRows } = buildPriceRows(assetId, duration, series);
    count += await bulkInsert('asset_prices', ['asset_id', 'trade_date', 'close_price', 'change_rate', 'currency'], priceRows);
    await bulkInsert('bond_price_detail', ['asset_id', 'trade_date', 'yield_rate', 'price_index'], detailRows);
    console.log(`[import_bonds] ${assetId}: ${priceRows.length}행`);
  }

  // --- 회사채 (macro_daily에서) ---
  for (const [code, { assetId, duration }] of Object.entries(MACRO_TO_ASSET)) {
    const { rows: mRows } = await pool.query(
      `SELECT trade_date, value FROM macro_daily WHERE indicator_code = $1 ORDER BY trade_date`,
      [code]
    );
    if (mRows.length === 0) {
      console.warn(`[import_bonds] macro_daily에 ${code} 없음 - import_macro 먼저 실행 필요`);
      continue;
    }
    const series = mRows.map((r) => ({
      date: r.trade_date.toISOString().slice(0, 10),
      y: Number(r.value),
    }));
    const { priceRows, detailRows } = buildPriceRows(assetId, duration, series);
    count += await bulkInsert('asset_prices', ['asset_id', 'trade_date', 'close_price', 'change_rate', 'currency'], priceRows);
    await bulkInsert('bond_price_detail', ['asset_id', 'trade_date', 'yield_rate', 'price_index'], detailRows);
    console.log(`[import_bonds] ${assetId}: ${priceRows.length}행`);
  }
  return count;
}

module.exports = { importBonds };

if (require.main === module) {
  const fp =
    process.env.BOND_CSV ||
    path.join(process.env.DATA_DIR || '.', 'bond_universe/data/kr_treasury_yields_long.csv');
  importBonds(fp)
    .then(() => pool.end())
    .catch((e) => { console.error(e); process.exit(1); });
}
