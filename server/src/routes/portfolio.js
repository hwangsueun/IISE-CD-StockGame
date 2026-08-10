// GET /api/game/:sessionId/portfolio (ARCHITECTURE.md §8-2)
const router = require('express').Router({ mergeParams: true });
const asyncHandler = require('../utils/asyncHandler');
const portfolio = require('../controllers/portfolioController');

// 보유자산, 평가금액, 수익률, 자산군 비중
router.get('/', asyncHandler(portfolio.getPortfolio));

// 턴별 총자산/순자산/초기자본 대비 수익률 (대시보드 라인차트)
router.get('/history', asyncHandler(portfolio.getPortfolioHistory));

// 전체/주식/채권/코인 × 일(1턴)/주(5턴)/월(20턴)/전체 성과 집계
router.get('/dashboard', asyncHandler(portfolio.getPortfolioDashboard));

// 기간별/자산군별/종목별 실현손익 (기능명세서 §자산)
// ?period=daily|weekly|monthly|yearly|all & assetType=stock|bond|coin
router.get('/pnl', asyncHandler(portfolio.getRealizedPnl));

module.exports = router;
