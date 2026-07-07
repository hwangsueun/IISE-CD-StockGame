// 뉴스 조회 (NEWS_DATA_CONTRACT.md 계약 소비)
// - 턴 배치는 game_publish_date 기준 (계약 §5)
// - 스트레스 구간별 열람 한도 적용, 실제 노출분은 news_exposure에 기록
// - 강도(strength) 높은 뉴스 우선 노출
const { query } = require('../db');
const stressPolicy = require('./stressPolicy');
const C = require('../config/constants');

/** DB row -> 게임 응답 DTO. 원 회사명 노출 방지를 위해 masked 표시명 사용 */
function toNewsDto(r) {
  return {
    newsId: r.news_id,
    category: r.category,               // market_sector | market_macro | stock_disclosure | annual_earnings | split_article
    date: iso(r.game_publish_date),
    headline: r.news_lines?.[0] ?? '',  // 계약 권장: title = news_lines[0]
    lines: r.news_lines,                // 완성형 기사 문장 배열
    eventType: r.event_type,
    direction: r.direction,             // positive | negative | neutral (호재/악재 연출)
    strength: r.strength,               // 강조도
    market: r.market,
    sector: r.sector,
    macroLabel: r.macro_asset_label,
    assetId: r.asset_id,
    assetName: r.masked_name || null,   // 종목 뉴스 -> 마스킹된 종목명
    eventFamily: r.event_family,
    articleType: r.article_type,
    businessYear: r.business_year,
  };
}

/**
 * 날짜별 뉴스. sessionId가 있으면:
 *  - 세션 스트레스 기준 열람 한도(newsLimit) 적용
 *  - 노출된 뉴스를 news_exposure에 기록 (캘린더 과거뉴스 = 노출분만)
 */
async function getNewsByDate(date, { sessionId, category } = {}) {
  const params = [date];
  let where = `n.game_publish_date = $1`;
  if (category) {
    params.push(category);
    where += ` AND n.category = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT n.*, a.masked_name
     FROM news n LEFT JOIN assets a ON a.asset_id = n.asset_id
     WHERE ${where}
     ORDER BY n.strength DESC NULLS LAST, n.news_id
     LIMIT $${params.push(C.NEWS_MAX_PER_DAY) && params.length}`,
    params
  );

  let newsLimit = C.NEWS_MAX_PER_DAY;
  let visible = rows;

  if (sessionId) {
    const { rows: sRows } = await query(
      `SELECT stress FROM game_sessions WHERE id = $1`,
      [sessionId]
    );
    if (sRows[0]) {
      newsLimit = stressPolicy.newsLimitFor(sRows[0].stress);
      visible = rows.slice(0, newsLimit);
      if (visible.length > 0) {
        // 노출 기록 (중복 무시)
        const values = visible.map((_, i) => `($1, $2, $${i + 3})`).join(',');
        await query(
          `INSERT INTO news_exposure (session_id, game_date, news_id)
           VALUES ${values} ON CONFLICT DO NOTHING`,
          [sessionId, date, ...visible.map((r) => r.news_id)]
        );
      }
    }
  }

  return {
    date,
    newsLimit,
    totalCount: rows.length,
    hiddenCount: rows.length - visible.length, // "스트레스로 못 본 뉴스 N건" 연출용
    news: visible.map(toNewsDto),
  };
}

/** 날짜+자산별 뉴스 (종목 상세 화면). 분할기사 1·2부 포함. */
async function getNewsByDateAndAsset(date, assetId) {
  const { rows } = await query(
    `SELECT n.*, a.masked_name
     FROM news n LEFT JOIN assets a ON a.asset_id = n.asset_id
     WHERE n.asset_id = $2 AND n.game_publish_date <= $1
     ORDER BY n.game_publish_date DESC, n.strength DESC NULLS LAST
     LIMIT 30`,
    [date, assetId]
  );
  return rows.map(toNewsDto);
}

/** 세션이 실제로 본 과거 뉴스 (캘린더 화면) */
async function getExposedNews(sessionId, date) {
  const { rows } = await query(
    `SELECT n.*, a.masked_name
     FROM news_exposure e
     JOIN news n ON n.news_id = e.news_id
     LEFT JOIN assets a ON a.asset_id = n.asset_id
     WHERE e.session_id = $1 AND e.game_date = $2
     ORDER BY n.strength DESC NULLS LAST`,
    [sessionId, date]
  );
  return rows.map(toNewsDto);
}

function iso(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

module.exports = { getNewsByDate, getNewsByDateAndAsset, getExposedNews, toNewsDto };
