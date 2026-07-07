// /api/game/:sessionId/surge (급등주 이벤트, 미팅5 §4)
const router = require('express').Router({ mergeParams: true });
const asyncHandler = require('../utils/asyncHandler');
const surge = require('../controllers/surgeController');

// 현재 매수 가능한(미해결) 급등주
router.get('/active', asyncHandler(surge.getActive));

// 매수 { surgeStockId, amount } — 관망은 아무것도 하지 않으면 됨
router.post('/buy', asyncHandler(surge.buy));

module.exports = router;
