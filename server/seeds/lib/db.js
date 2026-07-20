// 시드 전용 DB 헬퍼 (bulk insert)
const { pool } = require('../../src/db');

/**
 * 다행 INSERT.
 * @param {string} table
 * @param {string[]} columns
 * @param {any[][]} rows - 각 원소가 columns 순서의 값 배열
 * @param {string} conflictClause - 예: 'ON CONFLICT DO NOTHING'
 */
// PostgreSQL 프로토콜의 바인드 파라미터 상한. Bind 메시지의 파라미터 개수 필드가 int16라
// 65,535개를 넘으면 조용히 오버플로우돼 프로토콜이 깨진다(실측: 파라미터 75,217개를 보내면
// 75217 % 65536 = 9,681로 잘려 "bind message has 9681 parameter formats but 0 parameters"
// 에러가 난다). 스텁 데이터(29자산/300거래일)는 이 선을 넘지 않아 드러나지 않았고,
// 실데이터(117종목 × 2,700여 거래일)에서 처음 재현됐다.
const MAX_BIND_PARAMS = 65535;

/** 한 번에 보낼 수 있는 최대 행 수. 여유를 두고 상한의 90%만 쓴다. */
function chunkSize(columnCount) {
  if (columnCount <= 0) return 1;
  return Math.max(1, Math.floor((MAX_BIND_PARAMS * 0.9) / columnCount));
}

async function bulkInsert(table, columns, rows, conflictClause = 'ON CONFLICT DO NOTHING') {
  if (rows.length === 0) return 0;
  const size = chunkSize(columns.length);
  let total = 0;
  for (let offset = 0; offset < rows.length; offset += size) {
    const slice = rows.slice(offset, offset + size);
    const params = [];
    const tuples = slice.map((row) => {
      const ph = row.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `(${ph.join(',')})`;
    });
    const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES ${tuples.join(',')} ${conflictClause}`;
    const res = await pool.query(sql, params);
    total += res.rowCount;
  }
  return total;
}

/**
 * DATE 값을 'YYYY-MM-DD' 문자열로 정규화한다.
 *
 * src/db.js가 `types.setTypeParser(DATE, v => v)`로 DATE를 문자열 그대로 받도록 설정해 뒀다
 * (게임 달력이 날짜 단위라 타임존 변환이 끼면 하루가 밀리기 때문). 따라서 DB에서 읽은
 * trade_date는 Date 객체가 아니라 문자열이다. 반면 xlsx/CSV 파서가 만든 값은 Date 객체다.
 * 두 경로가 한 파일에서 섞이면 `.toISOString()` 호출이 터진다 - 실제로 import_bonds(회사채)와
 * import_coins(환율)가 macro_daily를 다시 읽는 지점에서 재현됐다.
 */
function toIsoDate(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

module.exports = { pool, bulkInsert, toIsoDate };
