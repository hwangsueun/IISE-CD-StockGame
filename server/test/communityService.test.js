const test = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../src/db');
const { toCommunityDto } = require('../src/services/communityService');

test.after(() => pool.end());

test('community years follow the current game date without changing prices or internal dates', () => {
  const row = {
    id: 1, post_date: '2013-12-30',
    title: '2013년 실적과 2014년 계획',
    body: '2013-12-30에 2014주 거래. 2014원. FY2012 실적.',
  };
  const post = toCommunityDto(row, '2014-01-02');
  assert.equal(post.title, '1년 전 실적과 올해 계획');
  assert.equal(post.body, '1년 전 12월 30일에 2014주 거래. 2014원. 2년 전 회계연도 실적.');
  assert.equal(post.post_date, row.post_date);
  assert.equal(row.title, '2013년 실적과 2014년 계획');
  assert.equal(toCommunityDto({ body: '2015년 전망' }, '2014-01-02').body, '향후 연도 전망');
});
