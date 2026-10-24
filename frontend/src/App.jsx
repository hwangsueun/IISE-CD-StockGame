// 화면 라우팅: 인트로(빚 설정) -> 메인(게임) -> 결과 (ARCHITECTURE.md §10)
import { useEffect } from 'react';
import { useGameStore } from './state/gameStore';
import IntroPage from './pages/IntroPage';
import MainPage from './pages/MainPage';
import ResultPage, { DevEndingPreview } from './pages/ResultPage';

// 개발용: ?ending=happy | bad 로 엔딩 컷신만 미리 본다 (세션·서버 불필요)
const DEV_ENDING = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('ending') : null;

export default function App() {
  const { sessionId, status, resumeGame, loadProfile } = useGameStore();

  // 새로고침 시 세션/로그인 복구
  useEffect(() => {
    if (localStorage.getItem('antsurvival_token')) loadProfile();
    if (sessionId && !status) resumeGame();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (DEV_ENDING) return <DevEndingPreview kind={DEV_ENDING} />;
  if (!sessionId) return <IntroPage />;
  if (status === 'success' || status === 'failed') return <ResultPage />;
  return <MainPage />;
}
