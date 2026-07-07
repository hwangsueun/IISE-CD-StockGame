// /api/assets (ARCHITECTURE.md §8-3)
const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const assets = require('../controllers/assetController');

// GET /api/assets?type=stock|bond|coin&sort=change|volume|amount&date=YYYY-MM-DD
router.get('/', asyncHandler(assets.list));

// GET /api/assets/:assetId?date= — 종목 상세 + 타입별 정보 탭
router.get('/:assetId', asyncHandler(assets.detail));

// GET /api/assets/:assetId/prices?from=&to= — 차트용 기간 시세
router.get('/:assetId/prices', asyncHandler(assets.prices));

module.exports = router;
