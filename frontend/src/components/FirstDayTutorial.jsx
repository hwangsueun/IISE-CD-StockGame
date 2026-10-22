// 첫날 체험형 튜토리얼: 실제 메인 화면 위에서 단계별로 안내한다.
// 상태는 gameStore.firstDayStep. 튜토리얼 중엔 '다음 날' 버튼이 잠기고, NEXT_DAY_STEP에서만 직접 눌러 2일차로 넘어간다(MainPage).
// 화면을 어둡게 하고 짚을 요소만 흰 빛으로 비추며, 설명은 그 요소 옆에 바로 붙인다.
import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../state/gameStore';
import { won } from '../utils/format';

const TOTAL_STEPS = 10;
const SPOT_PAD = 6;
const NOTE_GAP = 16;
// 튜토리얼 중 '다음 날' 버튼을 직접 눌러 보는 단계 (MainPage가 이 단계에서만 버튼 잠금을 푼다)
export const NEXT_DAY_STEP = 6;
// 6단계 시작 시점의 턴. 턴이 넘어가는 동안 튜토리얼이 잠시 사라졌다(언마운트) 다시 뜨므로 모듈에 둔다.
let nextDayBaseTurn = null;

// 매수 전에 열어 보게 할 종목 상세 탭 (AssetDetailModal의 data-tutorial="asset-tab-*")
const RESEARCH_TABS = [
  {
    key: 'news', label: '뉴스',
    note: () => <><span className="big">📰 종목 뉴스</span>이 종목의 호재·악재 기사<br /><b>눌러서 확인!</b></>,
  },
  {
    key: 'community', label: '종토방',
    note: () => <><span className="big">💬 종토방</span>다른 개미들의 분위기<br /><span className="warn">믿을지는 내 판단!</span></>,
  },
  {
    key: 'info', label: '정보',
    note: () => <><span className="big">📋 정보</span>재무제표·PER 같은<br />회사의 기초 체력</>,
  },
];

// 단계 정의
//  title: 가운데 큰 제목 (없으면 생략)
//  spots: 비출 실제 화면 요소 [{ sel, place: 'below' | 'below-right' | 'above-right' | 'left' | 'right', note(st), noteFrom }]
//         note는 그 요소 옆에 붙는 설명 (st = 현재 게임 상태). noteFrom이 있으면 설명을 그 요소 기준으로 붙인다
//  interact: 직접 눌러 봐야 하는 요소. 이 요소만 클릭되고 '다음' 버튼은 숨긴다
//  hint: 하단에 띄우는 한 줄 안내
//  view(ctx): 모달·거래 상태에 따라 화면이 바뀌는 단계는 위 필드를 함수로 돌려준다
//  onModal(activeModal, mem, ctx): 모달 열고 닫기로 진행하는 단계. 'next'를 돌려주면 다음 단계로
//  ctx = { activeModal, marketOpen, bought, flags } — bought는 이 단계에서 매수 주문을 예약했는지
//  watch: { 이름: 선택자 } — 화면에 그 요소가 있는지 ctx.flags.이름 으로 알려준다
export const STEPS = {
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
        sel: '[data-tutorial="stat-trust"]',
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
        sel: '[data-tutorial="stat-stress"]',
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
        // 총자산 바로 아래에 시장 대비 수익률 배지가 있어 설명은 배지 밑에 붙인다.
        noteFrom: '.market-performance-badge',
        place: 'below',
        note: () => (
          <>
            <span className="big">₩ 총자산</span>
            현금 + 투자한 자산<br />이게 최종 성적!
          </>
        ),
      },
      {
        sel: '.market-performance-badge',
        place: 'right',
        note: () => (
          <>
            <span className="big">↗ 내 투자 성적</span>
            코스피와 비교한 내 수익률<br />
            <span className="dim">누르면 포트폴리오에서 자세히</span>
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
    // 마켓 → 주식 종목 → [뉴스·종토방·정보] 살펴보기 → 매수 예약 → 수량 1 → 매수 예약 → 확인.
    // 창이 바뀔 때마다 비추는 곳이 따라간다. 종목 정보 탭은 한 번씩 열어 본 것(seen)을 기억해 다음 탭으로 안내한다.
    watch: {
      news: '[data-tutorial="asset-tab-news"].active',
      community: '[data-tutorial="asset-tab-community"].active',
      info: '[data-tutorial="asset-tab-info"].active',
    },
    view: ({ activeModal, bought, marketOpen, seen }) => {
      if (marketOpen === false) {
        return {
          title: '마켓에서 매수 예약하기',
          spots: [{ sel: '.pbtn.b-market', place: 'left', note: () => <>오늘은 <b>휴장일</b><br />거래는 다음 날부터!</> }],
        };
      }
      if (activeModal === 'market') {
        return {
          spots: [{ sel: '.modal-shell' }],
          interact: '.modal-shell',
          hint: <>주식 탭에서 사고 싶은 <b>종목을 하나</b> 눌러 보자</>,
        };
      }
      if (activeModal === 'asset') {
        const next = RESEARCH_TABS.find((t) => !seen[t.key]);
        if (next) {
          const done = RESEARCH_TABS.length - RESEARCH_TABS.filter((t) => !seen[t.key]).length;
          return {
            spots: [
              { sel: '.modal-shell' },
              { sel: `[data-tutorial="asset-tab-${next.key}"]`, place: 'modal-side', note: next.note },
            ],
            interact: '.modal-shell',
            hint: <>사기 전에 이 종목을 살펴보자 · <b>[{next.label}]</b> 탭을 눌러 보자 ({done}/{RESEARCH_TABS.length})</>,
          };
        }
        return {
          spots: [{ sel: '.modal-shell' }, { sel: '.btn-buy' }],
          interact: '.modal-shell',
          hint: <>다 살펴봤다! 마음에 들면 <b>[매수 예약]</b> · 아니면 ✕로 닫고 다른 종목을 골라 보자</>,
        };
      }
      if (activeModal === 'trade' && bought) {
        return {
          spots: [{ sel: '.modal-shell' }, { sel: '.modal .btn-primary' }],
          interact: '.modal-shell',
          hint: <>예약했다! 다음 개장일 시가에 체결된다 · <b>[확인]</b>을 눌러 닫자</>,
        };
      }
      if (activeModal === 'trade') {
        return {
          spots: [{ sel: '.modal-shell' }, { sel: '.modal .field' }, { sel: '.modal .btn-primary' }],
          interact: '.modal-shell',
          hint: <>수량에 <b>1</b>을 넣고 <b>[매수 예약]</b>을 눌러 보자</>,
        };
      }
      return {
        title: '마켓에서 매수 예약하기',
        spots: [{
          sel: '.pbtn.b-market',
          place: 'left',
          note: () => (
            <>
              <span className="big">📈 마켓</span>
              주식 주문을 예약하는 곳<br />
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
    // 예약 직후에는 보유자산 대신 주문 내역을 확인한다.
    watch: { orders: '[data-tutorial="order-history"]' },
    view: ({ activeModal, flags }) => {
      if (activeModal === 'portfolio' && flags.orders) {
        return {
          spots: [
            { sel: '.modal-shell' },
            { sel: '[data-tutorial="order-history"]' },
            { sel: '.modal-close', place: 'right', note: () => <>다 봤으면 <b>✕</b>로 닫기</> },
          ],
          interact: '.modal-shell',
          hint: <>예약한 주문을 여기서 확인한다 · 체결 전에는 <b>취소</b>할 수 있다</>,
        };
      }
      if (activeModal === 'portfolio') {
        return {
          spots: [{ sel: '.modal-shell' }, { sel: '[data-tutorial="orders-tab"]' }],
          interact: '.modal-shell',
          hint: <><b>[주문 내역]</b>을 눌러 예약 상태를 확인하자</>,
        };
      }
      return {
        title: '예약 주문 확인하기',
        spots: [{
          sel: '.pbtn.b-portfolio',
          place: 'right',
          note: () => (
            <>
              <span className="big">📊 포트폴리오</span>
              주문 내역과 보유자산을 확인한다<br />
              <b>눌러서 열어 보자!</b>
            </>
          ),
        }],
        interact: '.pbtn.b-portfolio',
      };
    },
    onModal: (activeModal, mem, { flags }) => {
      if (activeModal === 'portfolio' && flags.orders) mem.seen = true;
      else if (mem.seen && !activeModal) return 'next';
      return undefined;
    },
  },
  6: {
    // 튜토리얼 안에서 '다음 날'을 직접 눌러 1일차 매수 예약이 2일차 시가에 체결되게 한다.
    // 턴이 넘어가면(ctx.turnNumber가 이 단계 시작 턴보다 커지면) 다음 단계로.
    title: '다음 날로 넘어가기',
    spots: [{
      sel: '.nextturn-btn',
      place: 'above-right',
      note: () => (
        <>
          <span className="big">▶ 다음 날</span>
          하루가 지나면 예약한 매수가<br />
          <b>개장 시가</b>에 체결된다<br />
          <b>눌러 보자!</b>
        </>
      ),
    }],
    interact: '.nextturn-btn',
    hint: <>실제 체결가는 주문할 때 본 가격과 다를 수 있다 · 이벤트가 뜨면 먼저 처리하자</>,
    onModal: (activeModal, mem, { turnNumber }) => (
      nextDayBaseTurn !== null && turnNumber > nextDayBaseTurn ? 'next' : undefined
    ),
  },
  7: {
    // 2일차: 포트폴리오 → 보유자산 → 체결된 종목 → 매도 예약 → 수량 1 → 매도 예약 → 확인.
    // 휴장일이었거나 주문을 취소해 보유 종목이 없으면, 매도 위치만 알려 주고 창을 닫으면 넘어간다.
    watch: {
      holdingsTab: '[data-tutorial="holdings-tab"].active',
      holding: '[data-tutorial="holding-row"]',
    },
    view: ({ activeModal, sold, flags }) => {
      if (activeModal === 'trade' && sold) {
        return {
          spots: [{ sel: '.modal-shell' }, { sel: '.modal .btn-primary' }],
          interact: '.modal-shell',
          hint: <>매도 예약 완료! 매도도 <b>다음 개장일 시가</b>에 체결된다 · <b>[확인]</b>을 눌러 닫자</>,
        };
      }
      if (activeModal === 'trade') {
        return {
          spots: [{ sel: '.modal-shell' }, { sel: '.modal .field' }, { sel: '.modal .btn-primary' }],
          interact: '.modal-shell',
          hint: <><b>매도</b>가 선택됐는지 보고 수량 <b>1</b> → <b>[매도 예약]</b>을 눌러 보자</>,
        };
      }
      if (activeModal === 'asset') {
        return {
          spots: [{ sel: '.modal-shell' }, { sel: '.btn-sell' }],
          interact: '.modal-shell',
          hint: <>가진 종목은 <b>[매도 예약]</b>으로 판다 · 눌러 보자</>,
        };
      }
      if (activeModal === 'portfolio' && flags.holdingsTab && flags.holding) {
        return {
          spots: [
            { sel: '.modal-shell' },
            { sel: '[data-tutorial="holding-row"]', place: 'modal-side', note: () => <>어제 예약한 매수가 <b>체결됐다!</b><br />종목을 눌러 보자</> },
          ],
          interact: '.modal-shell',
          hint: <>체결된 종목은 <b>보유자산</b>에 들어온다 · 수익률도 여기서 본다</>,
        };
      }
      if (activeModal === 'portfolio' && flags.holdingsTab) {
        return {
          spots: [
            { sel: '.modal-shell' },
            { sel: '.modal-close', place: 'right', note: () => <>확인했으면 <b>✕</b>로 닫기</> },
          ],
          interact: '.modal-shell',
          hint: <>아직 체결된 종목이 없다 (휴장일이었거나 주문을 취소했다) · 보유 종목이 생기면 여기서 <b>종목 → [매도 예약]</b></>,
        };
      }
      if (activeModal === 'portfolio') {
        return {
          spots: [{ sel: '.modal-shell' }, { sel: '[data-tutorial="holdings-tab"]' }],
          interact: '.modal-shell',
          hint: <><b>[보유자산]</b>을 눌러 체결됐는지 확인하자</>,
        };
      }
      return {
        title: '체결 확인하고 매도하기',
        spots: [{
          sel: '.pbtn.b-portfolio',
          place: 'right',
          note: () => (
            <>
              <span className="big">📊 포트폴리오</span>
              어제 예약한 매수가<br />오늘 시가에 체결됐다<br />
              <b>눌러서 확인하자!</b>
            </>
          ),
        }],
        interact: '.pbtn.b-portfolio',
      };
    },
    onModal: (activeModal, mem, { sold, flags }) => {
      if (sold && !activeModal) return 'next';
      if (activeModal === 'portfolio' && flags.holdingsTab && !flags.holding) mem.noHolding = true;
      else if (mem.noHolding && !activeModal) return 'next';
      return undefined;
    },
  },
  8: {
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
  9: {
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
  10: {
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
            예약 주문을 처리하고<br />시세·뉴스·이벤트가 바뀐다
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
      // sel이 배열이면 그 요소들을 모두 감싸는 하나의 상자로 비춘다 (예: 탭 여러 개를 한 묶음으로)
      const next = sels.map((sel) => {
        const els = (Array.isArray(sel) ? sel : [sel])
          .map((s) => s && document.querySelector(s))
          .map((el) => el?.getBoundingClientRect())
          .filter((r) => r && (r.width || r.height));
        if (!els.length) return null;
        const left = Math.min(...els.map((r) => r.left));
        const top = Math.min(...els.map((r) => r.top));
        const right = Math.max(...els.map((r) => r.right));
        const bottom = Math.max(...els.map((r) => r.bottom));
        return { x: left - SPOT_PAD, y: top - SPOT_PAD, w: right - left + SPOT_PAD * 2, h: bottom - top + SPOT_PAD * 2 };
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

/** watch 플래그 중 이 단계에서 한 번이라도 켜졌던 것 (예: 종목 상세에서 열어 본 탭들). 단계가 바뀌면 초기화 */
function useSeenFlags(flags, step) {
  const [seen, setSeen] = useState({});
  useEffect(() => { setSeen({}); }, [step]);
  useEffect(() => {
    const on = Object.keys(flags).filter((k) => flags[k]);
    if (on.some((k) => !seen[k])) setSeen((s) => ({ ...s, ...Object.fromEntries(on.map((k) => [k, true])) }));
  }, [flags]); // eslint-disable-line react-hooks/exhaustive-deps
  return seen;
}

const NOTE_MIN_W = 140; // 창 옆 설명이 읽히려면 필요한 최소 폭
const EDGE_PAD = 8;

/**
 * 'modal-side': 창 안의 요소(탭·행)를 짚을 때 설명이 창 내용과 겹치지 않도록 창 바깥 옆에 붙인다.
 * 높이는 짚은 요소에 맞추고, 창 왼쪽·오른쪽 중 자리가 넓은 쪽으로 보낸다.
 * 양쪽 다 좁으면 설명을 생략한다(하단 안내 문구가 같은 내용을 말해 준다).
 * 반환: { place, maxWidth } | null
 */
function resolvePlace(place) {
  if (place !== 'modal-side') return { place };
  const shell = document.querySelector('.modal-shell')?.getBoundingClientRect();
  if (!shell) return { place: 'below' };
  const leftRoom = shell.left - NOTE_GAP - EDGE_PAD;
  const rightRoom = window.innerWidth - shell.right - NOTE_GAP - EDGE_PAD;
  if (Math.max(leftRoom, rightRoom) < NOTE_MIN_W) return null;
  return leftRoom >= rightRoom
    ? { place: 'modal-left', maxWidth: leftRoom }
    : { place: 'modal-right', maxWidth: rightRoom };
}

/** 설명 위치: 비춘 요소의 아래(가운데/오른쪽 정렬), 위(오른쪽 정렬), 왼쪽, 오른쪽, 창 바깥 왼쪽/오른쪽 */
function notePos(r, place) {
  if (place === 'modal-left' || place === 'modal-right') {
    const shell = document.querySelector('.modal-shell').getBoundingClientRect();
    return place === 'modal-left'
      ? { left: shell.left - NOTE_GAP, top: r.y + r.h / 2 }
      : { left: shell.right + NOTE_GAP, top: r.y + r.h / 2 };
  }
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

export default function FirstDayTutorial() {
  const step = useGameStore((s) => s.firstDayStep);
  const turnNumber = useGameStore((s) => s.turn?.turnNumber);
  const nextFirstDayStep = useGameStore((s) => s.nextFirstDayStep);
  const prevFirstDayStep = useGameStore((s) => s.prevFirstDayStep);
  const endFirstDay = useGameStore((s) => s.endFirstDay);

  if (step !== NEXT_DAY_STEP) nextDayBaseTurn = null;
  else if (nextDayBaseTurn === null && turnNumber) nextDayBaseTurn = turnNumber;

  return (
    <SpotlightTour
      steps={STEPS} total={TOTAL_STEPS} step={step}
      onNext={nextFirstDayStep} onPrev={prevFirstDayStep} onEnd={endFirstDay}
    />
  );
}

/**
 * 스포트라이트 안내 엔진 (첫날 튜토리얼·퀀트 튜토리얼 공용).
 * steps: 단계 정의(위 STEPS 형식), step: 현재 단계(1부터), onNext(from)/onPrev/onEnd: 단계 이동
 * endLabel: 마지막 단계 버튼 문구
 */
export function SpotlightTour({ steps, total, step, onNext, onPrev, onEnd, tag = 'TUTORIAL', endLabel = '시작하기 ▶' }) {
  const sessionState = useGameStore((s) => s.state);
  const turnState = useGameStore((s) => s.turn?.state);
  const activeModal = useGameStore((s) => s.activeModal);
  const lastTrade = useGameStore((s) => s.lastTrade);
  const marketOpen = useGameStore((s) => s.turn?.marketOpen);
  const turnNumber = useGameStore((s) => s.turn?.turnNumber);

  // 이 단계에 들어온 뒤 예약한 주문만 센다
  const stepStartRef = useRef({ step: null, at: 0 });
  if (stepStartRef.current.step !== step) stepStartRef.current = { step, at: Date.now() };
  const tradedHere = lastTrade && lastTrade.at >= stepStartRef.current.at ? lastTrade : null;
  const raw = steps[step];
  const flags = useDomFlags(raw?.watch);
  const seen = useSeenFlags(flags, step);

  const ctx = {
    activeModal,
    marketOpen,
    turnNumber,
    bought: tradedHere?.tradeType === 'buy',
    sold: tradedHere?.tradeType === 'sell',
    flags,
    seen,
  };
  const flagKey = JSON.stringify(flags) + JSON.stringify(seen);

  const view = raw ? (raw.view ? raw.view(ctx) : raw) : null;
  const spots = view?.spots || [];
  const sels = [...spots.map((s) => s.sel), view?.interact, ...spots.map((s) => s.noteFrom)];
  const rects = useRects(sels, [step, activeModal, ctx.bought, ctx.sold, flagKey]);
  const spotRects = rects.slice(0, spots.length);
  const holeRect = view?.interact ? rects[spots.length] : null;
  const noteRects = rects.slice(spots.length + 1);

  // 다음 단계가 아직 정의되지 않았으면(단계별 제작 중) 여기서 튜토리얼을 마친다
  const isLast = step >= total;
  const goNext = isLast || !steps[step + 1] ? onEnd : () => onNext(step);

  // 모달 열고 닫기로 진행하는 단계 (예: 뉴스를 열었다 닫으면 다음 단계)
  const memRef = useRef({});
  useEffect(() => { memRef.current = {}; }, [step]);
  useEffect(() => {
    if (raw?.onModal?.(activeModal, memRef.current, ctx) === 'next') goNext();
  }, [step, activeModal, ctx.bought, ctx.sold, turnNumber, flagKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
      {spotRects.map((r, i) => {
        if (!r || !spots[i].note) return null;
        const resolved = resolvePlace(spots[i].place);
        if (!resolved) return null;
        const { place, maxWidth } = resolved;
        return (
          <div key={`n${i}`} className={`tut-note ${place}${spots[i].boxed ? ' boxed' : ''}`}
            style={{ ...notePos(noteRects[i] || r, place), ...(maxWidth ? { maxWidth: Math.min(340, maxWidth) } : {}) }}>
            {spots[i].note(st)}
          </div>
        );
      })}

      {view.title && (
        <div className="tut-headline">
          <div className="tag">{tag} {step} / {total}</div>
          <h3>{view.title}</h3>
        </div>
      )}

      <div className="tut-controls">
        {view.hint && <p className="tut-hint">{view.hint}</p>}
        <div className="tut-controls-row">
          {step > 1 && (
            <button type="button" className="tut-prev" onClick={onPrev}>◀ 이전</button>
          )}
          <button type="button" className="tut-skip" onClick={onEnd}>튜토리얼 건너뛰기</button>
          {!view.interact && (
            <button type="button" className="tut-next" onClick={goNext}>
              {isLast ? endLabel : '다음 ▶'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
