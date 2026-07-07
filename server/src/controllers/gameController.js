// 게임 흐름 컨트롤러 — 검증/파라미터 정리만 하고 로직은 서비스에 위임한다.
const { badRequest } = require('../utils/errors');
const gameService = require('../services/gameService');
const turnService = require('../services/turnService');
const tradeService = require('../services/tradeService');
const reportService = require('../services/reportService');

const DIFFICULTIES = ['easy', 'normal', 'hard'];

/** POST /api/game/start */
exports.start = async (req, res) => {
  const { difficulty } = req.body || {};
  if (!DIFFICULTIES.includes(difficulty)) {
    throw badRequest(`difficulty는 ${DIFFICULTIES.join('/')} 중 하나여야 합니다`);
  }
  const session = await gameService.startGame(difficulty);
  res.status(201).json(session);
};

/** GET /api/game/:sessionId */
exports.getState = async (req, res) => {
  res.json(await gameService.getSessionState(req.params.sessionId));
};

/** GET /api/game/:sessionId/turn/:turnNumber */
exports.getTurn = async (req, res) => {
  const turnNumber = Number(req.params.turnNumber);
  if (!Number.isInteger(turnNumber) || turnNumber < 1 || turnNumber > 240) {
    throw badRequest('turnNumber는 1~240 정수여야 합니다');
  }
  res.json(await turnService.getTurnData(req.params.sessionId, turnNumber));
};

/** POST /api/game/:sessionId/trade */
exports.trade = async (req, res) => {
  const { assetId, tradeType, quantity } = req.body || {};
  if (!assetId || !['buy', 'sell'].includes(tradeType) || !(Number(quantity) > 0)) {
    throw badRequest('assetId, tradeType(buy|sell), quantity(>0)가 필요합니다');
  }
  const result = await tradeService.executeTrade(req.params.sessionId, {
    assetId,
    tradeType,
    quantity: Number(quantity),
  });
  res.json(result);
};

/** POST /api/game/:sessionId/next-turn */
exports.nextTurn = async (req, res) => {
  res.json(await turnService.advanceTurn(req.params.sessionId));
};

/** GET /api/game/:sessionId/result */
exports.getResult = async (req, res) => {
  res.json(await gameService.getResult(req.params.sessionId));
};

/** GET /api/game/:sessionId/report/weekly/:weekIndex */
exports.getWeeklyReport = async (req, res) => {
  res.json(await reportService.getWeeklyReport(req.params.sessionId, Number(req.params.weekIndex)));
};

/** GET /api/game/:sessionId/report/monthly/:monthIndex */
exports.getMonthlyReport = async (req, res) => {
  res.json(await reportService.getMonthlyReport(req.params.sessionId, Number(req.params.monthIndex)));
};

/** GET /api/game/:sessionId/report/final */
exports.getFinalReport = async (req, res) => {
  res.json(await reportService.getFinalReport(req.params.sessionId));
};
