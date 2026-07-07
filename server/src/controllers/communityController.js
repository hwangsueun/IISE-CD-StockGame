const communityService = require('../services/communityService');

/** GET /api/community/:assetId?date=&limit= */
exports.listPosts = async (req, res) => {
  const { date, limit } = req.query;
  res.json(
    await communityService.listPosts(req.params.assetId, date, Number(limit) || 30)
  );
};

/** GET /api/community/post/:postId/comments */
exports.listComments = async (req, res) => {
  res.json(await communityService.listComments(Number(req.params.postId)));
};
