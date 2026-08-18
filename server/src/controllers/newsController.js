const newsService = require('../services/newsService');

/** GET /api/news/:date?sessionId=&category=&referenceDate= — 스트레스 열람 제한/노출 기록 반영 */
exports.byDate = async (req, res) => {
  const { sessionId, category, referenceDate } = req.query;
  res.json(await newsService.getNewsByDate(req.params.date, { sessionId, category, referenceDate }));
};

/** GET /api/news/:date/:assetId — 종목 상세 화면 뉴스 */
exports.byDateAndAsset = async (req, res) => {
  res.json(await newsService.getNewsByDateAndAsset(req.params.date, req.params.assetId));
};
