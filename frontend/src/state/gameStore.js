// 전역 게임 상태 (zustand) — 서버가 권위, 스토어는 서버 응답 캐시 + UI 상태만.
import { create } from 'zustand';
import { api, setToken } from '../api/client';

export const useGameStore = create((set, get) => ({
  // --- 회원 (게스트 허용) ---
  user: null,              // { id, username, nickname } | null
  savedSessions: [],       // 이어하기 목록 (로그인 시)

  // --- 세션/턴 상태 (서버 응답 미러) ---
  sessionId: localStorage.getItem('antsurvival_session') || null,
  status: null,            // active | success | failed
  state: null,             // { cash, totalAsset, debt, stress, trust }
  turn: null,              // GET /turn/:n 응답 전체
  pendingEvents: [],       // 선택 대기 이벤트 (팝업)
  lastTurnResult: null,    // next-turn 응답 (월초/이벤트/급등주 정산 연출용)
  surgeResults: [],        // 직전 턴 급등주 정산 (팝업)
  seenOpening: sessionStorage.getItem('antsurvival_opening') === '1',
  loading: false,
  error: null,

  /** 오프닝 스토리텔링 완료 */
  finishOpening() {
    sessionStorage.setItem('antsurvival_opening', '1');
    set({ seenOpening: true });
  },

  // --- 회원관리 (기능명세서 §회원) ---
  async login(username, password) {
    const r = await api.login(username, password);
    setToken(r.token);
    set({ user: r.user });
    await get().loadProfile();
    return r.user;
  },
  async registerAndLogin(username, password, nickname) {
    await api.register(username, password, nickname);
    return get().login(username, password);
  },
  async loadProfile() {
    try {
      const me = await api.me();
      set({ user: { id: me.id, username: me.username, nickname: me.nickname }, savedSessions: me.sessions });
    } catch {
      setToken(null);
      set({ user: null, savedSessions: [] });
    }
  },
  async logout() {
    try { await api.logout(); } catch { /* 토큰 만료 무시 */ }
    setToken(null);
    set({ user: null, savedSessions: [] });
  },
  /** 이어하기: 저장 세션 선택 */
  async continueSession(sessionId) {
    localStorage.setItem('antsurvival_session', sessionId);
    set({ sessionId, status: null });
    await get().resumeGame();
  },

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
        surgeResults: (r.surgeResults || []).filter((s) => s.invested > 0),
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

  /** 선택형 이벤트 해결 (payload: 독촉전화 상환액 등). 팝업은 결과 확인 후 dismissEvent로 닫는다 */
  async resolveEvent(eventLogId, choice, payload) {
    const sid = get().sessionId;
    const r = await api.resolveEvent(sid, eventLogId, choice, payload);
    await get().loadTurn(get().turn.turnNumber);
    return r;
  },

  /** 결과 확인 후 이벤트 팝업 닫기 */
  dismissEvent(eventLogId) {
    set({ pendingEvents: get().pendingEvents.filter((e) => (e.eventLogId || e.event_log_id) !== eventLogId) });
  },

  /** 급등주 정산 팝업 닫기 */
  dismissSurgeResults() {
    set({ surgeResults: [] });
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
