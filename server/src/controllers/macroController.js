const macroService = require('../services/macroService');

/** GET /api/macro/:date */
exports.byDate = async (req, res) => {
  res.json(await macroService.getIndicatorsByDate(req.params.date));
};

/** GET /api/macro/:date/history?code=&days= */
exports.history = async (req, res) => {
  const { code, days } = req.query;
  res.json(await macroService.getIndicatorHistory(code, req.params.date, Number(days) || 60));
};
