// /api/auth (기능명세서 §회원)
const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const auth = require('../controllers/authController');

router.post('/register', asyncHandler(auth.register));   // { username, password, nickname? }
router.post('/login', asyncHandler(auth.login));         // { username, password } -> { token, user }
router.post('/logout', asyncHandler(auth.logout));       // Bearer token
router.get('/me', asyncHandler(auth.me));                // 프로필 + 이어하기 세션 목록

module.exports = router;
