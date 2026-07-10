// 화면 라우팅: 인트로(빚 설정) -> 메인(게임) -> 결과 (ARCHITECTURE.md §10)
import { useEffect } from 'react';
import { useGameStore } from './state/gameStore';
import IntroPage from './pages/IntroPage';
import MainPage from './pages/MainPage';
import ResultPage from './pages/ResultPage';

export default function App() {
  const { sessionId, status, resumeGame, loadProfile } = useGameStore();

  // 새로고침 시 세션/로그인 복구
  useEffect(() => {
    if (localStorage.getItem('antsurvival_token')) loadProfile();
    if (sessionId && !status) resumeGame();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!sessionId) return <IntroPage />;
  if (status === 'success' || status === 'failed') return <ResultPage />;
  return <MainPage />;
}
