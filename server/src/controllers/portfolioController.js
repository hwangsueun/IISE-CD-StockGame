const { badRequest } = require('../utils/errors');
const valuationService = require('../services/valuationService');

/** GET /api/game/:sessionId/portfolio */
exports.getPortfolio = async (req, res) => {
  res.json(await valuationService.getPortfolio(req.params.sessionId));
};

/** GET /api/game/:sessionId/portfolio/pnl?period=&assetType= */
exports.getRealizedPnl = async (req, res) => {
  const { period = 'all', assetType } = req.query;
  if (!['daily', 'weekly', 'monthly', 'yearly', 'all'].includes(period)) {
    throw badRequest('period는 daily|weekly|monthly|yearly|all 중 하나입니다');
  }
  if (assetType && !['stock', 'bond', 'coin'].includes(assetType)) {
    throw badRequest('assetType은 stock|bond|coin 중 하나입니다');
  }
  res.json(await valuationService.getRealizedPnl(req.params.sessionId, period, assetType));
};
