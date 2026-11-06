// Basic reference metadata is separate from game-date financial disclosures and
// from the manually selected index-comparison links. Never use one as another.
const data = require('../data/stockBusinessIntros.json');
const registered = require('../data/stockRegisteredIndustries.json');
const intros = new Map(), registeredIndustries = new Map();

for (const row of registered.records) registeredIndustries.set(`STOCK_${row.code}`, row.industry);
for (const row of data.records) {
  if (!/^STOCK_\d{6}$/.test(row.assetId) || intros.has(row.assetId) ||
      !row.description?.trim() || !row.industry?.trim() || !row.sourceReceiptNo || !row.sourceAsOfDate) {
    throw new Error('Invalid basic stock business reference');
  }
  intros.set(row.assetId, row);
}

function getStockBusinessIntro(assetId) {
  const row = intros.get(assetId);
  if (!row) return null;
  const registeredIndustry = registeredIndustries.get(assetId);
  return {
    kind: 'basic_reference',
    description: row.description,
    industry: row.industry,
    sourceAsOfDate: row.sourceAsOfDate,
    sourceName: '사업보고서 기반 기업 기본 소개',
    scopeNote: [data.scopeNote, row.scopeNote].filter(Boolean).join(' '),
    registeredIndustry: registeredIndustry ? {
      name: registeredIndustry, asOfDate: registered.asOf,
      sourceName: 'KRX KIND 등록 업종', sourceUrl: registered.sourceUrl,
    } : null,
  };
}

module.exports = { getStockBusinessIntro };
