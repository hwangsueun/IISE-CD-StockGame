// 종토방 (읽기 전용 NPC) — dci_posts_ready/dci_comments_ready 적재분
const { query } = require('../db');

/** 종목별 게시글 목록. date 기준 과거 글만 노출 (미래 정보 차단). */
async function listPosts(assetId, date, limit) {
  const params = [assetId];
  let where = `asset_id = $1`;
  if (date) {
    params.push(date);
    where += ` AND post_date <= $${params.length}`;
  }
  params.push(limit);
  const { rows } = await query(
    `SELECT id, post_date, npc_nickname, title, body, view_count, recommend_count, sentiment
     FROM community_posts
     WHERE ${where}
     ORDER BY post_date DESC, id DESC
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

async function listComments(postId) {
  const { rows } = await query(
    `SELECT id, npc_nickname, body, comment_date, sentiment
     FROM community_comments WHERE post_id = $1 ORDER BY id`,
    [postId]
  );
  return rows;
}

module.exports = { listPosts, listComments };
