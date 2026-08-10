const { badRequest } = require('../utils/errors');
const { withTransaction } = require('../db');
const surgeStockService = require('../services/surgeStockService');

/** GET /api/game/:sessionId/surge/active */
exports.getActive = async (req, res) => {
  res.json(await surgeStockService.getActive(req.params.sessionId));
};

/** POST /api/game/:sessionId/surge/buy { surgeStockId, quantity } */
exports.buy = async (req, res) => {
  const { surgeStockId, quantity } = req.body || {};
  const parsedId = Number(surgeStockId);
  const parsedQuantity = Number(quantity);
  if (!Number.isSafeInteger(parsedId) || parsedId <= 0 ||
      !Number.isSafeInteger(parsedQuantity) || parsedQuantity <= 0) {
    throw badRequest('surgeStockId와 quantity는 1 이상의 정수여야 합니다');
  }
  const result = await withTransaction((client) =>
    surgeStockService.buy(req.params.sessionId, parsedId, parsedQuantity, client)
  );
  res.json(result);
};
