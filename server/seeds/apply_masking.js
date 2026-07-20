// 가명 사전 적용: assets.masked_name / assets.is_masked / coin_info.symbol 갱신
// 원천: $DATA_DIR/data/processed/rename_map/{stock_rename_map.csv,coin_rename_map.csv} (정본)
// ARCHITECTURE.md §6 적재 순서 8번 "회사명 가명 마스킹 후 is_masked = TRUE" 단계.
// import_all.js에서 모든 자산/시세 적재가 끝난 뒤 마지막 단계로 실행한다.
//
// 이 스크립트가 assets.masked_name(주식/코인/채권 전부)과 coin_info.symbol을 채우는
// 유일한 지점이다. import_stocks.js/import_coins.js는 이제 실명(name/symbol)만 적재하고
// masked_name은 NULL로 둔다 - 예전에는 세 파일(import_stocks.js/import_coins.js/이 파일)이
// 각자 마스킹을 시도해 적용 지점이 흩어져 있었고, 그 중 import_coins.js는 심지어
// assets.name에도 가명을 넣어 원 이름이 DB 어디에도 안 남는 문제가 있었다 - 전부 여기로
// 통일했다(보고서 참고). 본문(news_lines, community title/body) 마스킹은 import_news.js/
// import_community.js가 같은 rename_map을 src/services/maskingService.js를 통해 별도로
// 적재 시점에 바로 처리한다 - 이 스크립트와 원천이 같으므로 항상 서로 일치한다.
//
// 채권: rename_map에 채권이 없다(주식/코인 전용 사전). 채권 4종은 001_init.sql이 이미
// 비식별 라벨(국채 단기/국채 장기/우량 회사채/투기 회사채)로 시드해 뒀고 그 자체로
// 실명을 역추적할 수 없는 서술적 이름이라 그대로 유지한다 - 이 스크립트는 채권의
// masked_name 값은 건드리지 않고 is_masked 플래그만 TRUE로 보정한다.
const fs = require('fs');
const path = require('path');
const { parseLine } = require('./lib/csv');
const { pool } = require('./lib/db');

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** 소형 CSV 동기 로드 (BOM 안전). maskingService.js와 동일 패턴. */
function parseCsvSync(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const rows = [];
  let header = null;
  for (const rawLine of lines) {
    if (!rawLine) continue;
    const line = header ? rawLine : stripBom(rawLine);
    const cells = parseLine(line);
    if (!header) {
      header = cells.map((h) => h.trim());
      continue;
    }
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i] === undefined ? '' : cells[i]; });
    rows.push(row);
  }
  return rows;
}

function loadRenameMapCsv(dataDir, file) {
  const fp = path.join(dataDir || '.', 'data/processed/rename_map', file);
  if (!fs.existsSync(fp)) {
    console.warn(`[apply_masking] 없음: ${fp}`);
    return [];
  }
  return parseCsvSync(fp);
}

async function applyStockMasking(dataDir) {
  const rows = loadRenameMapCsv(dataDir, 'stock_rename_map.csv');
  const byCode = new Map();
  for (const r of rows) if (r.stock_code && r.masked_name) byCode.set(r.stock_code, r.masked_name);

  const { rows: assets } = await pool.query(`SELECT asset_id, code FROM assets WHERE asset_type = 'stock'`);
  let updated = 0;
  let fallback = 0;
  let seq = 0;
  const missing = [];
  for (const a of assets) {
    let masked = byCode.get(a.code);
    if (!masked) {
      // rename_map에 없는 코드 - 실명 노출은 협상 불가 요구사항이므로 비식별 폴백 라벨을
      // 강제한다(무엇을 뜻하는지 알 수 없는 값이지만 NULL/실명보다 안전). 데이터 담당이
      // stock_rename_map.csv를 보강해야 하는 항목이라 별도로도 경고한다.
      masked = `미분류종목${String(++seq).padStart(3, '0')}`;
      missing.push(a.code);
      fallback++;
    }
    const { rowCount } = await pool.query(
      `UPDATE assets SET masked_name = $1, is_masked = TRUE WHERE asset_id = $2`,
      [masked, a.asset_id]
    );
    updated += rowCount;
  }
  if (missing.length) {
    console.warn(
      `[apply_masking] stock_rename_map.csv에 없는 종목코드 ${missing.length}건 - 비식별 폴백 라벨 사용: ${missing.join(', ')}`
    );
  }
  console.log(`[apply_masking] 주식 masked_name 갱신 ${updated}건 (사전 매칭 ${updated - fallback} / 폴백 ${fallback})`);
  return updated;
}

async function applyCoinMasking(dataDir) {
  const rows = loadRenameMapCsv(dataDir, 'coin_rename_map.csv');
  const byId = new Map();
  for (const r of rows) if (r.id && r.masked_name) byId.set(r.id, { name: r.masked_name, symbol: r.masked_symbol || '' });

  const { rows: assets } = await pool.query(`SELECT asset_id, code FROM assets WHERE asset_type = 'coin'`);
  let updated = 0;
  let fallback = 0;
  let seq = 0;
  const missing = [];
  for (const a of assets) {
    let entry = byId.get(a.code);
    if (!entry) {
      entry = { name: `미분류코인${String(++seq).padStart(3, '0')}`, symbol: null };
      missing.push(a.code);
      fallback++;
    }
    const { rowCount } = await pool.query(
      `UPDATE assets SET masked_name = $1, is_masked = TRUE WHERE asset_id = $2`,
      [entry.name, a.asset_id]
    );
    updated += rowCount;
    if (entry.symbol) {
      await pool.query(`UPDATE coin_info SET symbol = $1 WHERE asset_id = $2`, [entry.symbol, a.asset_id]);
    }
  }
  if (missing.length) {
    console.warn(
      `[apply_masking] coin_rename_map.csv에 없는 코인 id ${missing.length}건 - 비식별 폴백 라벨 사용(심볼 미변경): ${missing.join(', ')}`
    );
  }
  console.log(`[apply_masking] 코인 masked_name/symbol 갱신 ${updated}건 (사전 매칭 ${updated - fallback} / 폴백 ${fallback})`);
  return updated;
}

/** 채권: rename_map 대상 아님 - 001_init.sql 시드 라벨(masked_name) 그대로 두고 is_masked만 보정. */
async function applyBondMasking() {
  const { rowCount } = await pool.query(
    `UPDATE assets SET is_masked = TRUE WHERE asset_type = 'bond' AND masked_name IS NOT NULL`
  );
  console.log(`[apply_masking] 채권 is_masked 보정 ${rowCount}건 (masked_name은 001_init.sql 시드값 유지)`);
  return rowCount;
}

async function applyMasking() {
  const dataDir = process.env.DATA_DIR;
  if (!dataDir) {
    console.warn('[apply_masking] DATA_DIR 미설정 - rename_map을 읽을 수 없어 건너뜁니다.');
    return 0;
  }
  const stockUpdated = await applyStockMasking(dataDir);
  const coinUpdated = await applyCoinMasking(dataDir);
  const bondUpdated = await applyBondMasking();

  const { rows: nullRows } = await pool.query(
    `SELECT asset_id, asset_type FROM assets WHERE masked_name IS NULL OR is_masked = FALSE`
  );
  if (nullRows.length) {
    console.warn(
      `[apply_masking] masked_name/is_masked 미완료 자산 ${nullRows.length}건(있으면 안 됨 - 버그 의심): ` +
        nullRows.slice(0, 20).map((r) => r.asset_id).join(', ') +
        (nullRows.length > 20 ? ` 외 ${nullRows.length - 20}건` : '')
    );
  }

  const total = stockUpdated + coinUpdated + bondUpdated;
  console.log(`[apply_masking] 총 ${total}건 처리 완료`);
  return total;
}

module.exports = { applyMasking };

if (require.main === module) {
  applyMasking()
    .then(() => pool.end())
    .catch((e) => { console.error(e); process.exit(1); });
}
