// /api/community (ARCHITECTURE.md §8-4, 읽기 전용 NPC 종토방)
const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const community = require('../controllers/communityController');

// GET /api/community/:assetId?date=YYYY-MM-DD&limit=
router.get('/:assetId', asyncHandler(community.listPosts));

// GET /api/community/post/:postId/comments
router.get('/post/:postId/comments', asyncHandler(community.listComments));

module.exports = router;
