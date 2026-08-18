// 전역 게임 상태 (zustand) — 서버가 권위, 스토어는 서버 응답 캐시 + UI 상태만.
import { create } from 'zustand';
import { api, setToken } from '../api/client';

let sessionRequestGeneration = 0;
let resumeRequestSequence = 0;
let turnRequestSequence = 0;
const isCurrentSessionRequest = (get, sessionId, generation) =>
  sessionRequestGeneration === generation && get().sessionId === sessionId;

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
  surgePromptPending: false, // 급등주 조회/매수·관망 확인 전에는 턴 진행 잠금
  pendingTurnNumber: null, // next-turn은 성공했지만 GET /turn 재시도가 필요한 턴
  turnLoadError: null,
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
    const generation = ++sessionRequestGeneration;
    localStorage.setItem('antsurvival_session', sessionId);
    set({
      sessionId,
      status: null,
      state: null,
      turn: null,
      pendingEvents: [],
      lastTurnResult: null,
      surgeResults: [],
      surgePromptPending: false,
      pendingTurnNumber: null,
      turnLoadError: null,
      activeModal: null,
      modalProps: {},
      error: null,
    });
    await get().resumeGame(generation);
  },

  // --- UI 상태 ---
  activeModal: null,       // market | asset | trade | portfolio | news | calendar | report | repay | null
  modalProps: {},

  openModal: (name, props = {}) => set({ activeModal: name, modalProps: props }),
  closeModal: () => set({ activeModal: null, modalProps: {} }),

  /** 게임 시작 (인트로 화면) */
  async startGame(difficulty) {
    const generation = ++sessionRequestGeneration;
    set({
      loading: true,
      error: null,
      turn: null,
      pendingEvents: [],
      lastTurnResult: null,
      surgeResults: [],
      surgePromptPending: false,
      pendingTurnNumber: null,
      turnLoadError: null,
      activeModal: null,
      modalProps: {},
    });
    try {
      const s = await api.startGame(difficulty);
      if (sessionRequestGeneration !== generation) return;
      localStorage.setItem('antsurvival_session', s.sessionId);
      set({ sessionId: s.sessionId, status: s.status, state: s });
      await get().loadTurn(s.currentTurn ?? 1, generation);
    } catch (e) {
      if (sessionRequestGeneration !== generation) return;
      if (get().pendingTurnNumber) set({ turnLoadError: e.message });
      else set({ error: e.message });
    } finally {
      if (sessionRequestGeneration === generation) set({ loading: false });
    }
  },

  /** 세션 복구 (새로고침 시) */
  async resumeGame(generation = sessionRequestGeneration) {
    const sid = get().sessionId;
    if (!sid) return;
    const resumeRequestId = ++resumeRequestSequence;
    const isCurrentResume = () =>
      resumeRequestId === resumeRequestSequence &&
      isCurrentSessionRequest(get, sid, generation);
    set({ loading: true, error: null });
    let stateLoaded = false;
    try {
      const s = await api.getState(sid);
      if (!isCurrentResume()) return;
      stateLoaded = true;
      set({ status: s.status, state: s, turnLoadError: null });
      if (s.status === 'active') await get().loadTurn(s.currentTurn, generation);
    } catch (resumeError) {
      if (!isCurrentResume()) return;
      if (stateLoaded && get().pendingTurnNumber) {
        set({ turnLoadError: resumeError.message || '현재 턴을 불러오지 못했습니다.' });
        return;
      }
      if (resumeError.status === 404) {
        // 서버에서 세션이 실제로 사라진 경우에만 로컬 연결을 끊는다.
        localStorage.removeItem('antsurvival_session');
        set({
          sessionId: null,
          status: null,
          state: null,
          turn: null,
          pendingEvents: [],
          lastTurnResult: null,
          surgeResults: [],
          surgePromptPending: false,
          pendingTurnNumber: null,
          turnLoadError: null,
        });
      } else {
        set({ error: resumeError.message || '게임을 불러오지 못했습니다.' });
      }
    } finally {
      if (isCurrentResume()) set({ loading: false });
    }
  },

  /** 현재 턴 데이터 로드 */
  async loadTurn(turnNumber, generation = sessionRequestGeneration) {
    const sid = get().sessionId;
    if (!isCurrentSessionRequest(get, sid, generation)) return null;
    const pendingTarget = get().pendingTurnNumber;
    // POST /next-turn이 이미 더 새 턴을 확정했다면, 늦게 끝난 거래/이벤트 요청이
    // 화면에 남아 있는 구 턴을 다시 읽어 새 턴 GET을 무효화하지 못하게 한다.
    if (pendingTarget !== null && pendingTarget !== turnNumber) return null;
    const turnRequestId = ++turnRequestSequence;
    const isNewTurn = get().turn?.turnNumber !== turnNumber;
    if (isNewTurn) {
      set({ surgePromptPending: true, pendingTurnNumber: turnNumber, turnLoadError: null });
    }
    const turn = await api.getTurn(sid, turnNumber);
    if (!isCurrentSessionRequest(get, sid, generation) || turnRequestId !== turnRequestSequence) return null;
    set({
      turn,
      state: { ...get().state, ...turn.state },
      pendingTurnNumber: get().pendingTurnNumber === turnNumber ? null : get().pendingTurnNumber,
      turnLoadError: null,
    });
  },

  /** 다음 턴 진행 */
  async advanceTurn() {
    const sid = get().sessionId;
    const generation = sessionRequestGeneration;
    set({ loading: true, error: null, turnLoadError: null });
    try {
      const r = await api.nextTurn(sid);
      if (!isCurrentSessionRequest(get, sid, generation)) return;
      set({
        lastTurnResult: r,
        status: r.status,
        pendingEvents: (r.events || []).filter((e) => e.kind === 'choice'),
        surgeResults: (r.surgeResults || []).filter((s) => s.investedAmount > 0),
      });
      if (r.status === 'active' && !r.finished) await get().loadTurn(r.turnNumber, generation);
    } catch (e) {
      if (!isCurrentSessionRequest(get, sid, generation)) return;
      if (get().pendingTurnNumber) set({ turnLoadError: e.message });
      else set({ error: e.message });
    } finally {
      if (isCurrentSessionRequest(get, sid, generation)) set({ loading: false });
    }
  },

  /** 매수/매도 후 상태 갱신 */
  async trade(assetId, tradeType, quantity) {
    const sid = get().sessionId;
    const generation = sessionRequestGeneration;
    const r = await api.trade(sid, { assetId, tradeType, quantity });
    if (!isCurrentSessionRequest(get, sid, generation)) return r;
    await get().loadTurn(get().turn.turnNumber, generation);
    return r;
  },

  /** 급등주 매수 후 같은 턴 상태를 다시 받아 현금/총자산 HUD를 즉시 동기화 */
  async buySurge(surgeStockId, quantity) {
    const sid = get().sessionId;
    const generation = sessionRequestGeneration;
    const r = await api.buySurge(sid, surgeStockId, quantity);
    if (!isCurrentSessionRequest(get, sid, generation)) return r;
    const current = get();
    // 체결 성공은 이후 새로고침 실패와 분리한다. 최소한 서버가 확정한 현금은 즉시 반영해
    // 성공한 매수를 실패처럼 다시 제출하는 일을 막는다.
    set({
      state: current.state ? { ...current.state, cash: r.cashAfter } : current.state,
      turn: current.turn ? {
        ...current.turn,
        state: { ...current.turn.state, cash: r.cashAfter },
      } : current.turn,
    });
    if (current.turn) {
      try {
        await get().loadTurn(current.turn.turnNumber, generation);
      } catch (refreshError) {
        console.error('[buySurge] 체결 후 상태 새로고침 실패', refreshError);
      }
    }
    return r;
  },

  /** 월말 상환 */
  async repay(amount) {
    const sid = get().sessionId;
    const generation = sessionRequestGeneration;
    const r = await api.repay(sid, amount);
    if (!isCurrentSessionRequest(get, sid, generation)) return r;
    set({ status: r.status });
    if (r.status === 'active') await get().loadTurn(get().turn.turnNumber, generation);
    return r;
  },

  /** 선택형 이벤트 해결 (payload: 독촉전화 상환액 등). 팝업은 결과 확인 후 dismissEvent로 닫는다 */
  async resolveEvent(eventLogId, choice, payload) {
    const sid = get().sessionId;
    const generation = sessionRequestGeneration;
    const r = await api.resolveEvent(sid, eventLogId, choice, payload);
    if (!isCurrentSessionRequest(get, sid, generation)) return r;
    const currentState = get().state;
    set({
      status: r.status || get().status,
      state: currentState ? {
        ...currentState,
        ...(r.cash === undefined ? {} : { cash: Number(r.cash) }),
        ...(r.debt === undefined ? {} : { debt: Number(r.debt) }),
        ...(r.stress === undefined ? {} : { stress: Number(r.stress) }),
        ...(r.trust === undefined ? {} : { trust: Number(r.trust) }),
        ...(r.totalAsset === undefined ? {} : { totalAsset: Number(r.totalAsset) }),
      } : currentState,
    });
    // 선택 결과가 성공/실패를 확정하면 즉시 결과 화면으로 전환한다. 종료된 세션의
    // 턴 상세를 다시 요청하면 이벤트 팝업 아래에 종료 전 화면이 남게 된다.
    if (r.finished || (r.status && r.status !== 'active')) return r;
    // 새 턴 상세를 아직 읽는 중이라면 이벤트가 만들어진 새 턴을 갱신한다.
    // 화면에 잠시 남아 있는 구 턴 번호로 새 턴 요청을 덮지 않는다.
    const targetTurn = get().pendingTurnNumber ?? get().turn?.turnNumber;
    if (targetTurn) await get().loadTurn(targetTurn, generation);
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

  /** 급등주 조회가 끝나고 매수/관망 결과를 확인할 때까지 다음 턴을 막는다. */
  setSurgePromptPending(value) {
    set({ surgePromptPending: Boolean(value) });
  },

  /** POST next-turn은 성공했지만 턴 상세 새로고침만 실패한 경우 안전하게 재시도한다. */
  async retryPendingTurn() {
    const turnNumber = get().pendingTurnNumber;
    if (!turnNumber) return;
    const sid = get().sessionId;
    const generation = sessionRequestGeneration;
    set({ loading: true, turnLoadError: null });
    try {
      await get().loadTurn(turnNumber, generation);
    } catch (retryError) {
      if (!isCurrentSessionRequest(get, sid, generation)) return;
      set({ turnLoadError: retryError.message || '현재 턴을 불러오지 못했습니다.' });
    } finally {
      if (isCurrentSessionRequest(get, sid, generation)) set({ loading: false });
    }
  },

  /** 기절(입원) 연출 확인 후 닫기 */
  dismissFaint() {
    set({ lastTurnResult: null });
  },

  /** 게임 초기화 (엔딩 후 다시하기) */
  resetGame() {
    sessionRequestGeneration += 1;
    localStorage.removeItem('antsurvival_session');
    set({
      sessionId: null, status: null, state: null, turn: null,
      pendingEvents: [], lastTurnResult: null, surgeResults: [], surgePromptPending: false,
      pendingTurnNumber: null, turnLoadError: null,
      activeModal: null, modalProps: {}, loading: false, error: null,
    });
  },
}));
