const { badRequest } = require('../utils/errors');
const eventEngine = require('../services/eventEngine');

/** GET /api/game/:sessionId/event/pending */
exports.getPending = async (req, res) => {
  res.json(await eventEngine.getPendingEvents(req.params.sessionId));
};

/** POST /api/game/:sessionId/event { eventLogId, choice } */
exports.resolve = async (req, res) => {
  const { eventLogId, choice } = req.body || {};
  if (!eventLogId) throw badRequest('eventLogId가 필요합니다');
  res.json(await eventEngine.resolveEvent(req.params.sessionId, Number(eventLogId), choice));
};

/** GET /api/game/:sessionId/event/history */
exports.getHistory = async (req, res) => {
  res.json(await eventEngine.getHistory(req.params.sessionId));
};
