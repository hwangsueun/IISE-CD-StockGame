// 첫날 튜토리얼 오버레이: 실제 메인 화면 위에서 단계별로 안내한다.
// 상태는 gameStore.tutorialStep. 튜토리얼 중엔 '다음 날' 버튼이 잠긴다(MainPage).
// 화면을 어둡게 하고 짚을 요소만 흰 빛으로 비추며, 설명은 그 요소 옆에 바로 붙인다.
import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../state/gameStore';
import { won } from '../utils/format';

const TOTAL_STEPS = 9;
const SPOT_PAD = 6;
const NOTE_GAP = 16;

// 단계 정의
//  title: 가운데 큰 제목 (없으면 생략)
//  spots: 비출 실제 화면 요소 [{ sel, place: 'below' | 'below-right' | 'above-right' | 'left' | 'right', note(st) }]
//         note는 그 요소 옆에 붙는 설명 (st = 현재 게임 상태)
//  interact: 직접 눌러 봐야 하는 요소. 이 요소만 클릭되고 '다음' 버튼은 숨긴다
//  hint: 하단에 띄우는 한 줄 안내
//  view(ctx): 모달·거래 상태에 따라 화면이 바뀌는 단계는 위 필드를 함수로 돌려준다
//  onModal(activeModal, mem, ctx): 모달 열고 닫기로 진행하는 단계. 'next'를 돌려주면 다음 단계로
//  ctx = { activeModal, marketOpen, bought, sold, flags } — bought/sold는 이 단계에서 체결한 거래가 있는지
//  watch: { 이름: 선택자 } — 화면에 그 요소가 있는지 ctx.flags.이름 으로 알려준다
const STEPS = {
  1: {
    title: '목표: 빚 갚고 살아남기',
    spots: [
      {
        sel: '.px-debt',
        place: 'below',
        note: (st) => (
          <>
            <span className="big">{won(Number(st.debtInitial) || 0)}</span>
            이 막대를 끝까지 채우면<br />빚 청산!
          </>
        ),
      },
      {
        sel: '.hud-clock',
        place: 'below-right',
        note: () => (
          <>
            <span className="big">240일</span>
            <b>20일마다</b> 상환일이 돌아온다
          </>
        ),
      },
    ],
  },
  2: {
    title: '내 상태 확인하기',
    spots: [
      {
        sel: '.px-statusbar > :nth-child(1)',
        place: 'below',
        note: () => (
          <>
            <span className="big">♥ 신뢰도</span>
            제때 갚으면 오르고<br />못 갚으면 떨어진다<br />
            <span className="warn">0이 되면 게임 오버</span>
          </>
        ),
      },
      {
        sel: '.px-statusbar > :nth-child(2)',
        place: 'below',
        note: () => (
          <>
            <span className="big">⚡ 스트레스</span>
            높으면 뉴스 열람 수가<br />제한된다<br />
            <span className="warn">100이 되면 쓰러져 입원</span>
          </>
        ),
      },
      {
        sel: '.px-money',
        place: 'below',
        note: () => (
          <>
            <span className="big">₩ 총자산</span>
            현금 + 투자한 자산<br />이게 최종 성적!
          </>
        ),
      },
    ],
  },
  3: {
    view: ({ activeModal }) => (activeModal === 'news'
      ? {
        // 뉴스 창이 열린 상태: 창 전체를 비추고 닫기 버튼을 짚는다
        spots: [
          { sel: '.modal-shell' },
          { sel: '.modal-close', place: 'right', note: () => <>다 봤으면 <b>✕</b>로 닫기</> },
        ],
        interact: '.modal-shell',
        hint: <>뉴스를 읽고 <b>오를 종목·내릴 종목</b>을 골라 보자!</>,
      }
      : {
        title: '뉴스 보기',
        spots: [{
          sel: '.pbtn.b-news',
          place: 'right',
          note: () => (
            <>
              <span className="big">📰 뉴스</span>
              오늘 시장 소식이 여기 있다<br />
              <b>눌러서 열어 보자!</b>
            </>
          ),
        }],
        interact: '.pbtn.b-news',
      }),
    onModal: (activeModal, mem) => {
      if (activeModal === 'news') mem.opened = true;
      else if (mem.opened && !activeModal) return 'next';
      return undefined;
    },
  },
  4: {
    // 마켓 → 종목 → 매수 → 수량 1 → 매수 확정 → 확인. 창이 바뀔 때마다 비추는 곳이 따라간다.
    view: ({ activeModal, bought, marketOpen }) => {
      if (marketOpen === false) {
        return {
          title: '마켓에서 사 보기',
          spots: [{ sel: '.pbtn.b-market', place: 'left', note: () => <>오늘은 <b>휴장일</b><br />거래는 다음 날부터!</> }],
        };
      }
      if (activeModal === 'market') {
        return {
          spots: [{ sel: '.modal-shell' }],
          interact: '.modal-shell',
          hint: <>사고 싶은 <b>종목을 하나</b> 눌러 보자</>,
        };
      }
      if (activeModal === 'asset') {
        return {
          spots: [{ sel: '.modal-shell' }, { sel: '.btn-buy' }],
          interact: '.modal-shell',
          hint: <>차트를 살펴보고 <b>[매수]</b>를 눌러 보자</>,
        };
      }
      if (activeModal === 'trade' && bought) {
        return {
          spots: [{ sel: '.modal-shell' }, { sel: '.modal .btn-primary' }],
          interact: '.modal-shell',
          hint: <>샀다! <b>[확인]</b>을 눌러 닫자</>,
        };
      }
      if (activeModal === 'trade') {
        return {
          spots: [{ sel: '.modal-shell' }, { sel: '.modal .field' }, { sel: '.modal .btn-primary' }],
          interact: '.modal-shell',
          hint: <>수량에 <b>1</b>을 넣고 <b>[매수 확정]</b>을 눌러 보자</>,
        };
      }
      return {
        title: '마켓에서 사 보기',
        spots: [{
          sel: '.pbtn.b-market',
          place: 'left',
          note: () => (
            <>
              <span className="big">📈 마켓</span>
              주식·채권·코인을 사고판다<br />
              <b>눌러서 열어 보자!</b>
            </>
          ),
        }],
        interact: '.pbtn.b-market',
      };
    },
    onModal: (activeModal, mem, { bought, marketOpen }) => {
      if (marketOpen === false) return undefined;   // 휴장일엔 '다음' 버튼으로 넘어간다
      if (bought && !activeModal) return 'next';
      return undefined;
    },
  },
  5: {
    // 포트폴리오 → [보유자산] 탭 → 방금 산 종목 확인 → ✕로 닫기
    watch: { holdings: '.modal .data-table thead th:nth-child(6)' },
    view: ({ activeModal, flags }) => {
      if (activeModal === 'portfolio' && flags.holdings) {
        return {
          spots: [
            { sel: '.modal-shell' },
            { sel: '.modal .data-table' },
            { sel: '.modal-close', place: 'right', note: () => <>다 봤으면 <b>✕</b>로 닫기</> },
          ],
          interact: '.modal-shell',
          hint: <>방금 산 종목이 여기 있다! <b>수익률</b>도 한눈에 볼 수 있다</>,
        };
      }
      if (activeModal === 'portfolio') {
        return {
          spots: [{ sel: '.modal-shell' }, { sel: '.modal .filter-bar button:nth-child(2)' }],
          interact: '.modal-shell',
          hint: <><b>[보유자산]</b>을 눌러 방금 산 종목을 찾아보자</>,
        };
      }
      return {
        title: '내 자산 확인하기',
        spots: [{
          sel: '.pbtn.b-portfolio',
          place: 'right',
          note: () => (
            <>
              <span className="big">📊 포트폴리오</span>
              내가 가진 자산과 수익률<br />
              <b>눌러서 열어 보자!</b>
            </>
          ),
        }],
        interact: '.pbtn.b-portfolio',
      };
    },
    onModal: (activeModal, mem, { flags }) => {
      if (activeModal === 'portfolio' && flags.holdings) mem.seen = true;
      else if (mem.seen && !activeModal) return 'next';
      return undefined;
    },
  },
  6: {
    // 포트폴리오 → [보유자산] → 산 종목 → [매도] → 수량 1 → 매도 확정 → 확인
    // 수수료가 0원이라 같은 날 사고팔면 손익이 정확히 0이다.
    watch: { holdings: '.modal .data-table thead th:nth-child(6)' },
    view: ({ activeModal, sold, marketOpen, flags }) => {
      if (marketOpen === false) {
        return {
          title: '팔아 보기',
          spots: [{ sel: '.pbtn.b-portfolio', place: 'right', note: () => <>오늘은 <b>휴장일</b><br />매도는 다음 날부터!</> }],
        };
      }
      if (activeModal === 'trade' && sold) {
        return {
          spots: [{ sel: '.modal-shell' }, { sel: '.modal .btn-primary' }],
          interact: '.modal-shell',
          hint: <>팔았다! 같은 날 사고팔면 <b>손익 0원</b> · <b>[확인]</b>을 눌러 닫자</>,
        };
      }
      if (activeModal === 'trade') {
        return {
          spots: [{ sel: '.modal-shell' }, { sel: '.modal .field' }, { sel: '.modal .btn-primary' }],
          interact: '.modal-shell',
          hint: <>수량에 <b>1</b>을 넣고 <b>[매도 확정]</b>을 눌러 보자</>,
        };
      }
      if (activeModal === 'asset') {
        return {
          spots: [{ sel: '.modal-shell' }, { sel: '.btn-sell' }],
          interact: '.modal-shell',
          hint: <>이번엔 <b>[매도]</b>를 눌러 보자</>,
        };
      }
      if (activeModal === 'portfolio' && flags.holdings) {
        return {
          spots: [{ sel: '.modal-shell' }, { sel: '.modal .data-table tbody tr' }],
          interact: '.modal-shell',
          hint: <>방금 산 <b>종목을 눌러</b> 보자</>,
        };
      }
      if (activeModal === 'portfolio') {
        return {
          spots: [{ sel: '.modal-shell' }, { sel: '.modal .filter-bar button:nth-child(2)' }],
          interact: '.modal-shell',
          hint: <><b>[보유자산]</b>을 눌러 보자</>,
        };
      }
      return {
        title: '팔아 보기',
        spots: [{
          sel: '.pbtn.b-portfolio',
          place: 'right',
          note: () => (
            <>
              <span className="big">💰 팔아 보기</span>
              산 종목은 포트폴리오에서<br />바로 팔 수 있다<br />
              <b>눌러서 열어 보자!</b>
            </>
          ),
        }],
        interact: '.pbtn.b-portfolio',
      };
    },
    onModal: (activeModal, mem, { sold, marketOpen }) => {
      if (marketOpen === false) return undefined;   // 휴장일엔 '다음' 버튼으로 넘어간다
      if (sold && !activeModal) return 'next';
      return undefined;
    },
  },
  7: {
    // 캘린더: 지난 날 본 뉴스 다시 보기 + 오늘 투자 메모. 열어 보고 닫으면 다음 단계
    view: ({ activeModal }) => (activeModal === 'calendar'
      ? {
        spots: [
          { sel: '.modal-shell' },
          { sel: '.modal-close', place: 'right', note: () => <>다 봤으면 <b>✕</b>로 닫기</> },
        ],
        interact: '.modal-shell',
        hint: <>날짜를 누르면 <b>그날 본 뉴스</b>가 다시 나온다 · 오늘은 <b>투자 메모</b>도 남길 수 있다</>,
      }
      : {
        title: '캘린더',
        spots: [{
          sel: '.pbtn.b-calendar',
          place: 'right',
          note: () => (
            <>
              <span className="big">📅 캘린더</span>
              지난 뉴스를 다시 보고<br />메모를 남기는 곳<br />
              <b>눌러서 열어 보자!</b>
            </>
          ),
        }],
        interact: '.pbtn.b-calendar',
      }),
    onModal: (activeModal, mem) => {
      if (activeModal === 'calendar') mem.opened = true;
      else if (mem.opened && !activeModal) return 'next';
      return undefined;
    },
  },
  8: {
    // 부업: 목록만 보여주고, 게임방법은 실제 부업할 때 해 보도록 안내. 열어 보고 닫으면 다음 단계
    // (튜토리얼 중엔 SideJobModal이 게임방법만 되는 모드라 실수로 플레이해도 기록되지 않는다)
    view: ({ activeModal }) => (activeModal === 'sidejob'
      ? {
        spots: [
          { sel: '.modal-shell' },
          { sel: '.modal-close', place: 'right', note: () => <>다 봤으면 <b>✕</b>로 닫기</> },
        ],
        interact: '.modal-shell',
        hint: <>미니게임 3종 중 하나를 골라 부업한다 · 하는 법은 <b>실제 부업할 때 [게임방법]</b>에서 해 보자</>,
      }
      : {
        title: '부업',
        spots: [{
          sel: '.pbtn.b-game',
          place: 'left',
          note: () => (
            <>
              <span className="big">🎮 부업</span>
              미니게임으로 현금을 번다<br />
              <span className="warn">부업한 날은 투자 불가!</span><br />
              <b>눌러서 열어 보자!</b>
            </>
          ),
        }],
        interact: '.pbtn.b-game',
      }),
    onModal: (activeModal, mem) => {
      if (activeModal === 'sidejob') mem.opened = true;
      else if (mem.opened && !activeModal) return 'next';
      return undefined;
    },
  },
  9: {
    // 마무리: 다음 날 버튼과 도움말(?) 위치를 알려 주고 튜토리얼 종료 → '다음 날' 잠금 해제
    title: '이제 진짜 시작!',
    spots: [
      {
        sel: '.nextturn-btn',
        place: 'above-right',
        note: () => (
          <>
            <span className="big">▶ 다음 날</span>
            오늘 할 일을 마쳤으면 누르자<br />
            시세·뉴스·이벤트가 바뀐다
          </>
        ),
      },
      {
        sel: '.px-guide-btn',
        place: 'below-right',
        note: () => <>헷갈리면 언제든 <b>?</b> 도움말</>,
      },
    ],
  },
};

/** 비출 요소들의 화면 좌표를 추적. 모달이 열리고 닫히는 등 레이아웃이 바뀌므로 주기적으로 다시 잰다. */
function useRects(sels, deps) {
  const [rects, setRects] = useState([]);
  useEffect(() => {
    let last = '';
    const measure = () => {
      const next = sels.map((sel) => {
        const el = sel && document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) return null;
        return { x: r.left - SPOT_PAD, y: r.top - SPOT_PAD, w: r.width + SPOT_PAD * 2, h: r.height + SPOT_PAD * 2 };
      });
      const key = JSON.stringify(next);
      if (key !== last) { last = key; setRects(next); }
    };
    measure();
    const id = setInterval(measure, 200);
    return () => clearInterval(id);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return rects;
}

/** 단계의 watch({ 이름: 선택자 })가 지금 화면에 있는지 주기적으로 확인 (예: 보유자산 탭이 열렸는지) */
function useDomFlags(watch) {
  const [flags, setFlags] = useState({});
  useEffect(() => {
    if (!watch) { setFlags({}); return undefined; }
    let last = '';
    const check = () => {
      const next = Object.fromEntries(Object.entries(watch).map(([k, sel]) => [k, !!document.querySelector(sel)]));
      const key = JSON.stringify(next);
      if (key !== last) { last = key; setFlags(next); }
    };
    check();
    const id = setInterval(check, 200);
    return () => clearInterval(id);
  }, [watch]);
  return flags;
}

/** 설명 위치: 비춘 요소의 아래(가운데/오른쪽 정렬), 위(오른쪽 정렬), 왼쪽, 오른쪽 */
function notePos(r, place) {
  if (place === 'left') return { left: r.x - NOTE_GAP, top: r.y + r.h / 2 };
  if (place === 'right') return { left: r.x + r.w + NOTE_GAP, top: r.y + r.h / 2 };
  if (place === 'below-right') return { left: r.x + r.w, top: r.y + r.h + NOTE_GAP };
  if (place === 'above-right') return { left: r.x + r.w, top: r.y - NOTE_GAP };
  return { left: r.x + r.w / 2, top: r.y + r.h + NOTE_GAP };
}

/** 직접 눌러 봐야 하는 단계: 그 요소(구멍)만 클릭되고 나머지는 막는다 */
function Blockers({ hole }) {
  if (!hole) return <div className="tut-block" style={{ inset: 0 }} />;
  const { x, y, w, h } = hole;
  return (
    <>
      <div className="tut-block" style={{ left: 0, top: 0, right: 0, height: Math.max(0, y) }} />
      <div className="tut-block" style={{ left: 0, top: y + h, right: 0, bottom: 0 }} />
      <div className="tut-block" style={{ left: 0, top: y, width: Math.max(0, x), height: h }} />
      <div className="tut-block" style={{ left: x + w, top: y, right: 0, height: h }} />
    </>
  );
}

export default function TutorialOverlay() {
  const step = useGameStore((s) => s.tutorialStep);
  const sessionState = useGameStore((s) => s.state);
  const turnState = useGameStore((s) => s.turn?.state);
  const activeModal = useGameStore((s) => s.activeModal);
  const lastTrade = useGameStore((s) => s.lastTrade);
  const marketOpen = useGameStore((s) => s.turn?.marketOpen);
  const nextTutorialStep = useGameStore((s) => s.nextTutorialStep);
  const prevTutorialStep = useGameStore((s) => s.prevTutorialStep);
  const endTutorial = useGameStore((s) => s.endTutorial);

  // 이 단계에 들어온 뒤 체결된 거래만 센다
  const stepStartRef = useRef({ step: null, at: 0 });
  if (stepStartRef.current.step !== step) stepStartRef.current = { step, at: Date.now() };
  const tradedHere = lastTrade && lastTrade.at >= stepStartRef.current.at ? lastTrade : null;
  const raw = STEPS[step];
  const flags = useDomFlags(raw?.watch);
  const ctx = {
    activeModal,
    marketOpen,
    bought: tradedHere?.tradeType === 'buy',
    sold: tradedHere?.tradeType === 'sell',
    flags,
  };
  const flagKey = JSON.stringify(flags);

  const view = raw ? (raw.view ? raw.view(ctx) : raw) : null;
  const spots = view?.spots || [];
  const sels = [...spots.map((s) => s.sel), view?.interact];
  const rects = useRects(sels, [step, activeModal, ctx.bought, ctx.sold, flagKey]);
  const spotRects = rects.slice(0, spots.length);
  const holeRect = view?.interact ? rects[spots.length] : null;

  // 다음 단계가 아직 정의되지 않았으면(단계별 제작 중) 여기서 튜토리얼을 마친다
  const isLast = step >= TOTAL_STEPS;
  const goNext = isLast || !STEPS[step + 1] ? endTutorial : nextTutorialStep;

  // 모달 열고 닫기로 진행하는 단계 (예: 뉴스를 열었다 닫으면 다음 단계)
  const memRef = useRef({});
  useEffect(() => { memRef.current = {}; }, [step]);
  useEffect(() => {
    if (raw?.onModal?.(activeModal, memRef.current, ctx) === 'next') goNext();
  }, [step, activeModal, ctx.bought, ctx.sold, flagKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!view) return null;
  const st = { ...(sessionState || {}), ...(turnState || {}) };

  return (
    <div className="tut-root">
      {/* 어두운 막 + 비출 요소만 구멍 */}
      <svg className="tut-mask" width="100%" height="100%" aria-hidden="true">
        <defs>
          <mask id="tut-holes">
            <rect width="100%" height="100%" fill="#fff" />
            {spotRects.map((r, i) => r && <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx="6" fill="#000" />)}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.72)" mask="url(#tut-holes)" />
      </svg>
      <Blockers hole={view.interact ? holeRect : null} />

      {spotRects.map((r, i) => r && (
        <div key={`s${i}`} className="tut-spot" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />
      ))}
      {spotRects.map((r, i) => r && spots[i].note && (
        <div key={`n${i}`} className={`tut-note ${spots[i].place}`} style={notePos(r, spots[i].place)}>
          {spots[i].note(st)}
        </div>
      ))}

      {view.title && (
        <div className="tut-headline">
          <div className="tag">TUTORIAL {step} / {TOTAL_STEPS}</div>
          <h3>{view.title}</h3>
        </div>
      )}

      <div className="tut-controls">
        {view.hint && <p className="tut-hint">{view.hint}</p>}
        <div className="tut-controls-row">
          {step > 1 && (
            <button type="button" className="tut-prev" onClick={prevTutorialStep}>◀ 이전</button>
          )}
          <button type="button" className="tut-skip" onClick={endTutorial}>튜토리얼 건너뛰기</button>
          {!view.interact && (
            <button type="button" className="tut-next" onClick={goNext}>
              {isLast ? '시작하기 ▶' : '다음 ▶'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
