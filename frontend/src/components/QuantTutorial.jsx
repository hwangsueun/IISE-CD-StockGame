// 11일차부터 컴퓨터와 alpha158의 네 가지 화면을 한 번 소개한다.
import { useEffect } from 'react';
import { useGameStore } from '../state/gameStore';
import { SpotlightTour } from './FirstDayTutorial';

const QUANT_STEPS = {
  1: {
    watch: { tabs: '#quant-tab-challenge', invitation: '.challenge-invitation' },
    view: ({ activeModal, flags }) => (activeModal === 'quant'
      ? {
        spots: [{ sel: '.modal-shell' }],
        interact: '.modal-shell',
        hint: flags.invitation
          ? <>초대장을 읽거나 <b>[alpha158 먼저 살펴보기]</b>를 눌러 보자 · 참가는 나중에 정해도 된다</>
          : <>alpha158 화면을 불러오는 중… 문제가 있으면 다시 불러오거나 창을 닫을 수 있다</>,
      }
      : {
        title: 'alpha158의 투자도 살펴보자',
        spots: [{
          sel: '.pbtn.b-computer',
          place: 'left',
          note: () => (
            <>
              <span className="big">💻 alpha158 투자 챌린지</span>
              alpha158도 나와 같은 초기 투자금으로<br />
              주식을 운용하고 있다<br />
              <b>컴퓨터를 눌러 확인하자!</b>
            </>
          ),
        }],
        interact: '.pbtn.b-computer',
      }),
    onModal: (activeModal, mem, { flags }) => {
      if (activeModal === 'quant') mem.opened = true;
      // The first visit may show the invitation, or an API error, before any tabs exist.
      if (activeModal === 'quant' && flags.tabs) return 'next';
      if (mem.opened && !activeModal) return 'next';
      return undefined;
    },
  },
  2: {
    spots: [{
      sel: ['#quant-tab-challenge', '#quant-tab-workshop'],
      place: 'below',
      boxed: true,
      note: () => (
        <>
          <span className="big">📊 경쟁하고 직접 만들기</span>
          <b>투자 챌린지</b> · 20턴마다 투자수익률을 비교한다<br />
          alpha158보다 앞서면 상금을 받을 수 있다<br />
          <b>나만의 투자 모델 만들기</b> · 모델을 만들고 결과를 비교한다<br />
          자동 투자는 원할 때 켜거나 끌 수 있다
        </>
      ),
    }],
    hint: <>챌린지는 월급·부업비·상환금 같은 <b>투자 외 입출금을 제외</b>하고 비교한다</>,
  },
  3: {
    spots: [{
      sel: '#quant-tab-portfolio',
      place: 'below',
      boxed: true,
      note: () => (
        <>
          <span className="big">🗂 alpha158의 포트폴리오</span>
          <b>보유 종목</b> · 지금 들고 있는 주식과 비중<br />
          <b>종목 선택</b> · 오늘 평가한 종목의 점수<br />
          <b>예약 주문</b> · 다음 개장일에 처리할 주문<br />
          <b>운용 기록</b> · 날짜별 자산과 수익률
        </>
      ),
    }],
    hint: <>종목의 <b>[지표 분석]</b>에서 어떤 지표가 점수에 영향을 줬는지도 볼 수 있다</>,
  },
  4: {
    spots: [{
      sel: '#quant-tab-about',
      place: 'below',
      boxed: true,
      note: () => (
        <>
          <span className="big">What is Alpha158?</span>
          alpha158이 참고하는 지표와<br />
          주식을 사고파는 규칙을 알아보는 곳이다
        </>
      ),
    }],
    hint: <>궁금한 지표의 뜻과 계산 예시를 여기서 찾아볼 수 있다</>,
  },
  5: {
    spots: [{ sel: '.modal-close', place: 'left', note: () => <>다 봤으면 <b>✕</b>로 닫기</> }],
    interact: '.modal-close',
    hint: <>방 안의 <b>컴퓨터</b>를 누르면 언제든 다시 볼 수 있다</>,
    onModal: (activeModal) => (activeModal ? undefined : 'next'),
  },
};

export default function QuantTutorial() {
  const step = useGameStore((s) => s.quantTourStep);
  const activeModal = useGameStore((s) => s.activeModal);
  const nextQuantTourStep = useGameStore((s) => s.nextQuantTourStep);
  const prevQuantTourStep = useGameStore((s) => s.prevQuantTourStep);
  const endQuantTour = useGameStore((s) => s.endQuantTour);

  // Closing the invitation with '나중에' must also release the turn button.
  useEffect(() => {
    if (step > 1 && activeModal !== 'quant') endQuantTour();
  }, [step, activeModal, endQuantTour]);

  if (step > 1 && activeModal !== 'quant') return null;
  return (
    <SpotlightTour
      steps={QUANT_STEPS} total={Object.keys(QUANT_STEPS).length} step={step}
      onNext={nextQuantTourStep} onPrev={prevQuantTourStep} onEnd={endQuantTour}
      tag="ALPHA158" endLabel="확인 ▶"
    />
  );
}
