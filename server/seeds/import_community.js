// 종토방 적재 (읽기 전용 NPC) — 스레드 단위 JSONL (003_final_data_alignment.sql 계약)
// 원천(단일 파일, 최종본만 사용):
//   $DATA_DIR/npc_generator/data/processed/dci_board_rewritten/board_threads_validated_final_screened.jsonl
//   (2,502 스레드. 혐오발언 스크리닝 + 봇 제거 + 닉네임 재부여 완료본)
// 같은 폴더의 board_threads_validated_final.jsonl(스크리닝 전, 2,585건)이나 *.bak_* 파일은
// 이전 단계 산출물이므로 쓰지 않는다.
//
// 레코드 구조(1줄 = 스레드 1건 = 게시글 1 + 댓글 N):
//   thread_uid, candidate_id, target_kind(stock|coin), target_id, date,
//   post{author_key, posted_at, title, body}, comments[{author_key, commented_at, text}],
//   provenance{thread_key, gall_id, candidate_type}, flags{...}, nickname_map{author_key: 닉네임}
//
// target_kind/target_id -> assets.asset_id 직접 매핑(예전 GALL_TO_STOCK_CODE 추정 매핑은 폐기).
// 미매칭이어도 스레드는 적재하되 asset_id는 NULL로 두고, 미매칭 target_id 요약을 로그로 남긴다.
// thread_uid가 자연키이며 community_posts(thread_uid)에 UNIQUE 인덱스가 있어(003) 재적재 시
// UPSERT한다. 댓글에는 유니크 제약이 없어(001/003 모두 seq는 일반 인덱스) 재적재 멱등성을
// "해당 post_id의 댓글 전량 삭제 후 재삽입"으로 보장한다.
const path = require('path');
const fs = require('fs');
const { iterateJsonl } = require('./lib/jsonl');
const { pool } = require('./lib/db');
const {
  maskText, createResidualTracker, getUnresolvedTokenReport, resetUnresolvedTokenStats,
} = require('../src/services/maskingService');

const TITLE_MAX = 300;

// maskText는 {{STOCK_code}}/{{COIN_id}} 토큰을 텍스트 안의 코드/id만으로 전역 해석한다
// (maskingService.js §3 참고 - 스레드가 자기 자신의 target을 몰라도 됨). 그래서 예전
// maskCommunityText(text, targetKind, targetId, scope)가 받던 targetKind/targetId 인자가
// 더 이상 필요 없다 - scope만 넘기면 된다.

/** target_kind/target_id -> asset_id 조회 함수를 만든다. stock은 6자리 코드, coin은 coingecko id로 assets.code 조인 */
async function buildAssetIndex() {
  const { rows } = await pool.query(
    `SELECT asset_id, asset_type, code FROM assets WHERE asset_type IN ('stock','coin')`
  );
  const byKind = { stock: new Map(), coin: new Map() };
  for (const r of rows) {
    if (byKind[r.asset_type]) byKind[r.asset_type].set(r.code, r.asset_id);
  }
  return (kind, targetId) => {
    if (!targetId || !byKind[kind]) return null;
    return byKind[kind].get(targetId) || null;
  };
}

function nicknameOf(nicknameMap, authorKey) {
  return (nicknameMap && authorKey && nicknameMap[authorKey]) || authorKey || 'ㅇㅇ';
}

/** 'YYYY-MM-DD HH:MM:SS' -> 'YYYY-MM-DD'. 파싱 실패 시 스레드의 date로 대체 */
function toDateOnly(ts, fallbackDate) {
  if (typeof ts === 'string' && ts.length >= 10) return ts.slice(0, 10);
  return fallbackDate || null;
}

async function importCommunity(threadsJsonl) {
  if (!fs.existsSync(threadsJsonl)) {
    console.warn(`[import_community] 없음, 건너뜀: ${threadsJsonl}`);
    return 0;
  }

  const assetOf = await buildAssetIndex();
  const unmatched = new Map(); // "stock:012345" -> 스레드 수
  const tracker = createResidualTracker('종토방');
  resetUnresolvedTokenStats(); // 이 함수 실행분만 리포트하기 위해 프로세스 전역 카운터 초기화
  let threadCount = 0;
  let postCount = 0;
  let commentCount = 0;

  await iterateJsonl(threadsJsonl, async (batch) => {
    for (const t of batch) {
      threadCount++;
      const maskScope = t.target_kind === 'coin' ? 'coin_board' : 'stock_board';
      const assetId = assetOf(t.target_kind, t.target_id);
      if (!assetId && t.target_id) {
        const key = `${t.target_kind}:${t.target_id}`;
        unmatched.set(key, (unmatched.get(key) || 0) + 1);
      }

      const post = t.post || {};
      const nicknameMap = t.nickname_map || {};
      const rawTitle = (post.title || '').slice(0, TITLE_MAX);
      const rawBody = post.body || '';
      const maskedTitle = maskText(rawTitle, maskScope).slice(0, TITLE_MAX);
      const maskedBody = maskText(rawBody, maskScope);
      tracker.record(maskedTitle, maskScope);
      tracker.record(maskedBody, maskScope);

      const { rows: upserted } = await pool.query(
        `INSERT INTO community_posts (
           thread_uid, candidate_id, target_kind, target_id, candidate_type,
           source_post_id, gall_id, post_date, asset_id,
           npc_nickname, author_key, posted_at,
           title, body, raw_title, raw_body
         ) VALUES (
           $1,$2,$3,$4,$5, $6,$7,$8,$9, $10,$11,$12, $13,$14,$15,$16
         )
         ON CONFLICT (thread_uid) DO UPDATE SET
           candidate_id   = EXCLUDED.candidate_id,
           target_kind    = EXCLUDED.target_kind,
           target_id      = EXCLUDED.target_id,
           candidate_type = EXCLUDED.candidate_type,
           source_post_id = EXCLUDED.source_post_id,
           gall_id        = EXCLUDED.gall_id,
           post_date      = EXCLUDED.post_date,
           asset_id       = EXCLUDED.asset_id,
           npc_nickname   = EXCLUDED.npc_nickname,
           author_key     = EXCLUDED.author_key,
           posted_at      = EXCLUDED.posted_at,
           title          = EXCLUDED.title,
           body           = EXCLUDED.body,
           raw_title      = EXCLUDED.raw_title,
           raw_body       = EXCLUDED.raw_body
         RETURNING id`,
        [
          t.thread_uid, t.candidate_id, t.target_kind, t.target_id,
          (t.provenance && t.provenance.candidate_type) || null,
          (t.provenance && t.provenance.thread_key) || null,
          (t.provenance && t.provenance.gall_id) || null,
          t.date, assetId,
          nicknameOf(nicknameMap, post.author_key), post.author_key || null, post.posted_at || null,
          maskedTitle, maskedBody, rawTitle, rawBody,
        ]
      );
      const postId = upserted[0].id;
      postCount++;

      // 댓글: (post_id, seq)에 유니크 제약이 없어 재적재 멱등성을 "전량 삭제 후 재삽입"으로 보장한다.
      await pool.query(`DELETE FROM community_comments WHERE post_id = $1`, [postId]);
      const comments = t.comments || [];
      if (comments.length) {
        const values = [];
        const params = [];
        comments.forEach((c, idx) => {
          const rawBodyC = c.text || '';
          const maskedBodyC = maskText(rawBodyC, maskScope);
          tracker.record(maskedBodyC, maskScope);
          const base = params.length;
          params.push(
            postId, idx, nicknameOf(nicknameMap, c.author_key), c.author_key || null,
            c.commented_at || null, toDateOnly(c.commented_at, t.date),
            maskedBodyC, rawBodyC
          );
          values.push(
            `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8})`
          );
        });
        await pool.query(
          `INSERT INTO community_comments
             (post_id, seq, npc_nickname, author_key, commented_at, comment_date, body, raw_body)
           VALUES ${values.join(',')}`,
          params
        );
        commentCount += comments.length;
      }
    }
  });

  console.log(`[import_community] threads ${threadCount} / posts ${postCount} / comments ${commentCount}`);
  if (unmatched.size) {
    const totalThreads = [...unmatched.values()].reduce((a, b) => a + b, 0);
    console.warn(
      `[import_community] 미매칭 target_id ${unmatched.size}종 (스레드 ${totalThreads}건, asset_id NULL로 적재됨) - 데이터 담당 확인 필요:`
    );
    for (const [key, cnt] of [...unmatched.entries()].sort((a, b) => b[1] - a[1])) {
      console.warn(`  ${key}: ${cnt}건`);
    }
  } else {
    console.log('[import_community] 미매칭 target_id 없음 (전 스레드 asset_id 매칭 완료)');
  }

  // 마스킹 요약 리포트 (적재 실패로 이어지지 않음 - 데이터 담당이 사전을 보강할 근거)
  tracker.report();
  const tokenReport = getUnresolvedTokenReport();
  if (tokenReport.total) {
    console.warn(
      `[import_community] 미해석 {{STOCK_x}}/{{COIN_x}} 토큰 ${tokenReport.total}건(${tokenReport.distinct}종) - 원문 그대로 유지됨:`
    );
    tokenReport.entries.slice(0, 20).forEach((e) => console.warn(`  ${e.key}: ${e.count}건`));
  } else {
    console.log('[import_community] 미해석 토큰 없음');
  }

  return postCount + commentCount;
}

module.exports = { importCommunity };

if (require.main === module) {
  const fp =
    process.env.COMMUNITY_JSONL ||
    path.join(
      process.env.DATA_DIR || '.',
      'npc_generator/data/processed/dci_board_rewritten/board_threads_validated_final_screened.jsonl'
    );
  importCommunity(fp)
    .then(() => pool.end())
    .catch((e) => { console.error(e); process.exit(1); });
}
