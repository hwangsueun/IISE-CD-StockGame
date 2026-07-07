const { badRequest } = require('../utils/errors');
const repaymentService = require('../services/repaymentService');

/** POST /api/game/:sessionId/repay { amount } */
exports.repay = async (req, res) => {
  const amount = Number(req.body?.amount);
  if (!(amount >= 0)) throw badRequest('amount(>=0)가 필요합니다');
  res.json(await repaymentService.repay(req.params.sessionId, amount));
};

/** GET /api/game/:sessionId/repay/history */
exports.getHistory = async (req, res) => {
  res.json(await repaymentService.getHistory(req.params.sessionId));
};
