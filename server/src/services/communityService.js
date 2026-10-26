// 종토방 (읽기 전용 NPC) — dci_posts_ready/dci_comments_ready 적재분
const { query } = require('../db');
const { concealYearsInText } = require('./newsService');

function toCommunityDto(row, referenceDate) {
  const result = { ...row };
  for (const field of ['title', 'body']) {
    if (typeof row[field] === 'string') result[field] = concealYearsInText(row[field], referenceDate);
  }
  return result;
}

/** 종목별 게시글 목록. date 기준 과거 글만 노출 (미래 정보 차단). */
async function listPosts(assetId, date, limit) {
  const params = [assetId];
  let where = `asset_id = $1 AND EXISTS (SELECT 1 FROM assets a WHERE a.asset_id = $1 AND a.asset_type = 'stock')`;
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
  return rows.map(row => toCommunityDto(row, date || row.post_date));
}

async function listComments(postId, referenceDate) {
  const { rows } = await query(
    `SELECT id, npc_nickname, body, comment_date, sentiment
     FROM community_comments WHERE post_id = $1
       AND ($2::date IS NULL OR comment_date <= $2::date)
       AND EXISTS (SELECT 1 FROM community_posts p JOIN assets a USING(asset_id)
                   WHERE p.id = $1 AND a.asset_type = 'stock') ORDER BY id`,
    [postId, referenceDate || null]
  );
  return rows.map(row => toCommunityDto(row, referenceDate || row.comment_date));
}

module.exports = { listPosts, listComments, toCommunityDto };
