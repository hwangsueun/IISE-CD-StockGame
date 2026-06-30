import { useGame } from './state/gameStore.jsx';
import IntroPage from './pages/IntroPage.jsx';
import MainPage from './pages/MainPage.jsx';
import ResultPage from './pages/ResultPage.jsx';

// 섹션 10 화면 흐름: 인트로 -> 메인(+모달) -> 리포트/결과
export default function App() {
  const { phase } = useGame();

  return (
    <div className="app-shell">
      {phase === 'intro' && <IntroPage />}
      {phase === 'playing' && <MainPage />}
      {phase === 'result' && <ResultPage />}
    </div>
  );
}
