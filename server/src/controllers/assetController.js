const { badRequest } = require('../utils/errors');
const pricingService = require('../services/pricingService');

/**
 * GET /api/assets?type=&sort=&date=&sessionId=
 * sessionId 전달 시 코인은 해당 세션의 10종 유니버스로 제한된다(migration 005). 미전달 시
 * 코인은 목록에서 제외된다 — 근거는 pricingService.listAssets 상단 주석 참조.
 */
exports.list = async (req, res) => {
  const { type, sort, date, sessionId } = req.query;
  if (type && !['stock', 'bond', 'coin'].includes(type)) {
    throw badRequest('type은 stock|bond|coin 중 하나입니다');
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
