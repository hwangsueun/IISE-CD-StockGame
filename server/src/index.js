// ANT SURVIVAL API 부트스트랩 (ARCHITECTURE.md §8)
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { query } = require('./db');

const gameRoutes = require('./routes/game');
const assetRoutes = require('./routes/assets');
const macroRoutes = require('./routes/macro');
const newsRoutes = require('./routes/news');
const communityRoutes = require('./routes/community');
const authRoutes = require('./routes/auth');
const { authMiddleware } = require('./services/authService');

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());
app.use(authMiddleware); // Bearer 토큰 -> req.user (게스트면 null)

app.get('/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ status: 'ok', db: 'up' });
  } catch (err) {
    res.status(503).json({ status: 'degraded', db: 'down', error: err.message });
  }
});

// 회원관리 (회원가입/로그인/프로필/이어하기)
app.use('/api/auth', authRoutes);
// 게임 세션 흐름 (start/state/turn/trade/next-turn/repay/event/result/portfolio/report/memo/side-job/surge/log)
app.use('/api/game', gameRoutes);
// 자산/시세
app.use('/api/assets', assetRoutes);
// 거시지표
app.use('/api/macro', macroRoutes);
// 뉴스
app.use('/api/news', newsRoutes);
// 종토방
app.use('/api/community', communityRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.path });
});

// 공통 에러 핸들러
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.statusCode || 500;
  if (status >= 500) console.error('[api:error]', err);
  res.status(status).json({ error: err.message, detail: err.detail });
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  console.log(`[antsurvival] API listening on :${port}`);
});

module.exports = app;
