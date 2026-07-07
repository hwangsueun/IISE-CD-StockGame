// /api/news (ARCHITECTURE.md §8-4)
// 뉴스 노출 제한(스트레스)은 세션 문맥이 필요하므로 sessionId 쿼리 파라미터를 받는다.
const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const news = require('../controllers/newsController');

// GET /api/news/:date?sessionId=&category= — 날짜별 뉴스 (스트레스 제한/노출 기록 반영)
router.get('/:date', asyncHandler(news.byDate));

// GET /api/news/:date/:assetId — 날짜+자산별 뉴스 (종목 상세 화면)
router.get('/:date/:assetId', asyncHandler(news.byDateAndAsset));

module.exports = router;
