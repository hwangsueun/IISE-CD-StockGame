const { badRequest } = require('../utils/errors');
const pricingService = require('../services/pricingService');

/** GET /api/assets?type=&sort=&date= */
exports.list = async (req, res) => {
  const { type, sort, date } = req.query;
  if (type && !['stock', 'bond', 'coin'].includes(type)) {
    throw badRequest('type은 stock|bond|coin 중 하나입니다');
  }
  res.json(await pricingService.listAssets({ type, sort, date }));
};

/** GET /api/assets/:assetId?date= */
exports.detail = async (req, res) => {
  res.json(await pricingService.getAssetDetail(req.params.assetId, req.query.date));
};

/** GET /api/assets/:assetId/prices?from=&to= */
exports.prices = async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) throw badRequest('from, to(YYYY-MM-DD)가 필요합니다');
  res.json(await pricingService.getPriceSeries(req.params.assetId, from, to));
};
