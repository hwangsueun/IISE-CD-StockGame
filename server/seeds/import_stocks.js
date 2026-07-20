// DataGuide 주가/거래량 xlsx -> assets + asset_prices + stock_price_detail
// 원천: $DATA_DIR/data/raw/stock/stock_price-volume_npq.xlsx
// 시트: 13-17_price-volume / 18-22_price-volume / 23_price-volume (+ *_npq 수급)
//
// masked_name(가명)은 여기서 채우지 않는다 — assets.name(원 이름)만 적재하고 masked_name은
// NULL로 둔다. seeds/apply_masking.js가 모든 자산유형(주식/코인/채권)의 masked_name을
// rename_map 기준으로 채우는 유일한 지점이다(적재 마지막 단계, import_all.js 참고).
// 예전에는 이 파일이 stock_rename_map.csv를 직접 읽어 masked_name까지 같이 넣었는데,
// import_coins.js도 같은 일을 자기 방식대로 하고 있어서 마스킹 적용 지점이 세 곳(여기 /
// import_coins.js / apply_masking.js)으로 흩어져 있었다 - 한 곳(apply_masking.js)으로
// 통일했다(보고서 참고).
// 구조: 9행 근처 메타(코드/코드명/아이템명) 후 날짜별 wide 데이터
const path = require('path');
const XLSX = require('xlsx');
const { bulkInsert, pool } = require('./lib/db');

const PRICE_SHEETS = ['13-17_price-volume', '18-22_price-volume', '23_price-volume'];
const NPQ_SHEETS = ['13-17_npq', '18-22_npq', '23_npq'];

/** 'A000660' -> '000660' */
const toCode = (dgCode) => String(dgCode).replace(/^A/, '');

/**
 * DataGuide wide 시트 파싱.
 * 메타행: '코드', '코드명', '아이템명' 라벨 행을 찾아 컬럼 -> {code,name,item} 매핑.
 * 데이터행: 첫 셀이 날짜(Date)인 행.
 * @returns {{columns: {idx:number, code:string, name:string, item:string}[], rows: any[][]}}
 */
function parseSheet(ws) {
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
  const findRow = (label) => grid.find((r) => r && r[0] === label);
  const codeRow = findRow('코드');
  const nameRow = findRow('코드명');
  const itemRow = findRow('아이템명');
  if (!codeRow || !itemRow) throw new Error('DataGuide 메타행(코드/아이템명)을 찾지 못했습니다');

  const columns = [];
  for (let i = 1; i < codeRow.length; i++) {
    if (!codeRow[i]) continue;
    columns.push({ idx: i, code: toCode(codeRow[i]), name: nameRow?.[i] || '', item: itemRow[i] || '' });
  }
  const rows = grid.filter((r) => r && r[0] instanceof Date);
  return { columns, rows };
}

const isoDate = (d) => d.toISOString().slice(0, 10);

async function importStocks(xlsxPath) {
  console.log(`[import_stocks] 로드: ${xlsxPath}`);
  const wb = XLSX.readFile(xlsxPath, { cellDates: true });

  // --- 1) 자산 마스터: 종가 컬럼에서 종목 목록 추출 ---
  const stockNames = new Map(); // code -> name
  for (const sheetName of PRICE_SHEETS) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const { columns } = parseSheet(ws);
    for (const c of columns) if (c.name) stockNames.set(c.code, c.name);
  }
  // TODO(data): FICS sector는 별도 섹터 매핑표 확정 후 UPDATE.
  // masked_name은 NULL로 적재 -> apply_masking.js가 stock_rename_map.csv 기준으로 채운다.
  const assetRows = [...stockNames.entries()].map(([code, name]) => (
    [`STOCK_${code}`, 'stock', code, name, null, null, 'KRW']
  ));
  await bulkInsert(
    'assets',
    ['asset_id', 'asset_type', 'code', 'name', 'masked_name', 'sector', 'currency'],
    assetRows
  );
  console.log(`[import_stocks] assets ${assetRows.length}종목`);

  // --- 2) 시세: 종가 -> asset_prices, 종가+거래량 -> stock_price_detail ---
  let priceCount = 0;
  const lastPrice = new Map(); // change_rate 계산용 (시트가 기간 순서라는 전제)
  for (const sheetName of PRICE_SHEETS) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const { columns, rows } = parseSheet(ws);
    const closeCols = columns.filter((c) => c.item.startsWith('종가'));
    const volCols = new Map(
      columns.filter((c) => c.item.startsWith('거래량')).map((c) => [c.code, c.idx])
    );

    const priceRows = [];
    const detailRows = [];
    for (const row of rows) {
      const date = isoDate(row[0]);
      for (const c of closeCols) {
        const close = row[c.idx];
        if (close === null || close === undefined || close === '') continue;
        const assetId = `STOCK_${c.code}`;
        const prev = lastPrice.get(assetId);
        const changeRate = prev ? (close - prev) / prev : null;
        lastPrice.set(assetId, close);
        priceRows.push([assetId, date, close, changeRate, 'KRW']);
        const vol = volCols.has(c.code) ? row[volCols.get(c.code)] ?? null : null;
        detailRows.push([assetId, date, close, vol]);
      }
    }
    priceCount += await bulkInsert(
      'asset_prices', ['asset_id', 'trade_date', 'close_price', 'change_rate', 'currency'], priceRows
    );
    await bulkInsert('stock_price_detail', ['asset_id', 'trade_date', 'close_price', 'volume'], detailRows);
    console.log(`[import_stocks] ${sheetName}: ${priceRows.length}행`);
  }

  // --- 3) 수급(npq): 외국인/기관/개인 순매수 -> stock_price_detail UPDATE ---
  // TODO(data): npq 시트의 아이템명 확정 후 매핑 구현 (외국인/기관/개인 순매수수량)
  for (const sheetName of NPQ_SHEETS) {
    if (!wb.Sheets[sheetName]) continue;
    console.log(`[import_stocks] TODO: 수급 시트 미적재 - ${sheetName}`);
  }

  return priceCount;
}

module.exports = { importStocks };

if (require.main === module) {
  const fp =
    process.env.STOCK_XLSX ||
    path.join(process.env.DATA_DIR || '.', 'data/raw/stock/stock_price-volume_npq.xlsx');
  importStocks(fp)
    .then(() => pool.end())
    .catch((e) => { console.error(e); process.exit(1); });
}
