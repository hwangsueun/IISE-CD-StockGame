// /api/game/:sessionId/event (ARCHITECTURE.md §9-5 이벤트)
const router = require('express').Router({ mergeParams: true });
const asyncHandler = require('../utils/asyncHandler');
const event = require('../controllers/eventController');

// 현재 턴의 미해결(선택 대기) 이벤트 조회
router.get('/pending', asyncHandler(event.getPending));

// POST { eventLogId, choice } — 선택형 이벤트 결과 처리
router.post('/', asyncHandler(event.resolve));

// 이벤트 이력
router.get('/history', asyncHandler(event.getHistory));

module.exports = router;
