// 전역 게임 상태 (zustand) — 서버가 권위, 스토어는 서버 응답 캐시 + UI 상태만.
import { create } from 'zustand';
import { api } from '../api/client';

export const useGameStore = create((set, get) => ({
  // --- 세션/턴 상태 (서버 응답 미러) ---
  sessionId: localStorage.getItem('antsurvival_session') || null,
  status: null,            // active | success | failed
  state: null,             // { cash, totalAsset, debt, stress, trust }
  turn: null,              // GET /turn/:n 응답 전체
  pendingEvents: [],       // 선택 대기 이벤트 (팝업)
  lastTurnResult: null,    // next-turn 응답 (월초/이벤트 연출용)
  loading: false,
  error: null,

  // --- UI 상태 ---
  activeModal: null,       // market | asset | trade | portfolio | news | calendar | report | repay | null
  modalProps: {},

  openModal: (name, props = {}) => set({ activeModal: name, modalProps: props }),
  closeModal: () => set({ activeModal: null, modalProps: {} }),

  /** 게임 시작 (인트로 화면) */
  async startGame(difficulty) {
    set({ loading: true, error: null });
    try {
      const s = await api.startGame(difficulty);
      localStorage.setItem('antsurvival_session', s.sessionId);
      set({ sessionId: s.sessionId, status: s.status, state: s });
      await get().loadTurn(s.currentTurn ?? 1);
    } catch (e) {
      set({ error: e.message });
    } finally {
      set({ loading: false });
    }
  },

  /** 세션 복구 (새로고침 시) */
  async resumeGame() {
    const sid = get().sessionId;
    if (!sid) return;
    set({ loading: true });
    try {
      const s = await api.getState(sid);
      set({ status: s.status, state: s });
      if (s.status === 'active') await get().loadTurn(s.currentTurn);
    } catch {
      // 세션 소실 -> 인트로로
      localStorage.removeItem('antsurvival_session');
      set({ sessionId: null });
    } finally {
      set({ loading: false });
    }
  },

  /** 현재 턴 데이터 로드 */
  async loadTurn(turnNumber) {
    const sid = get().sessionId;
    const turn = await api.getTurn(sid, turnNumber);
    set({ turn, state: { ...get().state, ...turn.state } });
  },

  /** 다음 턴 진행 */
  async advanceTurn() {
    const sid = get().sessionId;
    set({ loading: true, error: null });
    try {
      const r = await api.nextTurn(sid);
      set({
        lastTurnResult: r,
        status: r.status,
        pendingEvents: (r.events || []).filter((e) => e.kind === 'choice'),
      });
      if (r.status === 'active' && !r.finished) await get().loadTurn(r.turnNumber);
    } catch (e) {
      set({ error: e.message });
    } finally {
      set({ loading: false });
    }
  },

  /** 매수/매도 후 상태 갱신 */
  async trade(assetId, tradeType, quantity) {
    const sid = get().sessionId;
    const r = await api.trade(sid, { assetId, tradeType, quantity });
    await get().loadTurn(get().turn.turnNumber);
    return r;
  },

  /** 월말 상환 */
  async repay(amount) {
    const sid = get().sessionId;
    const r = await api.repay(sid, amount);
    set({ status: r.status });
    if (r.status === 'active') await get().loadTurn(get().turn.turnNumber);
    return r;
  },

  /** 선택형 이벤트 해결 */
  async resolveEvent(eventLogId, choice) {
    const sid = get().sessionId;
    const r = await api.resolveEvent(sid, eventLogId, choice);
    set({ pendingEvents: get().pendingEvents.filter((e) => e.eventLogId !== eventLogId) });
    await get().loadTurn(get().turn.turnNumber);
    return r;
  },

  /** 게임 초기화 (엔딩 후 다시하기) */
  resetGame() {
    localStorage.removeItem('antsurvival_session');
    set({
      sessionId: null, status: null, state: null, turn: null,
      pendingEvents: [], lastTurnResult: null, activeModal: null,
    });
  },
}));
