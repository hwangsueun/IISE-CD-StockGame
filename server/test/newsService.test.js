const test = require('node:test');
const assert = require('node:assert/strict');

const { pool } = require('../src/db');
const {
  concealYearsInText,
  relativeYearLabel,
  toNewsDto,
} = require('../src/services/newsService');

test.after(() => pool.end());

test('news years use the game-date distance in explicit year contexts', () => {
  assert.equal(relativeYearLabel(2020, '2026-04-05'), '6년 전');
  assert.equal(relativeYearLabel(2026, '2026-04-05'), '올해');
  assert.equal(relativeYearLabel(2030, '2026-04-05'), '향후 연도');
  assert.equal(
    concealYearsInText('2020년 실적과 2021~2022년 추이, FY2023 자료, 2030년 전망', '2026-04-05'),
    '6년 전 실적과 5년 전~4년 전 추이, 3년 전 회계연도 자료, 향후 연도 전망'
  );
  assert.equal(
    concealYearsInText('2020~2022년, 2021년-2023년도, FY2022~FY2024', '2026-04-05'),
    '6년 전~4년 전, 5년 전-3년 전, 4년 전~2년 전 회계연도'
  );
  assert.equal(
    concealYearsInText('2020 회계연도, 2021사업연도, 2022-03-04, 2023.5.6, 2024/07/08', '2026-04-05'),
    '6년 전 회계연도, 5년 전 사업연도, 4년 전 3월 4일, 3년 전 5월 6일, 2년 전 7월 8일'
  );
});

test('year concealment never falls back to the machine clock', () => {
  assert.equal(relativeYearLabel(2020), '연도 비공개');
  assert.equal(concealYearsInText('2020년 실적'), '연도 비공개 실적');
});

test('bare four-digit numbers, standards, identifiers, counts, and amounts are preserved', () => {
  const text = 'ISO 2020 표준, 2020회, 제2020호, A2020/2020D, 2020억원, $2020';
  assert.equal(concealYearsInText(text, 2026), text);
});

test('news DTO defaults to its game publish date, independent of the machine year', () => {
  const dto = toNewsDto({
    news_id: 'news-1',
    category: 'annual_earnings',
    game_publish_date: '2014-03-04',
    news_lines: ['2010년 연간 실적 발표', '2010~2012 회계연도를 비교했다.', '2030년 목표를 제시했다.'],
    event_type: '2011년 실적',
    direction: 'positive',
    strength: 5,
    market: 'KOSPI',
    sector: '2012년형 반도체',
    macro_asset_label: '2013년 환율',
    asset_id: 'STOCK_1',
    masked_name: '2014년 미래전자',
    event_family: 'FY2009',
    article_type: '2008년 공시',
    business_year: 2010,
  });

  assert.equal(dto.date, '2014-03-04');
  assert.equal(dto.headline, '4년 전 연간 실적 발표');
  assert.deepEqual(dto.lines, [
    '4년 전 연간 실적 발표',
    '4년 전~2년 전 회계연도를 비교했다.',
    '향후 연도 목표를 제시했다.',
  ]);
  assert.equal(dto.eventType, '3년 전 실적');
  assert.equal(dto.sector, '2년 전 모델 반도체');
  assert.equal(dto.macroLabel, '1년 전 환율');
  assert.equal(dto.assetName, '올해 미래전자');
  assert.equal(dto.eventFamily, '5년 전 회계연도');
  assert.equal(dto.articleType, '6년 전 공시');
  assert.equal(dto.businessYear, '4년 전');
});

test('news DTO can use the current game turn while preserving an older article date', () => {
  const dto = toNewsDto({
    news_id: 'news-old',
    game_publish_date: '2014-03-04',
    news_lines: ['2010년 연간 실적 발표'],
    business_year: 2012,
  }, '2018-11-20');

  assert.equal(dto.date, '2014-03-04');
  assert.equal(dto.headline, '8년 전 연간 실적 발표');
  assert.equal(dto.businessYear, '6년 전');
});
