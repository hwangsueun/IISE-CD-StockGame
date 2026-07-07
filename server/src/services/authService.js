// 회원관리 (기능명세서 §회원: 회원가입/로그인/로그아웃/프로필/이어하기)
// 게스트 플레이 허용 — 인증은 선택. 토큰은 opaque 랜덤값을 auth_tokens에 저장.
const crypto = require('crypto');
const { query } = require('../db');
const { badRequest, conflict, notFound } = require('../utils/errors');
const { ApiError } = require('../utils/errors');

// --- scrypt 해시 (외부 의존성 없이 node 내장) ---
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
}

/** 회원가입: 입력 검증 + 아이디 중복 확인 + 계정 저장 */
async function register(username, password, nickname) {
  if (!/^[a-zA-Z0-9_]{4,20}$/.test(username || '')) {
    throw badRequest('아이디는 영문/숫자/_ 4~20자입니다');
  }
  if (!password || password.length < 8) {
    throw badRequest('비밀번호는 8자 이상입니다');
  }
  try {
    const { rows } = await query(
      `INSERT INTO users (username, password_hash, nickname) VALUES ($1, $2, $3)
       RETURNING id, username, nickname`,
      [username, hashPassword(password), nickname || username]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw conflict('이미 사용 중인 아이디입니다');
    throw err;
  }
}

/** 로그인: 정보 일치 확인 -> 토큰 발급 */
async function login(username, password) {
  const { rows } = await query(`SELECT * FROM users WHERE username = $1`, [username]);
  const user = rows[0];
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new ApiError(401, '아이디 또는 비밀번호가 일치하지 않습니다');
  }
  const token = crypto.randomBytes(32).toString('hex');
  await query(`INSERT INTO auth_tokens (token, user_id) VALUES ($1, $2)`, [token, user.id]);
  return { token, user: { id: user.id, username: user.username, nickname: user.nickname } };
}

/** 로그아웃: 토큰 삭제 (게임 나가면 로그아웃 — 기능명세서 비고) */
async function logout(token) {
  await query(`DELETE FROM auth_tokens WHERE token = $1`, [token]);
}

/** 토큰 -> 유저. 없으면 null (게스트) */
async function userFromToken(token) {
  if (!token) return null;
  const { rows } = await query(
    `SELECT u.id, u.username, u.nickname FROM auth_tokens t JOIN users u ON u.id = t.user_id
     WHERE t.token = $1`,
    [token]
  );
  return rows[0] || null;
}

/** 프로필 + 이어하기용 저장 세션 목록 (기능명세서 §회원-저장데이터) */
async function getProfile(userId) {
  const { rows: uRows } = await query(
    `SELECT id, username, nickname, created_at FROM users WHERE id = $1`, [userId]
  );
  if (!uRows[0]) throw notFound('사용자를 찾을 수 없습니다');
  const { rows: sessions } = await query(
    `SELECT id, status, difficulty, current_turn, cash, debt, stress, trust, updated_at
     FROM game_sessions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 10`,
    [userId]
  );
  return { ...uRows[0], sessions };
}

/** express 미들웨어: Authorization: Bearer <token> -> req.user (게스트면 null) */
async function authMiddleware(req, _res, next) {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    req.user = await userFromToken(token);
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, logout, userFromToken, getProfile, authMiddleware };
