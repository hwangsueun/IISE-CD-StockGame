const bundle = require('../data/stockBusinessProfiles.json');

// The source contains a partial, previously generated DART profile batch.
// A receipt after the game date is unavailable, including later corrections
// to an older report. Never substitute today's profile for a missing one.
function getStockBusinessProfile(assetId, date) {
  if (typeof assetId !== 'string' || typeof date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) return null;
  const profiles = Object.hasOwn(bundle.profiles, assetId) ? bundle.profiles[assetId] : null;
  // Rows are ordered by business year, then receipt date, newest first.
  // Sorting only by receipt would let a late correction to an old year
  // displace a more recent fiscal report.
  const profile = profiles?.find(row => row.asOfDate <= date);
  if (!profile) return null;
  return {
    description: profile.description,
    asOfDate: profile.asOfDate,
    businessYear: profile.businessYear,
    sourceName: 'DART 사업보고서 기반 기존 요약',
    sourceReceiptNo: profile.sourceReceiptNo,
    qualityNote: profile.qualityNote || null,
  };
}

module.exports = { getStockBusinessProfile };
