// 퀀트 모델 튜토리얼: 10일이 지나면(QUANT_TOUR_TURN) [퀀트 모델] 버튼을 강조하며 한 번 띄운다.
// 퀀트 화면의 기능을 짧게 짚는 소개용이라, 첫날 튜토리얼과 같은 스포트라이트 엔진(SpotlightTour)을 쓴다.
// 상태는 gameStore.quantTourStep. 진행 중엔 '다음 날' 버튼이 잠긴다(MainPage).
// 창 전체가 아니라 설명하는 부분만 밝혀서, 설명 글이 어두운 영역 위에 겹치지 않고 읽히게 한다.
import { useGameStore } from '../state/gameStore';
import { SpotlightTour } from './FirstDayTutorial';

export const QUANT_TOUR_TURN = 11; // 10일을 넘긴 뒤 시작하는 턴

const QUANT_STEPS = {
  1: {
    view: ({ activeModal }) => (activeModal === 'quant'
      ? { spots: [], hint: <>퀀트 화면을 불러오는 중…</> }
      : {
        title: '퀀트 AI가 지켜보고 있었다',
        spots: [{
          sel: '.quant-open-btn',
          place: 'left',
          note: () => (
            <>
              <span className="big">🤖 퀀트 모델</span>
              지난 10일 동안 AI도 <b>같은 5천만원</b>으로<br />
              따로 투자하고 있었다<br />
              <b>눌러서 성적을 확인하자!</b>
            </>
          ),
        }],
        interact: '.quant-open-btn',
      }),
    onModal: (activeModal) => (activeModal === 'quant' ? 'next' : undefined),
  },
  2: {
    spots: [{
      sel: '.quant-stats',
      place: 'below',
      boxed: true,
      note: () => (
        <>
          <span className="big">📊 성적 비교</span>
          <b>퀀트 총자산·누적 수익률</b>과 <b>내 총자산</b>을 나란히 본다<br />
          <span className="dim">퀀트는 투자금만 굴리고, 나는 월급·생활비·상환까지 반영된다</span>
        </>
      ),
    }],
    hint: <>목표는 단순하다 · <b>AI보다 잘 굴려 보자!</b></>,
  },
  3: {
    spots: [
      {
        sel: ['#quant-tab-holdings', '#quant-tab-history'],
        place: 'below',
        boxed: true,
        note: () => (
          <>
            <span className="big">🗂 AI의 투자 내역</span>
            <b>보유 포트폴리오</b> 지금 들고 있는 종목·비중<br />
            <b>종목 선택</b> 오늘 매긴 점수 순위<br />
            <b>예약 주문</b> 다음 개장일 시가에 사고팔 주문<br />
            <b>운용 기록</b> 날짜별 총자산·수익률
          </>
        ),
      },
    ],
    hint: <>AI가 <b>무엇을 샀는지</b> 보고 내 투자에 참고해도 된다</>,
  },
  4: {
    spots: [
      {
        sel: ['#quant-tab-learning', '#quant-tab-indicators'],
        place: 'below',
        boxed: true,
        note: () => (
          <>
            <span className="big">🧠 AI는 어떻게 고를까</span>
            <b>AI 학습·예측</b> 과거 주가·거래량으로 배우는 과정<br />
            <b>지표 계산법</b> 점수에 쓰인 지표의 계산식과 예시
          </>
        ),
      },
    ],
    hint: <>점수는 코스피 대비 성과 <b>예측</b>일 뿐 · 수익을 보장하지 않는다</>,
  },
  5: {
    spots: [
      { sel: '.modal .modal-help-btn', place: 'below', note: () => <>규칙이 헷갈리면 <b>?</b></> },
      { sel: '.modal-close', place: 'right', note: () => <>다 봤으면 <b>✕</b>로 닫기</> },
    ],
    interact: '.modal-close',
    hint: <>상단 <b>[퀀트 모델]</b> 버튼으로 언제든 다시 볼 수 있다</>,
    onModal: (activeModal) => (activeModal ? undefined : 'next'),
  },
};

export default function QuantTutorial() {
  const step = useGameStore((s) => s.quantTourStep);
  const nextQuantTourStep = useGameStore((s) => s.nextQuantTourStep);
  const prevQuantTourStep = useGameStore((s) => s.prevQuantTourStep);
  const endQuantTour = useGameStore((s) => s.endQuantTour);
  return (
    <SpotlightTour
      steps={QUANT_STEPS} total={Object.keys(QUANT_STEPS).length} step={step}
      onNext={nextQuantTourStep} onPrev={prevQuantTourStep} onEnd={endQuantTour}
      tag="QUANT" endLabel="확인 ▶"
    />
  );
}
