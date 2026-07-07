const { badRequest } = require('../utils/errors');
const eventEngine = require('../services/eventEngine');

/** GET /api/game/:sessionId/event/pending */
exports.getPending = async (req, res) => {
  res.json(await eventEngine.getPendingEvents(req.params.sessionId));
};

/** POST /api/game/:sessionId/event { eventLogId, choice, payload? }
 *  payload 예: 독촉전화 일부 상환 { amount: 1000000 } */
exports.resolve = async (req, res) => {
  const { eventLogId, choice, payload } = req.body || {};
  if (!eventLogId) throw badRequest('eventLogId가 필요합니다');
  res.json(await eventEngine.resolveEvent(req.params.sessionId, Number(eventLogId), choice, payload));
};

/** GET /api/game/:sessionId/event/history */
exports.getHistory = async (req, res) => {
  res.json(await eventEngine.getHistory(req.params.sessionId));
};
