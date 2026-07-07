// 캘린더 메모 CRUD (날짜당 1건, 100자)
const { query } = require('../db');
const { notFound, conflict } = require('../utils/errors');

async function list(sessionId, date) {
  const params = [sessionId];
  let where = `session_id = $1`;
  if (date) {
    params.push(date);
    where += ` AND game_date = $2`;
  }
  const { rows } = await query(
    `SELECT id, game_date, content FROM memos WHERE ${where} ORDER BY game_date`,
    params
  );
  return rows;
}

async function create(sessionId, date, content) {
  try {
    const { rows } = await query(
      `INSERT INTO memos (session_id, game_date, content) VALUES ($1, $2, $3)
       RETURNING id, game_date, content`,
      [sessionId, date, content]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw conflict('해당 날짜에 이미 메모가 있습니다');
    throw err;
  }
}

async function update(sessionId, memoId, content) {
  const { rows } = await query(
    `UPDATE memos SET content = $3 WHERE id = $2 AND session_id = $1
     RETURNING id, game_date, content`,
    [sessionId, memoId, content]
  );
  if (!rows[0]) throw notFound('메모를 찾을 수 없습니다');
  return rows[0];
}

async function remove(sessionId, memoId) {
  const { rowCount } = await query(
    `DELETE FROM memos WHERE id = $2 AND session_id = $1`,
    [sessionId, memoId]
  );
  if (rowCount === 0) throw notFound('메모를 찾을 수 없습니다');
}

module.exports = { list, create, update, remove };
