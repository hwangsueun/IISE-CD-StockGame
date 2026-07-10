// 인트로 화면 — 사채업자 호출 컷신 + 빚 난이도 선택 (§10)
// 디자인 원본: public/game/Intro - Debt Setup.html (Phase D 이식 — 대사/연출 동일, 수치는 server/constants.js 기준)
import { useState } from 'react';
import { useGameStore } from '../state/gameStore';
import { useTypewriter } from '../hooks/useTypewriter';
import FaintOverlay from '../components/FaintOverlay';
import CatchWaxon from '../components/minigames/CatchWaxon';
import AvoidProfessor from '../components/minigames/AvoidProfessor';

// [개발용 임시] 백엔드 없이 미니게임을 미리보기 위한 래퍼 — 확인 끝나면 제거 예정
const DEV_MINIGAMES = { waxon: { label: '왝슨을 잡아라', Component: CatchWaxon }, professor: { label: '교수님을 피해라', Component: AvoidProfessor } };

// [개발용 임시] 백엔드 없이 Phase D 컷신을 미리보기 위한 목데이터 — 확인 끝나면 제거 예정
const DEV_MOCK_FAINT_EVENT = {
  eventType: 'faint',
  kind: 'immediate',
  detail: { message: '극심한 스트레스로 기절했다.', skipDays: 4, hospitalCost: 2_000_000, cashPaid: 2_000_000, debtAdded: 0 },
};

const INITIAL_CASH = 50_000_000;

const DEBT_OPTIONS = [
  {
    key: 'easy', num: '01', cls: 'safe', label: '5천만 원이요.', debt: 50_000_000,
    reply: '<span class="em">5천.</span> 됐어. 잊은 줄 알았네.',
    pressure: '날짜는 내가 기억해. 너는 돈만 준비해.',
  },
  {
    key: 'normal', num: '02', cls: 'warn', label: '1억 원이요.', debt: 100_000_000,
    reply: '<span class="em">1억이지.</span> 숫자는 정확하네.',
    pressure: '못 맞추면, 데리러 갈게.',
  },
  {
    key: 'hard', num: '03', cls: 'danger', label: '1억 5천만 원이요.', debt: 150_000_000,
    reply: '<span class="red">1억 5천.</span> 입으로 말은 잘하네.',
    pressure: '<span class="red">내가 아는 데가 있어.</span> 조용하고, 사람도 별로 안 다녀. 같이 가는 일 만들지 마.',
  },
];

const SCREEN_NAMES = ['검은 화면', '도입 대사', '빚 금액 질문', '선택 반응', '상환 압박', '통화 종료'];
const TOTAL_STEPS = SCREEN_NAMES.length;

export default function IntroPage() {
  const { startGame, loading, error } = useGameStore();
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState(null);
  const [devPreviewFaint, setDevPreviewFaint] = useState(false);
  const [devPreviewGame, setDevPreviewGame] = useState(null); // null | 'waxon' | 'professor'
  const [devGameResult, setDevGameResult] = useState(null);

  const picked_ = DEBT_OPTIONS.find((o) => o.key === picked);

  const narrationText = (() => {
    switch (step) {
      case 1: return '<span class="em">박 사장.</span> 나야. …설마 내 번호 지운 건 아니지.';
      case 2: return '확인 좀 하자. <span class="em">네가 쓴 사채가 얼마더라..?</span>';
      case 3: return picked_ ? picked_.reply : '';
      case 4: return picked_ ? picked_.pressure : '';
      case 5: return '끊는다.';
      default: return '';
    }
  })();

  const hasNarration = step >= 1;
  const { html: typedHtml, done: typedDone, skip } = useTypewriter(narrationText, hasNarration);

  const showChoices = step === 2 && typedDone;
  const showStart = step === 5 && typedDone;
  const advanceOnClick = step === 0 || ((step === 1 || step === 3 || step === 4) && typedDone);

  const restart = () => { setStep(0); setPicked(null); };

  const handleStageClick = () => {
    if (hasNarration && !typedDone) { skip(); return; }
    if (advanceOnClick) setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  };

  const choose = (key) => {
    setPicked(key);
    setStep(3);
  };

  const won = (n) => `₩ ${n.toLocaleString('ko-KR')}`;

  return (
    <div className="intro-page">
      <div className="game-frame" onClick={handleStageClick}>
        <div className="title-plate">★ INTRO · 초기 빚 설정 ★</div>
        <div className="nav-strip">
          <button title="처음으로" onClick={(e) => { e.stopPropagation(); restart(); }}>↺ 처음으로</button>
        </div>

        <div className="screen-tag">
          <span className="num">S{step + 1}</span>
          <span className="nm">{SCREEN_NAMES[step]}</span>
          <span className="step">STEP {step + 1} / {TOTAL_STEPS}</span>
        </div>

        <div className="intro-stage">
          {step === 0 && (
            <div className="black-title">
              <div className="small">★ STOCK LIFE ★</div>
              <div className="big">사채업자의 호출</div>
              <div className="sub">…전화벨이 울린다.</div>
            </div>
          )}
          {step === 1 && (
            <div className="black-title" style={{ opacity: 0.5 }}>
              <div className="small">전화 연결됨…</div>
              <div className="big" style={{ fontSize: 24, color: 'var(--px-ink-dim)' }}>사채업자 김씨</div>
            </div>
          )}
          {step === 2 && (
            <div className="black-title" style={{ opacity: 0.55 }}>
              <div className="small">QUESTION</div>
              <div className="big" style={{ fontSize: 26, color: 'var(--px-ink-dim)' }}>…네가 쓴 사채가</div>
              <div className="big" style={{ fontSize: 26, color: 'var(--px-ink-dim)' }}>얼마더라..?</div>
            </div>
          )}
          {step === 3 && picked_ && (
            <div className="black-title" style={{ opacity: 0.6 }}>
              <div className="small">YOU ANSWERED</div>
              <div className="big" style={{ fontSize: 30 }}>&quot;{picked_.label}&quot;</div>
            </div>
          )}
          {step === 4 && (
            <div className="black-title" style={{ opacity: 0.4 }}>
              <div className="small">…</div>
            </div>
          )}
          {step === 5 && (
            <div className="black-title" style={{ opacity: 0.55 }}>
              <div className="small">CALL ENDED</div>
              <div className="big" style={{ fontSize: 26, color: 'var(--px-ink-dim)' }}>…뚜─</div>
            </div>
          )}
        </div>

        {step === 0 && <div className="press-hint">▶ 화면을 클릭하세요</div>}

        {showChoices && (
          <div className="choice-strip">
            {DEBT_OPTIONS.map((o) => (
              <button
                key={o.key}
                className={`choice-btn ${o.cls}`}
                onClick={(e) => { e.stopPropagation(); choose(o.key); }}
              >
                <span className="num">ANSWER {o.num}</span>
                <span className="text">&quot;{o.label}&quot;</span>
                <span className="sub">초기 자금 {won(INITIAL_CASH)}</span>
              </button>
            ))}
          </div>
        )}

        {showStart && (
          <div className="choice-strip single">
            <button
              className="choice-btn gold"
              disabled={loading}
              onClick={(e) => { e.stopPropagation(); startGame(picked || 'normal'); }}
            >
              <span className="num">CONTINUE</span>
              <span className="text">{loading ? '진행 중...' : '▶ 전화를 끊는다'}</span>
              <span className="sub">&nbsp;</span>
            </button>
          </div>
        )}

        {hasNarration && (
          <div className="narration">
            <div className="nar-head">
              <div className="nar-portrait">☠</div>
              <span className="nar-name">사채업자 김씨</span>
              <span className="nar-tag">
                {step === 2 ? 'QUESTION' : step === 3 ? 'REACTION' : step === 4 ? 'PRESSURE' : step === 5 ? 'END' : 'DIALOG'}
              </span>
              <span className="nar-prog">STEP <b>{step + 1}</b></span>
            </div>
            <div className="nar-body">
              <span dangerouslySetInnerHTML={{ __html: typedHtml }} />
              {!typedDone && <span className="cursor" />}
            </div>
            {advanceOnClick && <div className="nar-next">▶ 계속</div>}
          </div>
        )}

        <div className="crt" />
      </div>

      {error && <p className="error-text">{error}</p>}

      {/* [개발용 임시] Phase D 미리보기 — 확인 끝나면 제거 예정 */}
      <button
        type="button"
        style={{ marginTop: 12, opacity: 0.6, fontSize: 12 }}
        onClick={() => setDevPreviewFaint(true)}
      >
        [개발용] 기절 이벤트 미리보기
      </button>
      {devPreviewFaint && (
        <FaintOverlay event={DEV_MOCK_FAINT_EVENT} onDismiss={() => setDevPreviewFaint(false)} />
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        {Object.entries(DEV_MINIGAMES).map(([key, g]) => (
          <button
            key={key}
            type="button"
            style={{ marginTop: 4, opacity: 0.6, fontSize: 12 }}
            onClick={() => { setDevGameResult(null); setDevPreviewGame(key); }}
          >
            [개발용] {g.label} 미리보기
          </button>
        ))}
      </div>
      {devPreviewGame && (() => {
        const { label, Component } = DEV_MINIGAMES[devPreviewGame];
        return (
          <div className="modal-overlay">
            <div className="modal modal-wide">
              <header className="modal-header">
                <h2>[개발용] {label}</h2>
                <button className="modal-close" onClick={() => setDevPreviewGame(null)}>✕</button>
              </header>
              <div className="modal-body">
                {devGameResult == null ? (
                  <Component onFinish={(score) => setDevGameResult(score)} />
                ) : (
                  <>
                    <p>원점수: {devGameResult}</p>
                    <button className="btn-primary" onClick={() => setDevPreviewGame(null)}>닫기</button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
