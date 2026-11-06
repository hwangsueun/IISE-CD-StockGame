const test = require('node:test');
const assert = require('node:assert/strict');
const bundle = require('../src/data/stockBusinessProfiles.json');
const { getStockBusinessProfile } = require('../src/services/stockBusinessProfile');

test('business profiles remain unavailable until the source receipt date', () => {
  assert.equal(getStockBusinessProfile('STOCK_000210', '2014-05-14'), null);
  const profile = getStockBusinessProfile('STOCK_000210', '2014-05-15');
  assert.equal(profile.description, '건설·제조·기타 부문 중심의 대형 기업');
  assert.equal(profile.asOfDate, '2014-05-15');
  assert.equal(profile.businessYear, 2013);
  assert.equal(profile.sourceReceiptNo, '20140515001539');
  for (const assetId of Object.keys(bundle.profiles)) {
    assert.equal(getStockBusinessProfile(assetId, '2013-12-31'), null);
  }
});

test('latest available fiscal year wins over a late correction to an older year', () => {
  const profile = getStockBusinessProfile('STOCK_000270', '2022-01-01');
  assert.equal(profile.businessYear, 2020);
  assert.equal(profile.asOfDate, '2021-12-10');
  const newer = getStockBusinessProfile('STOCK_000270', '2022-03-21');
  assert.equal(newer.businessYear, 2021);
  assert.ok(newer.asOfDate <= '2022-03-21');
});

test('partial coverage and invalid input never create a business description', () => {
  for (const assetId of ['STOCK_058470', 'STOCK_999999', 'COIN_BITCOIN', '__proto__', null]) {
    assert.equal(getStockBusinessProfile(assetId, '2023-12-31'), null);
  }
  for (const date of [undefined, null, '', '2020-1-1', '2020-02-30', 'not-a-date', 20200101]) {
    assert.equal(getStockBusinessProfile('STOCK_000210', date), null);
  }
  const profile = getStockBusinessProfile('STOCK_000210', '2020-02-29');
  assert.ok(profile && profile.asOfDate <= '2020-02-29');
});

test('bundled provenance and source limitations survive selection without exposing a real company name', () => {
  assert.equal(bundle.coverage.universeCount, 117);
  assert.equal(bundle.coverage.representedStockCount, 23);
  assert.equal(bundle.coverage.profileCount, 249);
  for (const source of [bundle.provenance.source, bundle.provenance.corroboratingJsonl,
    bundle.provenance.maskingSource, bundle.provenance.aliasSource, bundle.provenance.coinSource]) {
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
    assert.ok(source.path.startsWith('data-pipeline/'));
  }
  const profile = getStockBusinessProfile('STOCK_006120', '2014-12-31');
  assert.ok(profile.qualityNote);
  assert.equal(profile.qualityNote.includes('SK디스커버리'), false);
  assert.equal(profile.qualityNote.includes('태서인베스트'), true);
  const externalCompany = getStockBusinessProfile('STOCK_009150', '2024-12-31');
  assert.equal(externalCompany.description.includes('삼성전자'), false);
  assert.equal(externalCompany.description.includes('유원전자'), true);
  profile.description = 'changed';
  assert.notEqual(getStockBusinessProfile('STOCK_006120', '2014-12-31').description, 'changed');
});
