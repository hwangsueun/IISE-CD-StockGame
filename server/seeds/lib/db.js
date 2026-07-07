// 시드 전용 DB 헬퍼 (bulk insert)
const { pool } = require('../../src/db');

/**
 * 다행 INSERT.
 * @param {string} table
 * @param {string[]} columns
 * @param {any[][]} rows - 각 원소가 columns 순서의 값 배열
 * @param {string} conflictClause - 예: 'ON CONFLICT DO NOTHING'
 */
async function bulkInsert(table, columns, rows, conflictClause = 'ON CONFLICT DO NOTHING') {
  if (rows.length === 0) return 0;
  const params = [];
  const tuples = rows.map((row) => {
    const ph = row.map((v) => {
      params.push(v);
      return `$${params.length}`;
    });
    return `(${ph.join(',')})`;
  });
  const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES ${tuples.join(',')} ${conflictClause}`;
  const res = await pool.query(sql, params);
  return res.rowCount;
}

module.exports = { pool, bulkInsert };
