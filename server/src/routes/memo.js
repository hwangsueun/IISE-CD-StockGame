// /api/game/:sessionId/memo (ARCHITECTURE.md §8-4, 캘린더 메모 CRUD)
const router = require('express').Router({ mergeParams: true });
const asyncHandler = require('../utils/asyncHandler');
const memo = require('../controllers/memoController');

// GET ?date=YYYY-MM-DD (date 없으면 전체)
router.get('/', asyncHandler(memo.list));
// POST { date, content } — 당일 메모 작성 (날짜당 1건, 100자)
router.post('/', asyncHandler(memo.create));
// PUT /:memoId { content }
router.put('/:memoId', asyncHandler(memo.update));
// DELETE /:memoId
router.delete('/:memoId', asyncHandler(memo.remove));

module.exports = router;
