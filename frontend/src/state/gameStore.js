// 전역 게임 상태 (zustand) — 서버가 권위, 스토어는 서버 응답 캐시 + UI 상태만.
import { create } from 'zustand';
import { api, setToken } from '../api/client';
import { TUTORIALS, TUTORIAL_STORAGE_KEY, readTutorialProgress, saveTutorialProgress } from '../utils/tutorials';

// 개발용: 주소에 ?reset 을 붙이면 저장된 게임·안내 기록을 지우고 인트로부터 다시 시작한다.
if (import.meta.env?.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('reset')) {
  localStorage.removeItem('antsurvival_session');
  localStorage.removeItem(TUTORIAL_STORAGE_KEY);
  window.history.replaceState(null, '', window.location.pathname);
}

let sessionRequestGeneration = 0;
let resumeRequestSequence = 0;
let turnRequestSequence = 0;
const isCurrentSessionRequest = (get, sessionId, generation) =>
  sessionRequestGeneration === generation && get().sessionId === sessionId;

const normalizePendingEvent = (event) => ({
  ...event,
  eventLogId: event.eventLogId ?? event.event_log_id,
  eventType: event.eventType ?? event.event_type,
  turnNumber: event.turnNumber ?? event.turn_number,
  kind: 'choice',
  prompt: event.prompt ?? event.detail?.prompt,
  choices: event.choices ?? event.detail?.choices ?? [],
});

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
      tutorialCategory: null,
      tutorialStep: null,
      firstDayStep: null, quantTourStep: null,
      error: null,
    });
    await get().resumeGame(generation);
  },

  // --- UI 상태 ---
  activeModal: null,       // market | asset | trade | portfolio | news | calendar | report | repay | null
  modalProps: {},

  openModal(name, props = {}) {
    // 첫날 체험형 튜토리얼 중에 연 화면은 거기서 직접 안내하므로 카테고리 안내를 띄우지 않고 본 것으로 기록한다.
    if (get().firstDayStep !== null || get().quantTourStep !== null) {
      const { tutorialProgress } = get();
      if (Object.hasOwn(TUTORIALS, name) && !tutorialProgress[name]) {
        const progress = { ...tutorialProgress, [name]: true };
        saveTutorialProgress(progress);
        set({ tutorialProgress: progress });
      }
      set({ activeModal: name, modalProps: props, tutorialCategory: null, tutorialStep: null });
      return;
    }
    // Quant's first visit opens the story invitation. Its guide remains available manually.
    const showTutorial = name !== 'quant' && Object.hasOwn(TUTORIALS, name) && !get().tutorialProgress[name];
    set({ activeModal: name, modalProps: props,
      tutorialCategory: showTutorial ? name : null, tutorialStep: showTutorial ? 1 : null });
  },
  closeModal: () => set({ activeModal: null, modalProps: {}, tutorialCategory: null, tutorialStep: null }),

  // --- 카테고리 첫 방문 안내 (브라우저별 1회, 완료·건너뛰기 모두 기록) ---
  tutorialProgress: readTutorialProgress(),
  tutorialCategory: null,
  tutorialStep: null,      // 1부터 시작 | null(비활성)
  lastTrade: null,         // 직전 예약 주문 { assetId, tradeType, quantity, at }

  // --- 첫날 체험형 튜토리얼 (FirstDayTutorial) ---
  // 실제 게임 1일차 위에서 직접 눌러 보며 진행한다. 끝내거나 건너뛰면 '게임 시작' 안내를 본 것으로 기록한다.
  firstDayStep: null,      // 1~10 | null(비활성)
  startFirstDay: (step = 1) => set({ firstDayStep: step, activeModal: null, modalProps: {},
    tutorialCategory: null, tutorialStep: null }),
  // from: 호출한 쪽이 보고 있던 단계. 턴 전환처럼 한 단계 완료가 연달아 두 번 감지돼도 한 칸만 넘어가게 한다
  nextFirstDayStep: (from) => set((s) => (
    from == null || s.firstDayStep === from ? { firstDayStep: s.firstDayStep + 1 } : {}
  )),
  // 이전 단계로: 열려 있던 창은 닫고 그 단계를 처음부터 다시 보여준다
  prevFirstDayStep: () => set((s) => ({ firstDayStep: Math.max(1, s.firstDayStep - 1), activeModal: null, modalProps: {} })),
  endFirstDay() {
    const progress = { ...get().tutorialProgress, welcome: true };
    saveTutorialProgress(progress);
    set({ firstDayStep: null, tutorialProgress: progress });
  },
  // --- 퀀트 모델 튜토리얼 (QuantTutorial) — 10일이 지나면 한 번. 끝내거나 건너뛰면 quantTour로 기록 ---
  quantTourStep: null,     // 1~5 | null(비활성)
  startQuantTour: () => set({ quantTourStep: 1, activeModal: null, modalProps: {},
    tutorialCategory: null, tutorialStep: null }),
  nextQuantTourStep: (from) => set((s) => (
    from == null || s.quantTourStep === from ? { quantTourStep: s.quantTourStep + 1 } : {}
  )),
  // 1단계(버튼 누르기)로 돌아가면 창을 닫아야 다시 누를 수 있다. 창 안 단계끼리는 창을 유지한다
  prevQuantTourStep: () => set((s) => (s.quantTourStep <= 2
    ? { quantTourStep: 1, activeModal: null, modalProps: {} }
    : { quantTourStep: s.quantTourStep - 1 })),
  endQuantTour() {
    // 투어에서 퀀트 화면을 소개했으니 퀀트 카테고리 첫 방문 안내도 본 것으로 기록한다
    const progress = { ...get().tutorialProgress, quantTour: true, quant: true };
    saveTutorialProgress(progress);
    set({ quantTourStep: null, tutorialProgress: progress });
  },
  startTutorial(category = 'welcome') {
    if (Object.hasOwn(TUTORIALS, category)) set({ tutorialCategory: category, tutorialStep: 1 });
  },
  nextTutorialStep() {
    const { tutorialCategory, tutorialStep } = get();
    if (tutorialStep === null) return;
    if (tutorialStep >= TUTORIALS[tutorialCategory].steps.length) get().endTutorial();
    else set({ tutorialStep: tutorialStep + 1 });
  },
  prevTutorialStep: () => set((s) => s.tutorialStep === null ? {} : ({ tutorialStep: Math.max(1, s.tutorialStep - 1) })),
  endTutorial() {
    const { tutorialCategory, tutorialProgress } = get();
    if (!tutorialCategory) return;
    const progress = { ...tutorialProgress, [tutorialCategory]: true };
    saveTutorialProgress(progress);
    set({ tutorialCategory: null, tutorialStep: null, tutorialProgress: progress });
  },

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
      tutorialCategory: null,
      tutorialStep: null,
      firstDayStep: null, quantTourStep: null,
    });
    try {
      const s = await api.startGame(difficulty);
      if (sessionRequestGeneration !== generation) return;
      localStorage.setItem('antsurvival_session', s.sessionId);
      set({ sessionId: s.sessionId, status: s.status, state: s });
      await get().loadTurn(s.currentTurn ?? 1, generation);
      // 시작 안내는 MainPage에서 표시한다. 새로고침·첫 턴 로드 재시도에도 동일하게 적용된다.
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
      if (s.status === 'active') {
        // 현재·이전 턴의 미해결 선택도 함께 복원할 때까지 다음 날 진행을 막는다.
        set({ pendingTurnNumber: s.currentTurn });
        await get().loadTurn(s.currentTurn, generation);
      }
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
    const restoreEvents = isNewTurn || pendingTarget === turnNumber;
    const [turn, pendingEvents] = await Promise.all([
      api.getTurn(sid, turnNumber),
      restoreEvents ? api.getPendingEvents(sid) : Promise.resolve(null),
    ]);
    if (!isCurrentSessionRequest(get, sid, generation) || turnRequestId !== turnRequestSequence) return null;
    set({
      turn,
      state: { ...get().state, ...turn.state },
      ...(pendingEvents === null ? {} : { pendingEvents: pendingEvents.map(normalizePendingEvent) }),
      pendingTurnNumber: get().pendingTurnNumber === turnNumber ? null : get().pendingTurnNumber,
      turnLoadError: null,
    });
  },

  /** 다음 턴 진행 */
  async advanceTurn() {
    const current = get();
    // 연속 클릭이나 턴 조회 재시도 중에는 이미 확정한 턴을 한 번 더 진행하지 않는다.
    if (current.loading || current.pendingTurnNumber !== null || current.pendingEvents.length > 0) return;
    if (!current.sessionId || !current.turn || current.status !== 'active') return;
    // 20턴을 마칠 때 방문 컷신을 먼저 진행한다. 입원 중에는 서버가 미납 처리한다.
    if (current.turn.isRepaymentTurn && !current.turn.repaymentCompleted && !current.turn.actionLocked) {
      current.openModal('repay', { advanceAfterRepayment: true });
      return;
    }
    const sid = current.sessionId;
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
  async trade(assetId, tradeType, quantity, orderKey) {
    const sid = get().sessionId;
    const generation = sessionRequestGeneration;
    const r = await api.trade(sid, { assetId, tradeType, quantity, orderKey });
    if (!isCurrentSessionRequest(get, sid, generation)) return r;
    // 튜토리얼이 매수 예약 완료를 알아채는 데 쓴다
    set({ lastTrade: { assetId, tradeType, quantity: r.quantity, at: Date.now() } });
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
    const repaymentTurn = get().turn?.turnNumber;
    const r = await api.repay(sid, amount);
    if (!isCurrentSessionRequest(get, sid, generation)) return r;
    const current = get();
    const targetTurn = current.pendingTurnNumber ?? current.turn?.turnNumber;
    // 응답을 기다리는 동안 다른 턴으로 이동했다면 과거 잔액을 덮어쓰지 않는다.
    if (targetTurn === repaymentTurn) {
      const applyResult = (previous) => previous ? {
        ...previous,
        cash: Number(r.cash),
        debt: Number(r.debtRemaining),
        trust: r.trust === undefined
          ? Math.max(0, Math.min(100, Number(previous.trust) + Number(r.trustDelta || 0)))
          : Number(r.trust),
        stress: r.stress === undefined
          ? Math.max(0, Math.min(100, Number(previous.stress) + Number(r.stressDelta || 0)))
          : Number(r.stress),
        ...(r.totalAsset !== undefined ? { totalAsset: Number(r.totalAsset) }
          : previous.totalAsset == null ? {}
          : { totalAsset: Number(previous.totalAsset) + Number(r.cash) - Number(r.cashBefore ?? previous.cash) }),
      } : previous;
      // 상환 전에 시작된 조회가 늦게 도착해 완료 상태를 되돌리지 못하게 한다.
      turnRequestSequence += 1;
      set({
        status: r.status,
        state: applyResult(current.state),
        turn: current.turn ? {
          ...current.turn,
          repaymentCompleted: true,
          repaymentDueAmount: r.dueAmount,
          state: applyResult(current.turn.state),
        } : current.turn,
      });
    }
    if (r.status === 'active' && targetTurn) {
      try {
        await get().loadTurn(targetTurn, generation);
      } catch (refreshError) {
        // POST 성공은 확정됐다. 조회 실패를 상환 실패로 알려 재송금을 유도하지 않는다.
        console.error('[repay] 상환 후 상태 새로고침 실패', refreshError);
      }
    }
    return r;
  },

  /** 선택형 이벤트 해결 (payload: 독촉전화 상환액 등). 팝업은 결과 확인 후 dismissEvent로 닫는다 */
  async resolveEvent(eventLogId, choice, payload) {
    const sid = get().sessionId;
    const generation = sessionRequestGeneration;
    const eventTurn = get().pendingTurnNumber ?? get().turn?.turnNumber;
    const r = await api.resolveEvent(sid, eventLogId, choice, payload);
    if (!isCurrentSessionRequest(get, sid, generation)) return r;
    const current = get();
    const targetTurn = current.pendingTurnNumber ?? current.turn?.turnNumber;
    if (targetTurn === eventTurn) {
      const applyResult = (previous) => previous ? {
        ...previous,
        ...(r.cash === undefined ? {} : { cash: Number(r.cash) }),
        ...(r.debt === undefined ? {} : { debt: Number(r.debt) }),
        ...(r.stress === undefined ? {} : { stress: Number(r.stress) }),
        ...(r.trust === undefined ? {} : { trust: Number(r.trust) }),
        ...(r.totalAsset !== undefined ? { totalAsset: Number(r.totalAsset) }
          : previous.totalAsset == null || r.cash === undefined ? {}
          : { totalAsset: Number(previous.totalAsset) + Number(r.cash) - Number(previous.cash) }),
      } : previous;
      // 선택 전에 시작한 조회가 늦게 도착해 확정된 결과를 되돌리지 못하게 한다.
      turnRequestSequence += 1;
      set({
        status: r.status || current.status,
        state: applyResult(current.state),
        turn: current.turn ? { ...current.turn, state: applyResult(current.turn.state) } : current.turn,
      });
    }
    // 선택 결과가 성공/실패를 확정하면 즉시 결과 화면으로 전환한다. 종료된 세션의
    // 턴 상세를 다시 요청하면 이벤트 팝업 아래에 종료 전 화면이 남게 된다.
    if (r.finished || (r.status && r.status !== 'active')) return r;
    // 새 턴 상세를 아직 읽는 중이라면 이벤트가 만들어진 새 턴을 갱신한다.
    // 화면에 잠시 남아 있는 구 턴 번호로 새 턴 요청을 덮지 않는다.
    if (targetTurn) {
      try {
        await get().loadTurn(targetTurn, generation);
      } catch (refreshError) {
        // 이미 처리한 선택은 결과 확인으로 이어간다. 다시 제출하게 만들지 않는다.
        if (isCurrentSessionRequest(get, sid, generation) && get().pendingTurnNumber === targetTurn) {
          set({ turnLoadError: refreshError.message || '현재 턴을 불러오지 못했습니다.' });
        }
        console.error('[resolveEvent] 선택 후 상태 새로고침 실패', refreshError);
      }
    }
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
      tutorialCategory: null, tutorialStep: null, firstDayStep: null, quantTourStep: null,
    });
  },
}));
