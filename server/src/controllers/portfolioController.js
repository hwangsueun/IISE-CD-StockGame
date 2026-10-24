const { badRequest } = require('../utils/errors');
const valuationService = require('../services/valuationService');

exports.getMarketComparison = async (req, res) => {
  res.json(await require('../services/marketComparisonService').getPerformance(req.params.sessionId));
};

/** GET /api/game/:sessionId/portfolio */
exports.getPortfolio = async (req, res) => {
  res.json(await valuationService.getPortfolio(req.params.sessionId));
};

/** GET /api/game/:sessionId/portfolio/history — 턴별 수익률 추이 */
exports.getPortfolioHistory = async (req, res) => {
  res.json(await valuationService.getPortfolioHistory(req.params.sessionId));
};

/** GET /api/game/:sessionId/portfolio/dashboard?unit=&assetType= */
exports.getPortfolioDashboard = async (req, res) => {
  const { unit = 'day', assetType = 'all' } = req.query;
  if (!valuationService.DASHBOARD_UNITS.includes(unit)) {
    throw badRequest('unit은 day|week|month|all 중 하나입니다');
  }
  if (!valuationService.DASHBOARD_ASSET_TYPES.includes(assetType)) {
    throw badRequest('assetType은 all|stock 중 하나입니다');
  }
  res.json(await valuationService.getPortfolioDashboard(req.params.sessionId, unit, assetType));
};

/** GET /api/game/:sessionId/portfolio/pnl?period=&assetType= */
exports.getRealizedPnl = async (req, res) => {
  const { period = 'all', assetType } = req.query;
  if (!['daily', 'weekly', 'monthly', 'yearly', 'all'].includes(period)) {
    throw badRequest('period는 daily|weekly|monthly|yearly|all 중 하나입니다');
  }
  if (assetType && assetType !== 'stock') {
    throw badRequest('주식 수익분석만 제공합니다');
  }
  res.json(await valuationService.getRealizedPnl(req.params.sessionId, period, assetType));
};
