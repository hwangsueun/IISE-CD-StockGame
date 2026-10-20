const { badRequest } = require('../utils/errors');
const pricingService = require('../services/pricingService');

/** GET /api/assets?type=stock&sort=&date= — 주식 목록 */
exports.list = async (req, res) => {
  const { type, sort, date, sessionId } = req.query;
  if (type && type !== 'stock') {
    throw badRequest('이 게임에서는 주식만 조회할 수 있습니다');
  }
  res.json(await pricingService.listAssets({ type, sort, date, sessionId }));
};

/** GET /api/assets/:assetId?date= */
exports.detail = async (req, res) => {
  res.json(await pricingService.getAssetDetail(req.params.assetId, req.query.date));
};

/** GET /api/assets/:assetId/prices?from=&to=&unit=day|week|month */
exports.prices = async (req, res) => {
  const { from, to, unit } = req.query;
  if (!from || !to) throw badRequest('from, to(YYYY-MM-DD)가 필요합니다');
  // 증권사 일·주·월봉과 같은 구성. 틱/분봉은 1턴=1거래일이라 원천이 없고,
  // 년봉은 240턴 게임에서 봉이 하나뿐이라 제외했다 (pricingService.BAR_UNITS).
  const u = unit === undefined ? 'day' : String(unit);
  if (!pricingService.BAR_UNITS.includes(u)) {
    throw badRequest(`unit은 ${pricingService.BAR_UNITS.join(', ')} 중 하나여야 합니다`);
  }
  res.json(await pricingService.getPriceSeries(req.params.assetId, from, to, u));
};
