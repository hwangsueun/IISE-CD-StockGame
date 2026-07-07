const { badRequest } = require('../utils/errors');
const sideJobService = require('../services/sideJobService');

/** GET /api/game/:sessionId/side-job/status */
exports.getStatus = async (req, res) => {
  res.json(await sideJobService.getStatus(req.params.sessionId));
};

/** POST /api/game/:sessionId/side-job/play { gameKey, rawScore } */
exports.submitPlay = async (req, res) => {
  const { gameKey, rawScore } = req.body || {};
  if (!gameKey || rawScore === undefined) throw badRequest('gameKey, rawScore가 필요합니다');
  res.json(await sideJobService.submitPlay(req.params.sessionId, gameKey, Number(rawScore)));
};

/** GET /api/game/:sessionId/side-job/history */
exports.getHistory = async (req, res) => {
  res.json(await sideJobService.getHistory(req.params.sessionId));
};
