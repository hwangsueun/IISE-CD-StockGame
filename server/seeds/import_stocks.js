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
  // 데이터행 = 첫 셀이 엑셀 날짜 serial인 행. cellDates:false로 읽으므로 Date가 아니라 숫자다
  // (Date도 허용해 두면 호출자가 옵션을 바꿔도 깨지지 않는다).
  // 메타행의 첫 셀은 '코드'/'코드명' 같은 문자열이라 자연히 걸러진다. 하한 30000은
  // 1982년 이후 — 시세 데이터 범위(2012~)보다 한참 이르면서 일반 수치와는 겹치지 않는다.
  const isDateCell = (v) => v instanceof Date || (typeof v === 'number' && v > 30000 && v < 60000);
  const rows = grid.filter((r) => r && isDateCell(r[0]));
  return { columns, rows };
}

// 엑셀 날짜 -> 'YYYY-MM-DD'
//
// 2026-07-20 버그 수정: 이전 구현은 `d.toISOString().slice(0,10)`이었다.
// SheetJS가 cellDates로 만드는 Date는 자정이 아니라 **23:59:08**로 나온다(엑셀 serial ->
// ms 변환의 부동소수 반올림 오차). 여기서 날짜만 잘라내면 **하루 전날**이 된다.
// 실측: serial 41271(엑셀 표시 2012-12-28 금) -> Date "Thu Dec 27 2012 23:59:08" -> "2012-12-27".
// 그 결과 주식 시세 전체가 하루씩 당겨져 적재됐다 — 거래일 요일 분포가 월~금이 아니라
// 일~목으로 나왔고(금요일 0건, 일요일 56,358건), CSV에서 문자열로 들어오는 거시·채권·코인,
// 그리고 뉴스/종토방의 날짜와 하루씩 어긋났다.
//
// 해법: Date를 거치지 않고 엑셀 serial을 직접 변환한다(타임존 무관, 반올림 오차 없음).
// 엑셀 1900 날짜 체계의 기준점은 1899-12-30이다(1900년을 윤년으로 잘못 세는 버그 보정 포함).
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const isoDate = (v) => {
  // cellDates:false로 읽으면 숫자(serial), 혹시 Date가 오면 ms에서 역산한다
  const serial = v instanceof Date ? v.getTime() / 86400000 + 25569 : Number(v);
  if (!Number.isFinite(serial)) return null;
  return new Date(EXCEL_EPOCH_UTC + Math.round(serial) * 86400000).toISOString().slice(0, 10);
};

async function importStocks(xlsxPath) {
  console.log(`[import_stocks] 로드: ${xlsxPath}`);
  const wb = XLSX.readFile(xlsxPath, { cellDates: false }); // serial 그대로 받아 isoDate가 변환 (위 주석)

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
