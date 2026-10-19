const router = require('express').Router({ mergeParams: true });
const asyncHandler = require('../utils/asyncHandler');
const { getQuantPortfolio } = require('../services/quantService');
const challenge = require('../services/challengeService');
router.post('/challenge/join', asyncHandler(async (req, res) => {
  res.json(await challenge.enroll(req.params.sessionId));
}));
router.post('/challenge/claim', asyncHandler(async (req, res) => {
  res.json(await challenge.claim(req.params.sessionId, req.body.month));
}));
router.get('/', asyncHandler(async (req, res) => {
  res.json(await getQuantPortfolio(req.params.sessionId));
}));
module.exports = router;
