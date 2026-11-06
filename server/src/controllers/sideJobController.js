const { badRequest } = require('../utils/errors');
const sideJobService = require('../services/sideJobService');

/** GET /api/game/:sessionId/side-job/status */
exports.getStatus = async (req, res) => {
  res.json(await sideJobService.getStatus(req.params.sessionId));
};

/** POST /api/game/:sessionId/side-job/play { gameKey, rawScore?, mode? } */
exports.submitPlay = async (req, res) => {
  const { gameKey, rawScore, mode = 'manual' } = req.body || {};
  if (!gameKey) throw badRequest('gameKey가 필요합니다');
  res.json(await sideJobService.submitPlay(req.params.sessionId, gameKey, rawScore, mode));
};

/** GET /api/game/:sessionId/side-job/history */
exports.getHistory = async (req, res) => {
  res.json(await sideJobService.getHistory(req.params.sessionId));
};
