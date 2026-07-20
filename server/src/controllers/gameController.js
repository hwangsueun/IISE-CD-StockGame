// 게임 흐름 컨트롤러 — 검증/파라미터 정리만 하고 로직은 서비스에 위임한다.
const { badRequest } = require('../utils/errors');
const gameService = require('../services/gameService');
const turnService = require('../services/turnService');
const tradeService = require('../services/tradeService');
const reportService = require('../services/reportService');

const DIFFICULTIES = ['easy', 'normal', 'hard'];

/** POST /api/game/start — 로그인 상태면 계정에 연결(이어하기 대상), 게스트도 허용 */
exports.start = async (req, res) => {
  const { difficulty } = req.body || {};
  if (!DIFFICULTIES.includes(difficulty)) {
    throw badRequest(`difficulty는 ${DIFFICULTIES.join('/')} 중 하나여야 합니다`);
  }
  const session = await gameService.startGame(difficulty, req.user?.id || null);
  res.status(201).json(session);
};

/** GET /api/game/:sessionId/log — 거래/상환/이벤트 통합 타임라인 (기능명세서 §기록) */
exports.getLog = async (req, res) => {
  res.json(await gameService.getGameLog(req.params.sessionId));
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
  const qty = Number(quantity);
  // 여기서는 형태만 본다 (유한한 양수). 자산 타입별 세부 규칙(정수/코인 최소단위·소수자리)은
  // 이 시점에 assetType을 모르므로 tradeService가 서버 권위로 재검증한다 (중복 아님, 계층 분리).
  if (!assetId || !['buy', 'sell'].includes(tradeType) || !Number.isFinite(qty) || qty <= 0) {
    throw badRequest('assetId, tradeType(buy|sell), quantity(유한한 양수)가 필요합니다');
  }
  const result = await tradeService.executeTrade(req.params.sessionId, {
    assetId,
    tradeType,
    quantity: qty,
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
