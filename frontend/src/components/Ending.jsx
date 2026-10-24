// 엔딩 컷신 — 해피(기간 내 빚 완납) / 배드(기한 내 미상환 또는 신뢰도 0)
// 흐름: 사채업자 김씨와의 대화 -> 최종 리포트 -> 독백 -> 다시 하기
//   해피: 전화벨 -> 통화(상환 완료) -> 리포트 -> "또.. 해볼까?"
//   배드: 쾅쾅(배경 흔들림) -> 문밖 대화 -> 리포트 -> 후회 -> "다시 돌아가고 싶어"
// 배경: public/game/assets/{happy,bad}_end_bgr.webp / 대화창·버튼은 인트로 컷신(IntroPage) 스타일 공용
import { useState } from 'react';
import { useTypewriter } from '../hooks/useTypewriter';
import EndingReport from './EndingReport';

const SHARK = { portrait: '☠', name: '사채업자 김씨' };
const ME = { portrait: '나', name: '나' };

/** 150_000_000 -> '1억 5천만 원' (인트로 빚 선택지와 같은 말투) */
function debtLabel(n) {
  if (n < 1e4) return `${n.toLocaleString('ko-KR')}원`;
  const eok = Math.floor(n / 1e8);
  const man = Math.floor((n % 1e8) / 1e4);
  const manText = man === 0 ? '' : man % 1000 === 0 ? `${man / 1000}천만` : `${man.toLocaleString('ko-KR')}만`;
  return `${[eok ? `${eok}억` : '', manText].filter(Boolean).join(' ')} 원`;
}

// 장면 bg: dark(제목·리포트) / dim(대화) / lit(독백). shake: 문 두드리는 소리 = 배경 흔들림
function happyScenes(result) {
  return [
    { type: 'title', bg: 'dark', small: '★ HAPPY ENDING ★', big: '상환 완료', sub: '…전화벨이 울린다.' },
    { type: 'line', bg: 'dim', who: SHARK, tag: 'DIALOG', html: '<span class="em">박 사장.</span> 나야. …방금 통장 확인했다.' },
    { type: 'line', bg: 'dim', who: SHARK, tag: 'DIALOG', html: `<span class="em">${debtLabel(result.debtInitial)}.</span> 한 푼도 안 빠지고 다 들어왔더라.` },
    { type: 'line', bg: 'dim', who: SHARK, tag: 'DIALOG', html: '1년 만에… 솔직히 데리러 갈 날짜까지 잡아놨었는데.' },
    { type: 'line', bg: 'dim', who: SHARK, tag: 'CLEAR', html: '<span class="grn">상환 완료.</span> 이제 너랑 나는 아무 사이도 아니야.' },
    { type: 'line', bg: 'dim', who: SHARK, tag: 'DIALOG', html: '다음에 또 돈 모자라면 <span class="em">언제든 찾아와.</span>' },
    { type: 'line', bg: 'dim', who: SHARK, tag: 'END', html: '끊는다.', stage: { small: 'CALL ENDED', big: '…뚜─' } },
    { type: 'report', bg: 'dark' },
    { type: 'line', bg: 'lit', who: ME, tag: 'MONOLOGUE', html: '…끝났다. <span class="em">힘들었지만, 무사히 다 갚았다.</span>' },
    { type: 'line', bg: 'lit', who: ME, tag: 'MONOLOGUE', html: '매일 아침 차트를 열 때마다 심장이 내려앉았지. 전화벨만 울려도 손이 떨렸고.' },
    { type: 'line', bg: 'lit', who: ME, tag: 'MONOLOGUE', html: '이제 다시는 이러지 말아야지… 빚내서 하는 투자는, 이번이 정말 마지막이다.' },
    {
      type: 'final', bg: 'lit', who: ME, tag: 'MONOLOGUE', html: '<span class="em">…또.. 해볼까?</span>',
      button: { num: 'NEW GAME', text: '▶ 다시 하기', sub: '사채업자에게 다시 전화가 걸려온다' },
    },
  ];
}

function badScenes(result) {
  // 신뢰도 0 / 기한 내 미상환 구분 없이 같은 엔딩
  return [
    { type: 'title', bg: 'dark', small: '★ BAD ENDING ★', big: '상환 실패', sub: '…빗소리만 들리는 밤.' },
    { type: 'knock', bg: 'dim', shake: true },
    { type: 'line', bg: 'dim', who: SHARK, tag: 'DOOR', html: '<span class="red">박 사장.</span> 문 열어. 안에 있는 거 다 알아.' },
    { type: 'line', bg: 'dim', who: SHARK, tag: 'DOOR', html: `1년 줬다. 아직 <span class="em">${debtLabel(result.debtRemaining)}</span> 남았고, 날짜는 지났어.` },
    { type: 'line', bg: 'dim', who: SHARK, tag: 'DOOR', html: '빚 다 못 갚으면 <span class="red">내가 찾아간다고 했지?</span>' },
    { type: 'line', bg: 'dim', shake: true, who: SHARK, tag: 'DOOR', html: '<span class="red">좋은 말로 할 때 나오세요, 형님.</span>' },
    { type: 'report', bg: 'dark' },
    { type: 'line', bg: 'lit', who: ME, tag: 'REGRET', html: '…내가 왜 그랬을까.' },
    { type: 'line', bg: 'lit', who: ME, tag: 'REGRET', html: '그때로 돌아간다면, <span class="em">절대 사채 같은 건 쓰지 않을 텐데.</span>' },
    { type: 'line', bg: 'lit', who: ME, tag: 'REGRET', html: '한 번만… 딱 한 번만 다시 돌아갈 수 있다면.' },
    {
      type: 'final', bg: 'lit', who: ME, tag: 'REGRET', html: '<span class="em">…다시 돌아가고 싶어. 이전으로…</span>',
      button: { num: 'NEW GAME', text: '▶ 다시 하기', sub: '그날 밤, 전화벨이 울리기 전으로' },
    },
  ];
}

const KINDS = {
  happy: { plate: '★ ENDING · 상환 완료 ★', build: happyScenes },
  bad: { plate: '★ ENDING · 상환 실패 ★', build: badScenes },
};

export default function Ending({ kind, result, report, onRestart }) {
  const { plate, build } = KINDS[kind];
  const [scenes] = useState(() => build(result));
  const [step, setStep] = useState(0);
  const scene = scenes[step];
  const hasNarration = scene.type === 'line' || scene.type === 'final';
  const { html: typedHtml, done: typedDone, skip } = useTypewriter(hasNarration ? scene.html : '', hasNarration);

  const advanceOnClick = scene.type === 'title' || scene.type === 'knock' || (scene.type === 'line' && typedDone);
  const next = () => setStep((s) => Math.min(s + 1, scenes.length - 1));

  const handleStageClick = () => {
    if (hasNarration && !typedDone) { skip(); return; }
    if (advanceOnClick) next();
  };

  return (
    <div className="intro-page ending-page">
      <div className="game-frame ending-frame" onClick={handleStageClick}>
        <div className="title-plate">{plate}</div>
        <div className={`ending-bg ${kind} ${scene.bg}${scene.shake ? ' shake' : ''}`} />

        <div className="intro-stage">
          {scene.type === 'title' && (
            <div className="black-title">
              <div className="small">{scene.small}</div>
              <div className="big">{scene.big}</div>
              <div className="sub">{scene.sub}</div>
            </div>
          )}
          {scene.stage && (
            <div className="black-title" style={{ opacity: 0.7 }}>
              <div className="small">{scene.stage.small}</div>
              <div className="big" style={{ fontSize: 26, color: 'var(--px-ink-dim)' }}>{scene.stage.big}</div>
            </div>
          )}
        </div>

        {(scene.type === 'title' || scene.type === 'knock') && <div className="press-hint">▶ 화면을 클릭하세요</div>}

        {/* 최종 리포트: 별도 모듈로 교체 예정 — EndingReport의 props(result, report, onNext)만 맞추면 된다 */}
        {scene.type === 'report' && <EndingReport result={result} report={report} onNext={next} />}

        {scene.type === 'final' && typedDone && (
          <div className="choice-strip single">
            <button className="choice-btn gold" onClick={(e) => { e.stopPropagation(); onRestart(); }}>
              <span className="num">{scene.button.num}</span>
              <span className="text">{scene.button.text}</span>
              <span className="sub">{scene.button.sub}</span>
            </button>
          </div>
        )}

        {hasNarration && (
          <div className="narration">
            <div className="nar-head">
              <div className={`nar-portrait${scene.who === ME ? ' me' : ''}`}>{scene.who.portrait}</div>
              <span className="nar-name">{scene.who.name}</span>
              <span className="nar-tag">{scene.tag}</span>
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
    </div>
  );
}
