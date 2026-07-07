// POST /api/game/:sessionId/repay (ARCHITECTURE.md §8-1, 20턴 주기 월말 상환)
const router = require('express').Router({ mergeParams: true });
const asyncHandler = require('../utils/asyncHandler');
const repayment = require('../controllers/repaymentController');

// { amount } — 이번 달 상환액. 서버가 비율에 따른 신뢰도/스트레스 반영.
router.post('/', asyncHandler(repayment.repay));

// 상환 이력
router.get('/history', asyncHandler(repayment.getHistory));

module.exports = router;
