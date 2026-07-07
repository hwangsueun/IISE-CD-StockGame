const { badRequest } = require('../utils/errors');
const memoService = require('../services/memoService');

/** GET /api/game/:sessionId/memo?date= */
exports.list = async (req, res) => {
  res.json(await memoService.list(req.params.sessionId, req.query.date));
};

/** POST /api/game/:sessionId/memo { date, content } */
exports.create = async (req, res) => {
  const { date, content } = req.body || {};
  if (!date || typeof content !== 'string') throw badRequest('date, content가 필요합니다');
  if (content.length > 100) throw badRequest('메모는 100자 이내입니다');
  res.status(201).json(await memoService.create(req.params.sessionId, date, content));
};

/** PUT /api/game/:sessionId/memo/:memoId */
exports.update = async (req, res) => {
  const { content } = req.body || {};
  if (typeof content !== 'string' || content.length > 100) {
    throw badRequest('content(100자 이내)가 필요합니다');
  }
  res.json(await memoService.update(req.params.sessionId, Number(req.params.memoId), content));
};

/** DELETE /api/game/:sessionId/memo/:memoId */
exports.remove = async (req, res) => {
  await memoService.remove(req.params.sessionId, Number(req.params.memoId));
  res.status(204).end();
};
