// 뉴스 조회 (NEWS_DATA_CONTRACT.md 계약 소비)
// - 턴 배치는 game_publish_date 기준 (계약 §5)
// - 스트레스 구간별 열람 한도 적용, 실제 노출분은 news_exposure에 기록
// - 강도(strength) 높은 뉴스 우선 노출
const { query } = require('../db');
const stressPolicy = require('./stressPolicy');
const C = require('../config/constants');

const YEAR_SUFFIX_RE = /(?<!\d)((?:1|2)\d{3})\s*(년(?:도|대|형|산)?)/g;
const FY_TOKEN_RE = /\bFY\s*((?:1|2)\d{3})(?:\s*년(?:도)?)?/gi;
const FY_RANGE_RE = /\bFY\s*((?:1|2)\d{3})\s*([~～–—-])\s*(?:FY\s*)?((?:1|2)\d{3})(?:\s*년(?:도)?)?/gi;
const YEAR_RANGE_RE = /(?<![\dA-Za-z])((?:1|2)\d{3})(?:\s*년(?:도)?)?\s*([~～–—-])\s*((?:1|2)\d{3})(?:\s*년(?:도)?)?(?![\dA-Za-z])/g;
const FISCAL_YEAR_RE = /(?<![\dA-Za-z])((?:1|2)\d{3})\s*(회계연도|사업연도)/g;
const NUMERIC_DATE_RE = /(?<![\dA-Za-z])((?:1|2)\d{3})([-./])(\d{1,2})\2(\d{1,2})(?!\d)/g;

function yearFromGameDate(value) {
  if (value instanceof Date) {
    const year = value.getUTCFullYear();
    return Number.isInteger(year) && year >= 1000 && year <= 2999 ? year : null;
  }
  const match = /^(\d{4})(?:$|[-/.])/.exec(String(value ?? '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isInteger(year) && year >= 1000 && year <= 2999 ? year : null;
}

/** 게임 플레이 날짜 기준 상대 표현. 미래 연도는 숫자를 노출하지 않는다. */
function relativeYearLabel(year, gameDateOrYear) {
  const y = Number(year);
  const now = yearFromGameDate(gameDateOrYear);
  if (!Number.isInteger(y) || y < 1000 || y > 2999) return '연도 비공개';
  if (now === null) return '연도 비공개';
  if (y < now) return `${now - y}년 전`;
  if (y === now) return '올해';
  return '향후 연도';
}

/**
 * 뉴스 본문 등 표시 문자열의 연도를 상대 표현으로 치환한다.
 * 명시적 연도 문맥만 대상으로 하며 일반 4자리 수·표준번호·식별자·금액은 보존한다.
 */
function concealYearsInText(value, gameDateOrYear) {
  if (typeof value !== 'string' || value.length === 0) return value;
  const now = yearFromGameDate(gameDateOrYear);
  return value
    .replace(FY_RANGE_RE, (_match, fromYear, separator, toYear) =>
      `${relativeYearLabel(fromYear, now)}${separator}${relativeYearLabel(toYear, now)} 회계연도`)
    .replace(YEAR_RANGE_RE, (_match, fromYear, separator, toYear) =>
      `${relativeYearLabel(fromYear, now)}${separator}${relativeYearLabel(toYear, now)}`)
    .replace(NUMERIC_DATE_RE, (match, year, _separator, month, day) => {
      const monthNumber = Number(month);
      const dayNumber = Number(day);
      if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) return match;
      return `${relativeYearLabel(year, now)} ${monthNumber}월 ${dayNumber}일`;
    })
    .replace(FY_TOKEN_RE, (_match, year) => `${relativeYearLabel(year, now)} 회계연도`)
    .replace(FISCAL_YEAR_RE, (_match, year, kind) => `${relativeYearLabel(year, now)} ${kind}`)
    .replace(YEAR_SUFFIX_RE, (_match, year, suffix) => {
      const label = relativeYearLabel(year, now);
      if (suffix.endsWith('대')) return `${label} 무렵`;
      if (suffix.endsWith('형')) return `${label} 모델`;
      if (suffix.endsWith('산')) return `${label} 생산`;
      return label;
    });
}

function concealBusinessYear(value, gameDateOrYear) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isInteger(numeric)
    ? relativeYearLabel(numeric, gameDateOrYear)
    : concealYearsInText(String(value), gameDateOrYear);
}

/** DB row -> 게임 응답 DTO. 원 회사명 노출 방지를 위해 masked 표시명 사용 */
function toNewsDto(r, gameDateOrYear) {
  // 호출자가 현재 게임 턴 날짜를 주면 그것을 우선한다. 단독 변환 시에는
  // 기사 배치 날짜를 현재로 삼으며, 어떤 경우에도 시스템 시각을 참조하지 않는다.
  const referenceDate = gameDateOrYear
    ?? r.game_publish_date
    ?? r.gamePublishDate
    ?? r.date;
  const publishDate = r.game_publish_date ?? r.gamePublishDate ?? r.date;
  const clean = (value) => concealYearsInText(value, referenceDate);
  const lines = Array.isArray(r.news_lines)
    ? r.news_lines.map((line) => clean(String(line)))
    : [];
  return {
    newsId: r.news_id,
    category: r.category,               // market_sector | market_macro | stock_disclosure | annual_earnings | split_article
    date: iso(publishDate),
    headline: lines[0] ?? '',            // 계약 권장: title = news_lines[0]
    lines,                               // 완성형 기사 문장 배열
    eventType: clean(r.event_type),
    direction: r.direction,             // positive | negative | neutral (호재/악재 연출)
    strength: r.strength,               // 강조도
    market: clean(r.market),
    sector: clean(r.sector),
    macroLabel: clean(r.macro_asset_label),
    assetId: r.asset_id,
    assetName: clean(r.masked_name) || null, // 종목 뉴스 -> 마스킹된 종목명
    eventFamily: clean(r.event_family),
    articleType: clean(r.article_type),
    businessYear: concealBusinessYear(r.business_year, referenceDate),
  };
}

/**
 * 날짜별 뉴스. sessionId가 있으면:
 *  - 세션 스트레스 기준 열람 한도(newsLimit) 적용
 *  - 노출된 뉴스를 news_exposure에 기록 (캘린더 과거뉴스 = 노출분만)
 */
async function getNewsByDate(date, { sessionId, category, referenceDate } = {}) {
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
    news: visible.map((row) => toNewsDto(row, referenceDate ?? date)),
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
  return rows.map((row) => toNewsDto(row, date));
}

/** 세션이 실제로 본 과거 뉴스 (캘린더 화면) */
async function getExposedNews(sessionId, date, referenceDate = date) {
  const { rows } = await query(
    `SELECT n.*, a.masked_name
     FROM news_exposure e
     JOIN news n ON n.news_id = e.news_id
     LEFT JOIN assets a ON a.asset_id = n.asset_id
     WHERE e.session_id = $1 AND e.game_date = $2
     ORDER BY n.strength DESC NULLS LAST`,
    [sessionId, date]
  );
  return rows.map((row) => toNewsDto(row, referenceDate));
}

function iso(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

module.exports = {
  getNewsByDate,
  getNewsByDateAndAsset,
  getExposedNews,
  toNewsDto,
  concealYearsInText,
  relativeYearLabel,
};
