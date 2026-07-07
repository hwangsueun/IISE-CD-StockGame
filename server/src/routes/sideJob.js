// /api/game/:sessionId/side-job (부업 미니게임, 기능명세서 §부업)
const router = require('express').Router({ mergeParams: true });
const asyncHandler = require('../utils/asyncHandler');
const sideJob = require('../controllers/sideJobController');

// 오늘 부업 가능 여부 + 게임 목록/보상표
router.get('/status', asyncHandler(sideJob.getStatus));

// 미니게임 결과 제출 { gameKey, rawScore } -> 서버가 등급/보상 판정
router.post('/play', asyncHandler(sideJob.submitPlay));

// 부업 이력
router.get('/history', asyncHandler(sideJob.getHistory));

module.exports = router;
