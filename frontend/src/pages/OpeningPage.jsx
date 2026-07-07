// 오프닝 화면 (중간보고서 §4.1, 플로우차트 '오프닝-전체 스토리텔링')
// 게임 배경과 사용자가 처한 상황 제시 -> 원금 지급/상환 목표 안내
import { useState } from 'react';
import { useGameStore } from '../state/gameStore';

// TODO(frontend): 디자인 시안의 컷신/일러스트로 교체
const STORY = [
  '평범한 직장인이던 당신. 어느 날, 가족의 빚보증이 잘못되었다는 연락을 받는다.',
  '사채업자가 남긴 말은 하나. "1년 안에 갚아. 아니면..."',
  '수중에 남은 건 퇴직금 5,000만 원. 월급만으로는 어림도 없다.',
  '주식, 채권, 코인 — 시장에서 살아남아 빚을 모두 갚아야 한다.',
  '동학개미 서바이벌, 지금 시작한다.',
];

export default function OpeningPage() {
  const finishOpening = useGameStore((s) => s.finishOpening);
  const [step, setStep] = useState(0);

  const next = () => {
    if (step < STORY.length - 1) setStep(step + 1);
    else finishOpening();
  };

  return (
    <div className="opening-page" onClick={next}>
      <p className="opening-text">{STORY[step]}</p>
      <div className="opening-nav">
        <span>{step + 1} / {STORY.length} — 클릭해서 계속</span>
        <button className="btn-skip" onClick={(e) => { e.stopPropagation(); finishOpening(); }}>
          건너뛰기 ≫
        </button>
      </div>
    </div>
  );
}
