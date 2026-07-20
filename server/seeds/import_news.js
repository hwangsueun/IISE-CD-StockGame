// 뉴스 4종 JSONL -> news 테이블 (NEWS_DATA_CONTRACT.md 계약 소비)
// 원천: $DATA_DIR/news_generator/data/interim/game_publish_calendar/*.game.jsonl
//       (또는 Drive game_news_data/ 다운로드 폴더를 NEWS_DIR로 지정)
//
// 마스킹 대상: news_lines의 각 문장 + stock_name 필드(계약에는 있으나 news 테이블에는
// 저장 컬럼이 없다 - 001_init.sql/003 어디에도 stock_name 컬럼이 없고, 화면 표시명은
// assets.masked_name을 JOIN해서 쓴다(newsService.toNewsDto의 assetName). 그래서 마스킹된
// stock_name 값 자체는 DB에 넣을 곳이 없지만, 그래도 마스킹 + 잔존 검사(§3)는 여기서
// 수행한다 - news_lines 문장이 사실상 stock_name을 문장 안에 그대로 포함하는 경우가
// 많아 이미 news_lines 마스킹으로 커버되지만, 혹시 stock_name만 별도로 노출되는 경로가
// 나중에 생기더라도 마스킹 로직이 이미 검증돼 있도록 대비해 둔다.
const path = require('path');
const fs = require('fs');
const { iterateJsonl } = require('./lib/jsonl');
const { bulkInsert, pool } = require('./lib/db');
const {
  maskText, createResidualTracker, getUnresolvedTokenReport, resetUnresolvedTokenStats,
} = require('../src/services/maskingService');

const FILES = [
  'market_news.game.jsonl',
  'stock_news.game.jsonl',
  'annual_earnings_news.game.jsonl',
  'split_articles.game.jsonl',
];

const COLS = [
  'news_id', 'category', 'publish_date', 'game_publish_date', 'news_lines', 'raw_news_lines',
  'event_type', 'direction', 'strength', 'market', 'sector', 'macro_asset_label',
  'stock_code', 'asset_id', 'event_family', 'claim_level', 'news_type', 'bundle_id',
  'business_year', 'date_basis', 'fs_div',
  'article_type', 'source_custom_id', 'source_rcept_no', 'material_reason',
  'is_masked',
];

/** 계약 객체 -> news 테이블 행 (계약 필드명 그대로 매핑). news_lines는 마스킹 후 값, raw_news_lines는 원문 보존 */
function toRow(n, stockCodeToAssetId, tracker) {
  const stockCode = n.stock_code || null;
  const rawLines = n.news_lines || [];
  const maskedLines = rawLines.map((line) => maskText(line, 'news'));
  maskedLines.forEach((line) => tracker.record(line, 'news'));
  if (n.stock_name) tracker.record(maskText(n.stock_name, 'news'), 'news'); // 저장 안 함(위 주석) - 검사만
  return [
    n.news_id || n.article_id,                      // split_articles는 article_id가 PK
    n.category,
    n.publish_date,
    n.game_publish_date,
    JSON.stringify(maskedLines),
    JSON.stringify(rawLines),
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
    true,                                             // is_masked: ETL이 마스킹 완료 후 적재
  ];
}

async function importNews(newsDir) {
  // 종목코드 -> asset_id 매칭 (계약 §2: stock_code로 종목 마스터와 조인)
  const { rows } = await pool.query(
    `SELECT code, asset_id FROM assets WHERE asset_type = 'stock'`
  );
  const codeMap = new Map(rows.map((r) => [r.code, r.asset_id]));
  const tracker = createResidualTracker('news 4종');
  resetUnresolvedTokenStats(); // 이 함수 실행분만 리포트하기 위해 프로세스 전역 카운터 초기화

  let total = 0;
  for (const file of FILES) {
    const fp = path.join(newsDir, file);
    if (!fs.existsSync(fp)) {
      console.warn(`[import_news] 없음, 건너뜀: ${fp}`);
      continue;
    }
    let count = 0;
    await iterateJsonl(fp, async (batch) => {
      count += await bulkInsert('news', COLS, batch.map((n) => toRow(n, codeMap, tracker)));
    });
    console.log(`[import_news] ${file}: ${count}건`);
    total += count;
  }

  // 마스킹 요약 리포트 (적재 실패로 이어지지 않음 - 데이터 담당이 사전을 보강할 근거)
  tracker.report();
  const tokenReport = getUnresolvedTokenReport();
  if (tokenReport.total) {
    console.warn(
      `[import_news] 미해석 {{STOCK_x}}/{{COIN_x}} 토큰 ${tokenReport.total}건(${tokenReport.distinct}종) - 원문 그대로 유지됨:`
    );
    tokenReport.entries.slice(0, 20).forEach((e) => console.warn(`  ${e.key}: ${e.count}건`));
  } else {
    console.log('[import_news] 미해석 토큰 없음');
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
