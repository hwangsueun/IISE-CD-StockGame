// Explicit game classifications, not historical official index constituents.
// The bundled artifact records both source files and their checksums; it omits
// original company names so public sector responses retain masked-name rules.
const data = require('../data/stockSectorClassification.json');

const indices = new Map(), pairs = new Map();
for (const index of data.indices) {
  const key = `${index.market}:${index.sector}`;
  if (indices.has(index.code) || pairs.has(key)) throw new Error('Duplicate sector classification index');
  const entry = { ...index, assetIds: [] };
  indices.set(index.code, entry);
  pairs.set(key, entry);
}
const stockCodes = new Set(), stocksByAssetId = new Map();
for (const stock of data.stocks) {
  const index = pairs.get(`${stock.market}:${stock.sector}`);
  if (!index || !/^\d{6}$/.test(stock.code) || stockCodes.has(stock.code)) {
    throw new Error('Invalid stock sector classification');
  }
  stockCodes.add(stock.code);
  // import_stocks.js uses this canonical ID for the same source stock code.
  const assetId = `STOCK_${stock.code}`;
  index.assetIds.push(assetId);
  stocksByAssetId.set(assetId, { market: stock.market, sector: stock.sector });
}

function getStockClassification(assetId) {
  const classification = stocksByAssetId.get(assetId);
  return classification ? { ...classification } : null;
}

function sectorClassification({ code, market, sector }) {
  const index = indices.get(code);
  if (!index || index.market !== market || index.sector !== sector) {
    return { status: 'unavailable', assetIds: [] };
  }
  // Keep a known zero-stock category distinct from an unsupported classification.
  // The caller intersects this fixed universe with date-eligible game stocks.
  return { status: 'available', assetIds: [...index.assetIds] };
}

module.exports = {
  getStockClassification,
  sectorClassification,
  classificationNote: data.note,
  classificationSource: { basis: data.basis, stockCount: data.stocks.length, ...data.provenance },
};
