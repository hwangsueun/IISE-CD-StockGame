// 화면 라우팅: 인트로 -> 메인(게임) -> 결과 (ARCHITECTURE.md §10)
import { useEffect } from 'react';
import { useGameStore } from './state/gameStore';
import IntroPage from './pages/IntroPage';
import MainPage from './pages/MainPage';
import ResultPage from './pages/ResultPage';

export default function App() {
  const { sessionId, status, resumeGame } = useGameStore();

  // 새로고침 시 세션 복구
  useEffect(() => {
    if (sessionId && !status) resumeGame();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!sessionId) return <IntroPage />;
  if (status === 'success' || status === 'failed') return <ResultPage />;
  return <MainPage />;
}
