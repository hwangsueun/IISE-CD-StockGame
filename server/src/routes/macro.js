// /api/macro (ARCHITECTURE.md §8-3)
const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const macro = require('../controllers/macroController');

// GET /api/macro/:date — 게임 노출 지표(is_game_visible) 당일 값 + 전일 대비
router.get('/:date', asyncHandler(macro.byDate));

// GET /api/macro/:date/history?code=&days= — 지표 차트용 시계열
router.get('/:date/history', asyncHandler(macro.history));

module.exports = router;
