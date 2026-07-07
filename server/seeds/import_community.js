// 종토방 적재 (읽기 전용 NPC)
// 원천: $DATA_DIR/npc_generator/data/processed/dci_posts_ready.csv / dci_comments_ready.csv
// gall_id -> 종목코드 매핑표가 필요하다 (갤러리별 대상 종목).
// TODO(data): npc 담당의 갤러리-종목 매핑 확정본으로 GALL_TO_STOCK_CODE 교체
const path = require('path');
const fs = require('fs');
const { iterateCsv } = require('./lib/csv');
const { bulkInsert, pool } = require('./lib/db');

/** 갤러리 ID -> 6자리 종목코드. 미매핑 갤러리는 asset_id NULL(시장 일반글)로 적재. */
const GALL_TO_STOCK_CODE = {
  // 예: 'samsungelec': '005930',
};

async function importCommunity(postsCsv, commentsCsv) {
  const { rows } = await pool.query(`SELECT code, asset_id FROM assets WHERE asset_type = 'stock'`);
  const codeMap = new Map(rows.map((r) => [r.code, r.asset_id]));
  const assetOf = (gallId) => {
    const code = GALL_TO_STOCK_CODE[gallId];
    return code ? codeMap.get(code) || null : null;
  };

  // --- 게시글 ---
  // 원본 post_id -> 게임 DB id 매핑 (댓글 연결용)
  const postIdMap = new Map();
  let postCount = 0;
  if (fs.existsSync(postsCsv)) {
    await iterateCsv(postsCsv, async (batch) => {
      for (const p of batch) {
        const date = (p.post_date_final || p.date || '').slice(0, 10);
        if (!date) continue;
        const { rows: ins } = await pool.query(
          `INSERT INTO community_posts
             (source_post_id, gall_id, post_date, asset_id, npc_nickname, title, body,
              view_count, recommend_count, dislike_count)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [p.post_id, p.gall_id, date, assetOf(p.gall_id), p.author || 'ㅇㅇ',
           (p.title || '').slice(0, 300), p.content || '',
           Number(p.view_count) || 0, Number(p.recommend_count) || 0, Number(p.dislike_count) || 0]
        );
        postIdMap.set(`${p.gall_id}:${p.post_id}`, ins[0].id);
        postCount++;
      }
    }, 500);
    console.log(`[import_community] posts ${postCount}건`);
  } else {
    console.warn(`[import_community] 없음, 건너뜀: ${postsCsv}`);
  }

  // --- 댓글 ---
  let commentCount = 0;
  if (fs.existsSync(commentsCsv)) {
    await iterateCsv(commentsCsv, async (batch) => {
      const rows = [];
      for (const c of batch) {
        const dbPostId = postIdMap.get(`${c.gall_id}:${c.post_id}`);
        if (!dbPostId) continue; // 게시글 미적재분 댓글은 버림
        rows.push([
          dbPostId, c.author || 'ㅇㅇ', c.content || '',
          (c.comment_date_final || '').slice(0, 10) || null,
        ]);
      }
      commentCount += await bulkInsert(
        'community_comments', ['post_id', 'npc_nickname', 'body', 'comment_date'], rows
      );
    }, 500);
    console.log(`[import_community] comments ${commentCount}건`);
  }
  return postCount + commentCount;
}

module.exports = { importCommunity };

if (require.main === module) {
  const base = path.join(process.env.DATA_DIR || '.', 'npc_generator/data/processed');
  importCommunity(
    process.env.POSTS_CSV || path.join(base, 'dci_posts_ready.csv'),
    process.env.COMMENTS_CSV || path.join(base, 'dci_comments_ready.csv')
  )
    .then(() => pool.end())
    .catch((e) => { console.error(e); process.exit(1); });
}
