// API 클라이언트 — 서버 REST 엔드포인트 1:1 래퍼 (ARCHITECTURE.md §8)
// 컴포넌트는 이 모듈만 통해 서버와 통신한다.
// VITE_USE_MOCK=true 면 백엔드 없이 mockApi(디자인팀 dev mock)로 동작한다 (파일 하단).
import { mockApi } from './mockApi.js';

const BASE = import.meta.env.VITE_API_BASE || '';
const USE_MOCK = (import.meta.env.VITE_USE_MOCK ?? 'false') === 'true';

/** 로그인 토큰 (게스트면 null). authStore가 setToken으로 관리 */
let authToken = localStorage.getItem('antsurvival_token') || null;
export function setToken(token) {
  authToken = token;
  if (token) localStorage.setItem('antsurvival_token', token);
  else localStorage.removeItem('antsurvival_token');
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.detail = data.detail;
    throw err;
  }
  return data;
}

const get = (p) => request('GET', p);
const post = (p, b) => request('POST', p, b);
const put = (p, b) => request('PUT', p, b);
const del = (p) => request('DELETE', p);

const httpApi = {
  // 회원관리 (기능명세서 §회원)
  register: (username, password, nickname) =>
    post('/api/auth/register', { username, password, nickname }),
  login: (username, password) => post('/api/auth/login', { username, password }),
  logout: () => post('/api/auth/logout'),
  me: () => get('/api/auth/me'), // 프로필 + 이어하기 세션 목록

  // 게임 흐름
  startGame: (difficulty) => post('/api/game/start', { difficulty }),
  getState: (sid) => get(`/api/game/${sid}`),
  getTurn: (sid, turn) => get(`/api/game/${sid}/turn/${turn}`),
  trade: (sid, { assetId, tradeType, quantity }) =>
    post(`/api/game/${sid}/trade`, { assetId, tradeType, quantity }),
  nextTurn: (sid) => post(`/api/game/${sid}/next-turn`),
  getResult: (sid) => get(`/api/game/${sid}/result`),

  // 포트폴리오 / 리포트
  getPortfolio: (sid) => get(`/api/game/${sid}/portfolio`),
  getWeeklyReport: (sid, w) => get(`/api/game/${sid}/report/weekly/${w}`),
  getMonthlyReport: (sid, m) => get(`/api/game/${sid}/report/monthly/${m}`),
  getFinalReport: (sid) => get(`/api/game/${sid}/report/final`),

  // 상환
  repay: (sid, amount) => post(`/api/game/${sid}/repay`, { amount }),
  getRepayHistory: (sid) => get(`/api/game/${sid}/repay/history`),

  // 이벤트 (payload: 독촉전화 일부 상환액 등 추가 입력)
  getPendingEvents: (sid) => get(`/api/game/${sid}/event/pending`),
  resolveEvent: (sid, eventLogId, choice, payload) =>
    post(`/api/game/${sid}/event`, { eventLogId, choice, payload }),

  // 부업 미니게임 (기능명세서 §부업)
  getSideJobStatus: (sid) => get(`/api/game/${sid}/side-job/status`),
  playSideJob: (sid, gameKey, rawScore) =>
    post(`/api/game/${sid}/side-job/play`, { gameKey, rawScore }),
  getSideJobHistory: (sid) => get(`/api/game/${sid}/side-job/history`),

  // 급등주 (미팅5 §4)
  getActiveSurge: (sid) => get(`/api/game/${sid}/surge/active`),
  buySurge: (sid, surgeStockId, amount) =>
    post(`/api/game/${sid}/surge/buy`, { surgeStockId, amount }),

  // 실현손익 (기간별/자산군별) + 게임 로그
  getRealizedPnl: (sid, period = 'all', assetType) => {
    const q = new URLSearchParams({ period });
    if (assetType) q.set('assetType', assetType);
    return get(`/api/game/${sid}/portfolio/pnl?${q}`);
  },
  getGameLog: (sid) => get(`/api/game/${sid}/log`),

  // 메모 (캘린더)
  getMemos: (sid, date) => get(`/api/game/${sid}/memo${date ? `?date=${date}` : ''}`),
  createMemo: (sid, date, content) => post(`/api/game/${sid}/memo`, { date, content }),
  updateMemo: (sid, memoId, content) => put(`/api/game/${sid}/memo/${memoId}`, { content }),
  deleteMemo: (sid, memoId) => del(`/api/game/${sid}/memo/${memoId}`),

  // 자산 / 시장
  listAssets: ({ type, sort, date } = {}) => {
    const q = new URLSearchParams();
    if (type) q.set('type', type);
    if (sort) q.set('sort', sort);
    if (date) q.set('date', date);
    return get(`/api/assets?${q}`);
  },
  getAssetDetail: (assetId, date) =>
    get(`/api/assets/${assetId}${date ? `?date=${date}` : ''}`),
  getPriceSeries: (assetId, from, to) =>
    get(`/api/assets/${assetId}/prices?from=${from}&to=${to}`),
  getMacro: (date) => get(`/api/macro/${date}`),

  // 뉴스 / 종토방
  getNews: (date, sessionId, category) => {
    const q = new URLSearchParams();
    if (sessionId) q.set('sessionId', sessionId);
    if (category) q.set('category', category);
    return get(`/api/news/${date}?${q}`);
  },
  getAssetNews: (date, assetId) => get(`/api/news/${date}/${assetId}`),
  getCommunityPosts: (assetId, date) =>
    get(`/api/community/${assetId}${date ? `?date=${date}` : ''}`),
  getPostComments: (postId) => get(`/api/community/post/${postId}/comments`),
};

// ---------------------------------------------------------------------
// dev mock 스위치 (VITE_USE_MOCK=true): 백엔드 없이 프론트 개발 (mockApi.js)
// 메서드명이 다른 것은 아래에서 어댑터로 매핑한다. mock에 없는 신규 기능
// (회원/부업/급등주/손익/로그)은 명시적으로 에러를 던진다 — 조용한 오동작 방지.
// ---------------------------------------------------------------------
const notMocked = (name) => () =>
  Promise.reject(new Error(`[mock] ${name}은(는) mock 미구현입니다. VITE_USE_MOCK=false로 백엔드에 붙이세요.`));

const mockAdapter = {
  ...mockApi,
  // 이름/시그니처 매핑 (mockApi -> 본편 api 계약)
  getState: (sid) => mockApi.getGame(sid),
  trade: (sid, payload) => mockApi.trade(sid, payload),
  repay: (sid, amount) => mockApi.repay(sid, { amount }),
  resolveEvent: (sid, eventLogId, choice) => mockApi.resolveEvent(sid, { eventLogId, choice }),
  listAssets: ({ type, sort } = {}) => mockApi.getAssets({ type, sort }),
  getAssetDetail: (assetId) => mockApi.getAsset(assetId),
  getPriceSeries: (assetId, from, to) => mockApi.getAssetPrices(assetId, { from, to }),
  getNews: (date) => mockApi.getNews(date),
  getAssetNews: (date, assetId) => mockApi.getNewsByAsset(date, assetId),
  getCommunityPosts: (assetId) => mockApi.getCommunity(assetId),
  getPostComments: (postId) => mockApi.getComments(postId),
  getMemos: () => mockApi.getMemo(),
  createMemo: (sid, date, content) => mockApi.createMemo(sid, { date, content }),
  updateMemo: (sid, memoId, content) => mockApi.updateMemo(sid, memoId, { content }),
  deleteMemo: (sid, memoId) => mockApi.deleteMemo(sid, memoId),
  getWeeklyReport: notMocked('주간 리포트'),
  getMonthlyReport: notMocked('월간 리포트'),
  getFinalReport: notMocked('최종 리포트'),
  getRepayHistory: notMocked('상환 이력'),
  getPendingEvents: () => Promise.resolve([]),
  // 신규 기능: mock 미구현 (백엔드 필요)
  register: notMocked('회원가입'),
  login: notMocked('로그인'),
  logout: () => Promise.resolve(null),
  me: notMocked('프로필'),
  getSideJobStatus: notMocked('부업'),
  playSideJob: notMocked('부업'),
  getSideJobHistory: notMocked('부업 이력'),
  getActiveSurge: () => Promise.resolve(null),
  buySurge: notMocked('급등주 매수'),
  getRealizedPnl: notMocked('실현손익'),
  getGameLog: notMocked('게임 로그'),
};

export const api = USE_MOCK ? mockAdapter : httpApi;
