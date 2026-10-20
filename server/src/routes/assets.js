// /api/assets (ARCHITECTURE.md §8-3)
const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const assets = require('../controllers/assetController');

// GET /api/assets?type=stock&sort=change|decline|volume|amount&date=YYYY-MM-DD
router.get('/', asyncHandler(assets.list));
router.get('/sectors', asyncHandler(assets.sectors));

// GET /api/assets/:assetId?date= — 종목 상세 + 타입별 정보 탭
router.get('/:assetId', asyncHandler(assets.detail));

// GET /api/assets/:assetId/prices?from=&to=&unit=day|week|month — 차트용 기간 시세
// 증권사 일·주·월봉과 같은 구성. day는 봉 하나에 종가 하나뿐이라 캔들이 성립하지 않아
// 종가 시계열(라인)로 반환하고, week/month는 달력 경계로 묶은 OHLC를 반환한다.
router.get('/:assetId/prices', asyncHandler(assets.prices));

module.exports = router;
