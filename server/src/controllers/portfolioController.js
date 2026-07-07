const valuationService = require('../services/valuationService');

/** GET /api/game/:sessionId/portfolio */
exports.getPortfolio = async (req, res) => {
  res.json(await valuationService.getPortfolio(req.params.sessionId));
};
