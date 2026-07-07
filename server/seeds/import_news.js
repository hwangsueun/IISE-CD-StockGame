// 뉴스 4종 JSONL -> news 테이블 (NEWS_DATA_CONTRACT.md 계약 소비)
// 원천: $DATA_DIR/news_generator/data/interim/game_publish_calendar/*.game.jsonl
//       (또는 Drive game_news_data/ 다운로드 폴더를 NEWS_DIR로 지정)
const path = require('path');
const fs = require('fs');
const { iterateJsonl } = require('./lib/jsonl');
const { bulkInsert, pool } = require('./lib/db');

const FILES = [
  'market_news.game.jsonl',
  'stock_news.game.jsonl',
  'annual_earnings_news.game.jsonl',
  'split_articles.game.jsonl',
];

const COLS = [
  'news_id', 'category', 'publish_date', 'game_publish_date', 'news_lines',
  'event_type', 'direction', 'strength', 'market', 'sector', 'macro_asset_label',
  'stock_code', 'asset_id', 'event_family', 'claim_level', 'news_type', 'bundle_id',
  'business_year', 'date_basis', 'fs_div',
  'article_type', 'source_custom_id', 'source_rcept_no', 'material_reason',
];

/** 계약 객체 -> news 테이블 행 (계약 필드명 그대로 매핑) */
function toRow(n, stockCodeToAssetId) {
  const stockCode = n.stock_code || null;
  return [
    n.news_id || n.article_id,                      // split_articles는 article_id가 PK
    n.category,
    n.publish_date,
    n.game_publish_date,
    JSON.stringify(n.news_lines || []),
    n.event_type || null,
    n.direction || null,
    n.strength ?? null,
    n.market || null,
    n.sector || null,
    n.category === 'market_macro' ? n.asset_id || null : null, // 계약의 asset_id = 지표명 문자열
    stockCode,
    stockCode ? stockCodeToAssetId.get(stockCode) || null : null,
    n.event_family || null,
    n.claim_level || null,
    n.news_type || null,
    n.bundle_id || null,
    n.business_year ?? null,
    n.date_basis || null,
    n.fs_div ?? null,
    n.article_type || null,
    n.source_custom_id || null,
    n.source_rcept_no || null,
    n.material_reason || null,
  ];
}

async function importNews(newsDir) {
  // 종목코드 -> asset_id 매칭 (계약 §2: stock_code로 종목 마스터와 조인)
  const { rows } = await pool.query(
    `SELECT code, asset_id FROM assets WHERE asset_type = 'stock'`
  );
  const codeMap = new Map(rows.map((r) => [r.code, r.asset_id]));

  let total = 0;
  for (const file of FILES) {
    const fp = path.join(newsDir, file);
    if (!fs.existsSync(fp)) {
      console.warn(`[import_news] 없음, 건너뜀: ${fp}`);
      continue;
    }
    let count = 0;
    await iterateJsonl(fp, async (batch) => {
      count += await bulkInsert('news', COLS, batch.map((n) => toRow(n, codeMap)));
    });
    console.log(`[import_news] ${file}: ${count}건`);
    total += count;
  }
  return total;
}

module.exports = { importNews };

if (require.main === module) {
  const dir =
    process.env.NEWS_DIR ||
    path.join(process.env.DATA_DIR || '.', 'news_generator/data/interim/game_publish_calendar');
  importNews(dir)
    .then((n) => { console.log(`완료: ${n}건`); return pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
