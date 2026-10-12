import { useEffect, useRef } from 'react';
import { useGameStore } from '../state/gameStore';
import { TUTORIALS } from '../utils/tutorials';

export default function TutorialOverlay() {
  const { tutorialCategory, tutorialStep, tutorialProgress, nextTutorialStep,
    prevTutorialStep, endTutorial } = useGameStore();
  const tutorial = TUTORIALS[tutorialCategory];
  const step = tutorial?.steps[tutorialStep - 1];
  const dialogRef = useRef(null);
  const headingRef = useRef(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    if (dialogRef.current) dialogRef.current.scrollTop = 0;
  }, [tutorialCategory, tutorialStep]);

  if (!step) return null;
  const isLast = tutorialStep === tutorial.steps.length;
  const replay = tutorialProgress[tutorialCategory];

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      endTutorial();
    }
    if (event.key === 'Tab') {
      const buttons = [...dialogRef.current.querySelectorAll('button:not(:disabled)')];
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  };

  return (
    <div className="tutorial-overlay" onKeyDown={handleKeyDown}>
      <section className="tutorial-card" ref={dialogRef} role="dialog" aria-modal="true"
        aria-labelledby="tutorial-title" aria-describedby="tutorial-body tutorial-tip">
        <header className="tutorial-header">
          <span className="tutorial-eyebrow">{replay ? '사용법 다시 보기' : '처음이라면, 잠깐!'} · {tutorial.label}</span>
          <span className="tutorial-count" aria-label={`${tutorial.steps.length}단계 중 ${tutorialStep}단계`}>
            {String(tutorialStep).padStart(2, '0')} / {String(tutorial.steps.length).padStart(2, '0')}
          </span>
        </header>
        <div className="tutorial-progress" aria-hidden="true">
          {tutorial.steps.map((_, index) => <span key={index} className={index < tutorialStep ? 'filled' : ''} />)}
        </div>
        <div className="tutorial-content">
          <div className="tutorial-icon" aria-hidden="true">{tutorial.icon}</div>
          <h2 id="tutorial-title" ref={headingRef} tabIndex={-1}>{step.title}</h2>
          <p id="tutorial-body">{step.body}</p>
          <aside className="tutorial-tip" id="tutorial-tip"><b>기억해 두세요</b><p>{step.tip}</p></aside>
        </div>
        <footer className="tutorial-footer">
          <div className="tutorial-actions">
            <button type="button" className="tutorial-skip" onClick={endTutorial}>
              {replay ? '안내 닫기' : '이 안내 건너뛰기'}
            </button>
            <div className="tutorial-navigation">
              {tutorialStep > 1 && <button type="button" className="tutorial-prev" onClick={prevTutorialStep}>이전</button>}
              <button type="button" className="tutorial-next" onClick={nextTutorialStep}>
                {isLast ? (tutorialCategory === 'welcome' ? '시작하기' : '확인했어요') : '다음'} <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>
          <p className="tutorial-reminder">다시 보고 싶다면 화면 위의 사용법 또는 메인 화면의 ?를 눌러 주세요.</p>
        </footer>
      </section>
    </div>
  );
}
