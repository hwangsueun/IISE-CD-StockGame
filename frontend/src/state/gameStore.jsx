// 섹션 3 원칙: 프론트는 서버 상태를 표시하고 입력을 전달한다.
// 모든 게임 상태 변경은 이 스토어의 액션을 통해서만 일어나고, 내부적으로 api 클라이언트를 호출한다.
// 컴포넌트는 useGame()으로 상태/액션을 받아 props처럼 사용한다(직접 fetch 금지).
import { createContext, useContext, useReducer, useCallback, useMemo } from 'react';
import { api } from '../api/client.js';

const GameContext = createContext(null);

const initialState = {
  phase: 'intro', // intro | playing | result
  loading: false,
  error: null,
  sessionId: null,
  difficulty: null,
  maxTurns: 240,
  currentTurn: 1,
  turnData: null, // getTurn 응답
  activeModal: null, // market | detail | trade | portfolio | news | calendar | event | report | null
  modalContext: null, // 모달에 넘길 부가 데이터(선택 자산 등)
  result: null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'LOADING':
      return { ...state, loading: action.value, error: action.value ? null : state.error };
    case 'ERROR':
      return { ...state, loading: false, error: action.error };
    case 'GAME_STARTED':
      return {
        ...state,
        phase: 'playing',
        loading: false,
        sessionId: action.sessionId,
        difficulty: action.difficulty,
        maxTurns: action.maxTurns ?? 240,
        currentTurn: 1,
      };
    case 'TURN_LOADED':
      return { ...state, loading: false, turnData: action.turnData, currentTurn: action.turnData.turnNumber };
    case 'OPEN_MODAL':
      return { ...state, activeModal: action.modal, modalContext: action.context ?? null };
    case 'CLOSE_MODAL':
      return { ...state, activeModal: null, modalContext: null };
    case 'GAME_OVER':
      return { ...state, phase: 'result', loading: false, result: action.result, activeModal: null };
    case 'RESET':
      return initialState;
    default:
      return state;
  }
}

export function GameProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const loadTurn = useCallback(async (sessionId, turnNumber) => {
    dispatch({ type: 'LOADING', value: true });
    try {
      const turnData = await api.getTurn(sessionId, turnNumber);
      dispatch({ type: 'TURN_LOADED', turnData });
      return turnData;
    } catch (error) {
      dispatch({ type: 'ERROR', error: error.message });
      return null;
    }
  }, []);

  const startGame = useCallback(
    async (difficulty) => {
      dispatch({ type: 'LOADING', value: true });
      try {
        const res = await api.startGame(difficulty);
        dispatch({
          type: 'GAME_STARTED',
          sessionId: res.sessionId,
          difficulty,
          maxTurns: res.maxTurns,
        });
        await loadTurn(res.sessionId, 1);
      } catch (error) {
        dispatch({ type: 'ERROR', error: error.message });
      }
    },
    [loadTurn],
  );

  const refreshTurn = useCallback(
    () => loadTurn(state.sessionId, state.currentTurn),
    [loadTurn, state.sessionId, state.currentTurn],
  );

  const doTrade = useCallback(
    async (payload) => {
      const res = await api.trade(state.sessionId, payload);
      await loadTurn(state.sessionId, state.currentTurn);
      return res;
    },
    [loadTurn, state.sessionId, state.currentTurn],
  );

  const advanceTurn = useCallback(async () => {
    dispatch({ type: 'LOADING', value: true });
    try {
      const res = await api.nextTurn(state.sessionId);
      if (res.gameOver) {
        const result = await api.getResult(state.sessionId);
        dispatch({ type: 'GAME_OVER', result });
        return;
      }
      await loadTurn(state.sessionId, res.turnNumber);
    } catch (error) {
      dispatch({ type: 'ERROR', error: error.message });
    }
  }, [loadTurn, state.sessionId]);

  const repay = useCallback(
    async (amount) => {
      const res = await api.repay(state.sessionId, { amount });
      await loadTurn(state.sessionId, state.currentTurn);
      return res;
    },
    [loadTurn, state.sessionId, state.currentTurn],
  );

  const resolveEvent = useCallback(
    async (choice) => {
      const res = await api.resolveEvent(state.sessionId, { choice });
      await loadTurn(state.sessionId, state.currentTurn);
      return res;
    },
    [loadTurn, state.sessionId, state.currentTurn],
  );

  const openModal = useCallback((modal, context) => dispatch({ type: 'OPEN_MODAL', modal, context }), []);
  const closeModal = useCallback(() => dispatch({ type: 'CLOSE_MODAL' }), []);
  const resetGame = useCallback(() => dispatch({ type: 'RESET' }), []);

  const value = useMemo(
    () => ({
      ...state,
      api,
      startGame,
      refreshTurn,
      doTrade,
      advanceTurn,
      repay,
      resolveEvent,
      openModal,
      closeModal,
      resetGame,
    }),
    [state, startGame, refreshTurn, doTrade, advanceTurn, repay, resolveEvent, openModal, closeModal, resetGame],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame은 GameProvider 안에서만 사용할 수 있습니다.');
  return ctx;
}
