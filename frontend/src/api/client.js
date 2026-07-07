// API 클라이언트 — 서버 REST 엔드포인트 1:1 래퍼 (ARCHITECTURE.md §8)
// 컴포넌트는 이 모듈만 통해 서버와 통신한다.
const BASE = import.meta.env.VITE_API_BASE || '';

async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
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

export const api = {
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

  // 이벤트
  getPendingEvents: (sid) => get(`/api/game/${sid}/event/pending`),
  resolveEvent: (sid, eventLogId, choice) =>
    post(`/api/game/${sid}/event`, { eventLogId, choice }),

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
