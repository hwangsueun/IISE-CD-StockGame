const router = require('express').Router({ mergeParams: true });
const asyncHandler = require('../utils/asyncHandler');
const { getQuantPortfolio } = require('../services/quantService');
router.get('/', asyncHandler(async (req, res) => {
  res.json(await getQuantPortfolio(req.params.sessionId));
}));
module.exports = router;
