// KRX sector closes already collected by data-pipeline. Stored as hidden macro
// series so they cannot become tradable assets or crowd the reference-indicator tab.
const path = require('path');
const { iterateCsv } = require('./lib/csv');
const { pool, withTransaction } = require('../src/db');

function parseSectorRow(row) {
  const market = row.market?.toLowerCase(), index = row.index_code?.replace(/\.0$/, '');
  if (!['kospi', 'kosdaq'].includes(market) || !/^\d+$/.test(index) ||
      !row.index_name || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new Error('업종 자료의 코드·이름·날짜를 확인해 주세요');
  if (row.close === '' || row.close === null || row.close === undefined) return null;
  const value = Number(row.close);
  if (!Number.isFinite(value) || value < 0) throw new Error('업종 지수의 값이 올바르지 않습니다');
  if (value === 0) return null; // no valid close, never turn it into a -100% move
  return { code: `sector_${market}_${index}`, name: row.index_name, date: row.date, value };
}

async function importSectors(file) {
  const names = new Map(), points = new Map();
  await iterateCsv(file, async rows => {
    for (const row of rows) {
      const p = parseSectorRow(row);
      if (!p) continue;
      if (names.has(p.code) && names.get(p.code) !== p.name) throw new Error(`업종명 불일치: ${p.code}`);
      names.set(p.code, p.name);
      const key = `${p.code}:${p.date}`;
      if (points.has(key) && points.get(key).value !== p.value) throw new Error(`업종 시세 중복 불일치: ${key}`);
      points.set(key, p);
    }
  });
  if (!points.size) throw new Error('적재할 업종 지수 자료가 없습니다');
  await withTransaction(async client => {
    for (const [code, name] of names) await client.query(`INSERT INTO macro_indicators
      (indicator_code,display_name,unit,is_game_visible) VALUES ($1,$2,'지수',FALSE)
      ON CONFLICT (indicator_code) DO UPDATE SET display_name=EXCLUDED.display_name`, [code, name]);
    const rows = [...points.values()];
    for (let i=0; i<rows.length; i+=2000) {
      const params = [], tuples = rows.slice(i,i+2000).map(p => {
        params.push(p.code,p.date,p.value);
        return `($${params.length-2},$${params.length-1},$${params.length})`;
      });
      await client.query(`INSERT INTO macro_daily (indicator_code,trade_date,value) VALUES ${tuples.join(',')}
        ON CONFLICT (indicator_code,trade_date) DO NOTHING`, params);
    }
  });
  console.log(`[import_sectors] ${names.size} indices, ${points.size} source observations`);
  return { indices: names.size, observations: points.size };
}

module.exports = { parseSectorRow, importSectors };
if (require.main === module) {
  const file = process.env.SECTOR_CSV || path.join(process.env.DATA_DIR || '.',
    'market_indicator/data/raw/kr_sector_indices_long_20130101_20231231.csv');
  importSectors(file).catch(error => { console.error(error); process.exitCode=1; }).finally(() => pool.end());
}
