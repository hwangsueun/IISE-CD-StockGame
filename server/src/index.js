// ANT SURVIVAL API 부트스트랩 (ARCHITECTURE.md §8)
const express = require('express');
const cors = require('cors');
const fs = require('node:fs');
const path = require('node:path');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
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
const production = process.env.NODE_ENV === 'production';
if (process.env.RENDER === 'true') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, strictTransportSecurity: production }));
const allowedOrigin = process.env.CORS_ORIGIN || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173';
app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: '64kb' }));

// A single public origin serves the built game and /api. Never serve the repo root.
const staticDir = process.env.STATIC_DIR && path.resolve(process.env.STATIC_DIR);
if (staticDir) {
  if (!fs.existsSync(path.join(staticDir, 'index.html'))) throw new Error('Built frontend is missing');
  app.use(express.static(staticDir, { dotfiles: 'deny', maxAge: 0 }));
}
if (production) {
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' } }));
  const authLimit = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.' } });
  app.use(['/api/auth/register', '/api/auth/login'], authLimit);
}
app.use(authMiddleware); // Bearer 토큰 -> req.user (게스트면 null)

app.get('/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ status: 'ok', db: 'up' });
  } catch (err) {
    res.status(503).json({ status: 'degraded', db: 'down', ...(production ? {} : { error: err.message }) });
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
  res.status(status).json(status >= 500 && production
    ? { error: '서버 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
    : { error: err.message, detail: err.detail });
});

const port = Number(process.env.PORT || 3001);
if (require.main === module) {
  app.listen(port, '0.0.0.0', () => {
    console.log(`[antsurvival] API listening on :${port}`);
  });
}

module.exports = app;
