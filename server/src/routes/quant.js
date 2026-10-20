const router = require('express').Router({ mergeParams: true });
const asyncHandler = require('../utils/asyncHandler');
const { getQuantPortfolio } = require('../services/quantService');
const challenge = require('../services/challengeService');
const strategies = require('../services/userStrategyService');
router.get('/explanations/:assetId', asyncHandler(async (req, res) =>
  res.json(await require('../services/quantAttribution').getQuantAttribution(req.params.sessionId, req.params.assetId))));
router.get('/strategies', asyncHandler(async (req, res) => res.json(await strategies.workspace(req.params.sessionId))));
router.post('/strategies/automation', asyncHandler(async (req,res)=>
  res.json(await require('../services/strategyAutomation').configure(req.params.sessionId,req.body))));
router.post('/strategies/practice', asyncHandler(async (req, res) => res.json(await strategies.practice(req.params.sessionId, req.body))));
router.post('/strategies/compare', asyncHandler(async (req, res) => res.json(await strategies.compare(req.params.sessionId, req.body))));
router.post('/strategies', asyncHandler(async (req, res) => res.json(await strategies.save(req.params.sessionId, req.body))));
router.get('/strategies/runs/:id', asyncHandler(async (req, res) => res.json(await strategies.report(req.params.sessionId, req.params.id))));
router.get('/strategies/:id', asyncHandler(async (req, res) => res.json(await strategies.observe(req.params.sessionId, req.params.id))));
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
