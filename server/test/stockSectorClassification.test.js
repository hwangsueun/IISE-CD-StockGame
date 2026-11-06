const test = require('node:test');
const assert = require('node:assert/strict');
const artifact = require('../src/data/stockSectorClassification.json');
const { sectorClassification, getStockClassification, classificationNote, classificationSource } = require('../src/services/stockSectorClassification');

const classification = (code, market, sector) => sectorClassification({ code, market, sector });

test('same sector name in different markets selects independently classified game stocks', () => {
  const kospi = classification('sector_kospi_1013', 'KOSPI', '전기전자');
  const kosdaq = classification('sector_kosdaq_2072', 'KOSDAQ', '전기전자');
  assert.equal(kospi.status, 'available');
  assert.equal(kosdaq.status, 'available');
  assert.ok(kospi.assetIds.includes('STOCK_000660'));
  assert.ok(!kospi.assetIds.includes('STOCK_058470'));
  assert.ok(kosdaq.assetIds.includes('STOCK_058470'));
  assert.ok(!kosdaq.assetIds.includes('STOCK_000660'));
  assert.equal(kospi.assetIds.filter(id => kosdaq.assetIds.includes(id)).length, 0);
});

test('known zero-stock sectors differ from unrecognized or mismatched index metadata', () => {
  assert.deepEqual(classification('sector_kospi_1018', 'KOSPI', '건설'), { status: 'available', assetIds: [] });
  for (const args of [
    ['sector_kospi_9999', 'KOSPI', '건설'],
    ['sector_kospi_1013', 'KOSDAQ', '전기전자'],
    ['sector_kospi_1013', 'KOSPI', '다른 이름'],
    ['sector_kospi_1012', 'KOSPI', '기계장비'],
  ]) assert.deepEqual(classification(...args), { status: 'unavailable', assetIds: [] });
});

test('bundled classification covers exactly the explicit fixed117 universe without original names', () => {
  assert.equal(artifact.stocks.length, 117);
  assert.equal(artifact.indices.length, 36);
  assert.equal(new Set(artifact.stocks.map(s => s.code)).size, 117);
  for (const row of [...artifact.stocks, ...artifact.indices]) {
    assert.deepEqual(Object.keys(row).sort(), ['code', 'market', 'sector']);
  }
  const mapped = artifact.indices.flatMap(index => sectorClassification(index).assetIds);
  assert.equal(mapped.length, 117);
  assert.equal(new Set(mapped).size, 117);
  assert.match(classificationNote, /고정 업종 분류/);
  assert.match(classificationNote, /과거 시점의 공식 업종지수 구성종목을 뜻하지 않습니다/);
  assert.equal(classificationSource.basis, 'fixed_game_universe');
  assert.match(classificationSource.mapping.path, /build_sector_reaction_layer\.py$/);
  assert.match(classificationSource.indices.path, /kr_index_master_sector_candidates\.csv$/);
  assert.match(classificationSource.mapping.sha256, /^[a-f0-9]{64}$/);
  assert.match(classificationSource.indices.sha256, /^[a-f0-9]{64}$/);
});

test('classifications returned to callers do not mutate later requests', () => {
  const quote = { code: 'sector_kospi_1013', market: 'KOSPI', sector: '전기전자' };
  const first = sectorClassification(quote);
  first.assetIds.splice(0);
  assert.ok(sectorClassification(quote).assetIds.includes('STOCK_000660'));
});

test('stock lookup uses only explicit canonical asset IDs without market guesses', () => {
  assert.deepEqual(getStockClassification('STOCK_000660'), { market: 'KOSPI', sector: '전기전자' });
  assert.deepEqual(getStockClassification('STOCK_058470'), { market: 'KOSDAQ', sector: '전기전자' });
  for (const id of ['STOCK_999999', '000660', 'STOCK_660', null, undefined]) assert.equal(getStockClassification(id), null);
  const result = getStockClassification('STOCK_000660');
  result.market = 'KOSDAQ';
  assert.equal(getStockClassification('STOCK_000660').market, 'KOSPI');
});

test('sector API responses attach classification without changing observed index prices', async () => {
  const dbPath = require.resolve('../src/db');
  const servicePath = require.resolve('../src/services/sectorService');
  const realDb = require(dbPath);
  require.cache[dbPath].exports = { ...realDb, query: async sql => ({ rows: sql.includes('FROM game_sessions')
    ? [{ trade_date: '2020-01-06' }]
    : [{ indicator_code: 'sector_kospi_1013', display_name: '전기전자', price: '1100', previous_price: '1000', trade_date: '2020-01-06', previous_date: '2020-01-03' }] }) };
  delete require.cache[servicePath];
  try {
    const { getSectors } = require(servicePath);
    const response = await getSectors('test-session', '2020-01-06');
    assert.equal(response.classificationNote, classificationNote);
    assert.deepEqual(response.classificationSource, classificationSource);
    assert.equal(response.sectors[0].value, 1100);
    assert.ok(Math.abs(response.sectors[0].changeRate - .1) < 1e-10);
    assert.ok(response.sectors[0].classification.assetIds.includes('STOCK_000660'));
    assert.equal(response.sectors[0].classification.status, 'available');
    assert.ok(!JSON.stringify(response).includes('stock_name'));
  } finally {
    require.cache[dbPath].exports = realDb;
    delete require.cache[servicePath];
    await realDb.pool.end();
  }
});
