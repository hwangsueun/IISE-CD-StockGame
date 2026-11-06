const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../src/data/stockBusinessIntros.json');
const universe = require('../src/data/stockSectorClassification.json');
const { getStockBusinessIntro } = require('../src/services/stockBusinessIntro');
const { getStockIndexReference } = require('../src/services/stockSectorClassification');

test('all 117 game stocks have a source-backed basic introduction independent of report availability', () => {
  assert.equal(data.records.length, 117);
  assert.equal(new Set(data.records.map(r => r.assetId)).size, 117);
  for (const stock of universe.stocks) {
    const intro = getStockBusinessIntro(`STOCK_${stock.code}`);
    assert.equal(intro.kind, 'basic_reference');
    assert.ok(intro.description.length > 10 && intro.description.length < 150);
    for (const placeholder of ['여러 사업부문을 가진 종합 기업', '다양한 사업을 영위하는 기업', '자료가 없습니다', '사업 설명 자료 없음']) {
      assert.ok(!intro.description.includes(placeholder));
    }
    assert.ok(intro.industry);
    assert.match(intro.sourceAsOfDate, /^\d{4}-\d{2}-\d{2}$/);
    const evidence = data.records.find(row => row.assetId === `STOCK_${stock.code}`);
    assert.match(evidence.sourceReceiptNo, /^\d{14}$/);
    assert.ok(intro.registeredIndustry?.name);
    assert.match(intro.scopeNote, /게임 날짜 당시의 공시 내용을 재현하는 자료는 아닙니다/);
  }
});

test('holding-company business, registered taxonomy and index reference are distinct', () => {
  const intro = getStockBusinessIntro('STOCK_003550');
  assert.equal(intro.industry, '지주회사');
  assert.match(intro.description, /전자·화학·통신/);
  assert.match(intro.description, /배당/);
  assert.match(intro.description, /지주회사/);
  assert.equal(intro.registeredIndustry.name, '기타 금융업');
  assert.equal(intro.registeredIndustry.asOfDate, '2026-11-06');
  assert.equal(getStockIndexReference('STOCK_003550').sector, '금융');
  assert.ok(!intro.description.includes('전자제품을 제조'));
});

test('public business references exclude private source excerpts and preserve stored metadata', () => {
  const intro = getStockBusinessIntro('STOCK_003550');
  for (const key of ['sourceExcerpt', 'sourcePath', 'sourceTextPath', 'sourceTextSha256', 'sourceReceiptNo', 'sourceUrl']) assert.ok(!Object.hasOwn(intro, key));
  intro.industry = 'changed'; intro.registeredIndustry.name = 'changed';
  assert.equal(getStockBusinessIntro('STOCK_003550').industry, '지주회사');
  assert.equal(getStockBusinessIntro('STOCK_003550').registeredIndustry.name, '기타 금융업');
  for (const id of ['__proto__', 'STOCK_999999', null, undefined]) assert.equal(getStockBusinessIntro(id), null);
});
