const { badRequest } = require('../utils/errors');
const { withTransaction } = require('../db');
const surgeStockService = require('../services/surgeStockService');

/** GET /api/game/:sessionId/surge/active */
exports.getActive = async (req, res) => {
  res.json(await surgeStockService.getActive(req.params.sessionId));
};

/** POST /api/game/:sessionId/surge/buy { surgeStockId, amount } */
exports.buy = async (req, res) => {
  const { surgeStockId, amount } = req.body || {};
  if (!surgeStockId || !(Number(amount) > 0)) throw badRequest('surgeStockId, amount(>0)가 필요합니다');
  const result = await withTransaction((client) =>
    surgeStockService.buy(req.params.sessionId, Number(surgeStockId), Number(amount), client)
  );
  res.json(result);
};
