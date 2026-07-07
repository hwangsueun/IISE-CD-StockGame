// 게임 세션 흐름 라우트 (ARCHITECTURE.md §8-1)
// 하위 도메인(포트폴리오/상환/이벤트/메모)은 별도 라우트 파일을 서브마운트한다.
const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const game = require('../controllers/gameController');

const portfolioRoutes = require('./portfolio');
const repaymentRoutes = require('./repayment');
const eventRoutes = require('./event');
const memoRoutes = require('./memo');

// POST /api/game/start { difficulty }
router.post('/start', asyncHandler(game.start));

// GET /api/game/:sessionId — 현재 상태 (현금/총자산/부채/스트레스/신뢰도/턴)
router.get('/:sessionId', asyncHandler(game.getState));

// GET /api/game/:sessionId/turn/:turnNumber — 턴 데이터(시세/뉴스/상태/상환 여부)
router.get('/:sessionId/turn/:turnNumber', asyncHandler(game.getTurn));

// POST /api/game/:sessionId/trade { assetId, tradeType, quantity }
router.post('/:sessionId/trade', asyncHandler(game.trade));

// POST /api/game/:sessionId/next-turn
router.post('/:sessionId/next-turn', asyncHandler(game.nextTurn));

// GET /api/game/:sessionId/result — 최종 결산
router.get('/:sessionId/result', asyncHandler(game.getResult));

// 서브 도메인
router.use('/:sessionId/portfolio', portfolioRoutes);
router.use('/:sessionId/repay', repaymentRoutes);
router.use('/:sessionId/event', eventRoutes);
router.use('/:sessionId/memo', memoRoutes);

// 리포트 (월간/주간/최종)
router.get('/:sessionId/report/weekly/:weekIndex', asyncHandler(game.getWeeklyReport));
router.get('/:sessionId/report/monthly/:monthIndex', asyncHandler(game.getMonthlyReport));
router.get('/:sessionId/report/final', asyncHandler(game.getFinalReport));

module.exports = router;
