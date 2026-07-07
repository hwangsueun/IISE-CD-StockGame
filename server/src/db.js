const { Pool, types } = require('pg');
require('dotenv').config();

// DATE 컬럼을 JS Date(타임존 왜곡)가 아닌 'YYYY-MM-DD' 문자열로 받는다.
// 게임 달력은 날짜 단위이므로 타임존 변환이 끼면 하루가 밀린다.
types.setTypeParser(types.builtins.DATE, (v) => v);

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://admin:password@localhost:5432/antsurvival',
});

/** 단건 쿼리 */
function query(text, params) {
  return pool.query(text, params);
}

/**
 * 트랜잭션 래퍼. 돈/상태값을 바꾸는 서비스는 반드시 이걸 통해 실행한다.
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
