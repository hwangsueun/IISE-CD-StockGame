// 섹션 8 백엔드 API 계약을 그대로 따르는 클라이언트.
// VITE_USE_MOCK=true 면 mockApi로 위임하고, false 면 실제 백엔드(/api)로 fetch한다.
import { mockApi } from './mockApi.js';

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';
const USE_MOCK = (import.meta.env.VITE_USE_MOCK ?? 'true') !== 'false';

async function request(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${method} ${path} 실패 (${res.status}) ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// 실제 백엔드 구현. 섹션 8-1 ~ 8-4 엔드포인트와 1:1.
const httpApi = {
  // 8-1 게임 흐름
  startGame: (difficulty) => request('POST', '/game/start', { difficulty }),
  getGame: (sessionId) => request('GET', `/game/${sessionId}`),
  getTurn: (sessionId, turnNumber) =>
    request('GET', `/game/${sessionId}/turn/${turnNumber}`),
  trade: (sessionId, payload) =>
    request('POST', `/game/${sessionId}/trade`, payload),
  nextTurn: (sessionId) => request('POST', `/game/${sessionId}/next-turn`),
  repay: (sessionId, payload) =>
    request('POST', `/game/${sessionId}/repay`, payload),
  resolveEvent: (sessionId, payload) =>
    request('POST', `/game/${sessionId}/event`, payload),
  getResult: (sessionId) => request('GET', `/game/${sessionId}/result`),

  // 8-2 포트폴리오 / 리포트
  getPortfolio: (sessionId) => request('GET', `/game/${sessionId}/portfolio`),
  getMonthlyReport: (sessionId, monthIndex) =>
    request('GET', `/game/${sessionId}/report/monthly/${monthIndex}`),
  getFinalReport: (sessionId) =>
    request('GET', `/game/${sessionId}/report/final`),

  // 8-3 자산 / 시장 데이터
  getAssets: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request('GET', `/assets${qs ? `?${qs}` : ''}`);
  },
  getAsset: (assetId) => request('GET', `/assets/${assetId}`),
  getAssetPrices: (assetId, range = {}) => {
    const qs = new URLSearchParams(range).toString();
    return request('GET', `/assets/${assetId}/prices${qs ? `?${qs}` : ''}`);
  },
  getMacro: (date) => request('GET', `/macro/${date}`),

  // 8-4 뉴스 / 종토방 / 메모
  getNews: (date) => request('GET', `/news/${date}`),
  getNewsByAsset: (date, assetId) => request('GET', `/news/${date}/${assetId}`),
  getCommunity: (assetId, date) =>
    request('GET', `/community/${assetId}${date ? `?date=${date}` : ''}`),
  getComments: (postId) => request('GET', `/community/post/${postId}/comments`),
  getMemo: (sessionId, date) =>
    request('GET', `/game/${sessionId}/memo${date ? `?date=${date}` : ''}`),
  createMemo: (sessionId, payload) =>
    request('POST', `/game/${sessionId}/memo`, payload),
  updateMemo: (sessionId, memoId, payload) =>
    request('PUT', `/game/${sessionId}/memo/${memoId}`, payload),
  deleteMemo: (sessionId, memoId) =>
    request('DELETE', `/game/${sessionId}/memo/${memoId}`),
};

export const api = USE_MOCK ? mockApi : httpApi;
export { USE_MOCK };
