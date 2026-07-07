// GET /api/game/:sessionId/portfolio (ARCHITECTURE.md §8-2)
const router = require('express').Router({ mergeParams: true });
const asyncHandler = require('../utils/asyncHandler');
const portfolio = require('../controllers/portfolioController');

// 보유자산, 평가금액, 수익률, 자산군 비중
router.get('/', asyncHandler(portfolio.getPortfolio));

// 기간별/자산군별/종목별 실현손익 (기능명세서 §자산)
// ?period=daily|weekly|monthly|yearly|all & assetType=stock|bond|coin
router.get('/pnl', asyncHandler(portfolio.getRealizedPnl));

module.exports = router;
