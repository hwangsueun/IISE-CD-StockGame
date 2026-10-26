// 경조사(결혼식 초대) 이벤트 — 선택형 (§10, 미팅4 §14)
// 디자인 원본: public/game/Wedding Event.html (Phase D 이식 — 초대장 → 참석/불참 → (참석 시) 축하 장면 → 결과 영수증)
// 축의금·스트레스 수치와 참석 시 스트레스 방향은 서버(eventEngine condolence)가 정해서 내려준다.
import { useState } from 'react';
import { useGameStore } from '../state/gameStore';
import { useTypewriter } from '../hooks/useTypewriter';
import { won } from '../utils/format';

const INVITE_TEXT = '<span class="rose">경조사 이벤트 발생.</span> 지인의 <span class="em">결혼식 초대장</span>이 도착했습니다. 참석 여부를 선택하세요.';

const CELEBRATE_LINES = [
  {
    caption: '예식장 입구에 도착했다.',
    text: '예식장에 도착했습니다. 입구에서 <span class="rose">신랑신부의 환한 미소</span>가 보입니다.',
  },
  {
    caption: '“결혼 축하해, 행복하게 잘 살아!”',
    text: '축의금을 전하며 두 사람에게 <span class="em">“결혼 축하해! 두 사람 정말 잘 어울린다”</span>라고 진심으로 인사를 건넸습니다.',
  },
  {
    caption: '함께 사진도 찍고, 잠시 즐거운 시간.',
    text: '식이 끝나고 <span class="rose">함께 사진도 찍고</span> 맛있는 식사를 하며 잠시 즐거운 축하의 시간을 보냈습니다.',
  },
  {
    caption: '진심으로 축하를 전했다.',
    text: '두 사람의 행복을 진심으로 축하하며, 따뜻한 마음으로 <span class="rose">축하의 자리</span>를 마무리했습니다.',
  },
];

// 서버 detail.outcome별 결과 카드 문구
const OUTCOME = {
  down: { choice: '참석한다', change: '스트레스 ▼ 감소', cls: 'down',
    result: '축하 인사를 받고 따뜻한 분위기 속에서 잠시 기분이 좋아졌다. 감사 인사를 받고 마음이 편해졌다.' },
  up: { choice: '참석한다', change: '스트레스 ▲ 증가', cls: 'up',
    result: '사람이 많고 어색한 대화가 이어져 피로했다. 낯선 사람들 사이에서 불편함을 느꼈다.' },
  decline: { choice: '불참한다', change: '스트레스 ▲ 증가', cls: 'up',
    result: '돈은 아꼈지만 마음이 불편해 스트레스가 증가했습니다.' },
  broke: { choice: '참석한다', change: '스트레스 ▲ 증가', cls: 'up',
    result: '축의금 낼 돈이 없어 결국 가지 못했다. 마음이 무겁다.' },
};

// 서버 choice.label "참석한다 (-100,000원)" → 버튼 이름/부제 두 줄
function splitChoiceLabel(label) {
  const m = /^(.+?)\s*\((.+)\)$/.exec(label);
  return m ? { name: m[1], hint: m[2] } : { name: label, hint: null };
}

/**
 * onResolve/onDismiss: 생략하면 스토어의 resolveEvent/dismissEvent를 쓴다 (미리보기용 주입 지점).
 */
export default function CondolenceOverlay({ event, onResolve, onDismiss }) {
  const storeResolveEvent = useGameStore((s) => s.resolveEvent);
  const storeDismissEvent = useGameStore((s) => s.dismissEvent);
  const resolveEvent = onResolve || storeResolveEvent;
  const dismissEvent = onDismiss || storeDismissEvent;
  const eventLogId = event.eventLogId || event.event_log_id;
  const choices = event.choices || event.detail?.choices || [];

  const [phase, setPhase] = useState('invite'); // 'invite' | 'submitting' | 'celebrate' | 'result'
  const [celebrateIdx, setCelebrateIdx] = useState(0);
  const [result, setResult] = useState(null);

  const outcomeKey = result?.detail?.outcome || (result?.chosen === 'decline' ? 'decline' : 'up');
  const o = OUTCOME[outcomeKey] || OUTCOME.up;
  const cost = result?.cashDelta ? Math.abs(result.cashDelta) : 0;

  const narrationText = (() => {
    if (phase === 'celebrate') return CELEBRATE_LINES[celebrateIdx].text;
    if (phase === 'result') {
      const tone = o.cls === 'up'
        ? '<span class="red">스트레스가 증가</span>했습니다.'
        : '<span class="green">기분이 한결 나아졌습니다.</span>';
      return `<span class="em">${o.choice}</span>를 선택했습니다. 아래 내역을 확인하세요. ${tone}`;
    }
    return INVITE_TEXT;
  })();
  const { html, done, skip } = useTypewriter(narrationText, true);

  const choose = async (key) => {
    setPhase('submitting');
    const r = await resolveEvent(eventLogId, key);
    setResult({ ...r, chosen: key });
    setPhase(r.detail?.outcome === 'down' || r.detail?.outcome === 'up' ? 'celebrate' : 'result');
  };

  const handleClick = () => {
    if (!done) { skip(); return; }
    if (phase !== 'celebrate') return;
    if (celebrateIdx < CELEBRATE_LINES.length - 1) setCelebrateIdx((i) => i + 1);
    else setPhase('result');
  };

  const stepTag = phase === 'celebrate'
    ? { num: 'W♥', name: '결혼식 축하 시간', step: 'CELEBRATION', prog: '♥' }
    : phase === 'result'
      ? { num: 'W2', name: '결과', step: 'STEP 2 / 2', prog: '2' }
      : { num: 'W1', name: '결혼식 초대', step: 'STEP 1 / 2', prog: '1' };

  return (
    <div className="cutscene-overlay">
      <div className="game-frame wed-frame" onClick={handleClick}>
        <div className="title-plate">♥ 경조사 이벤트 ♥</div>
        <div className="wed-room" />

        <div className="wed-datebox">
          <span className="ring">◎◎</span>
          <span className="lbl">WEDDING</span>
        </div>

        <div className="screen-tag">
          <span className="num">{stepTag.num}</span>
          <span className="nm">{stepTag.name}</span>
          <span className="step">{stepTag.step}</span>
        </div>

        <div className={`wed-stage ${phase === 'invite' || phase === 'submitting' ? 'invite' : phase}`}>
          {(phase === 'invite' || phase === 'submitting') && (
            <div className="wed-invite">
              <div className="rings">◎◎</div>
              <div className="ttl">결혼식 초대</div>
              <div className="eng">WEDDING INVITATION</div>
              <div className="divider" />
              <div className="body">
                <div className="row"><span className="bullet">♥</span><span>지인의 <span className="em">결혼식 초대장</span>이 도착했습니다.</span></div>
                <div className="row"><span className="bullet">♥</span><span>참석하면 <span className="em">경조사비</span>를 지불합니다.</span></div>
                <div className="row"><span className="bullet">♥</span><span>불참하면 돈은 아끼지만 <span className="red">스트레스가 증가</span>합니다.</span></div>
              </div>
            </div>
          )}

          {phase === 'celebrate' && (
            <div className="wed-celebrate" key="celebrate">
              <div className="rings">◎◎</div>
              <div className="ttl">결혼 축하해!</div>
              <div className="eng">WEDDING CELEBRATION</div>
              <div className="divider" />
              <div className="cele-cap">{CELEBRATE_LINES[celebrateIdx].caption}</div>
              <div className="confetti">♥ ◎ ♪ ♥ ◎ ♪ ♥</div>
            </div>
          )}

          {phase === 'result' && result && (
            <div className="wed-result" onClick={(e) => e.stopPropagation()}>
              <div className="rc-head">
                <div className="rings">◎◎</div>
                <div className="ttl">경조사 결과</div>
                <div className="sub">WEDDING · 결혼식 초대 정산</div>
              </div>
              <div className="rc-row">
                <span className="k">선택<small>CHOICE</small></span>
                <span className="v gold">{o.choice}</span>
              </div>
              <div className="rc-row">
                <span className="k">경조사비<small>GIFT MONEY</small></span>
                <span className={'v' + (cost ? '' : ' gold')}>{cost ? `- ${won(cost)}` : '0원'}</span>
              </div>
              <div className="rc-row">
                <span className="k">스트레스 변화<small>STRESS</small></span>
                <span className={`v ${o.cls}`}>{o.change} ({result.stressDelta > 0 ? '+' : ''}{result.stressDelta ?? 0})</span>
              </div>
              <div className="rc-row result">
                <span className="k">결과<small>OUTCOME</small></span>
                <span className={`v ${o.cls}`}>{o.result}</span>
              </div>
            </div>
          )}
        </div>

        {(phase === 'invite' || phase === 'submitting') && done && (
          <div className="wed-choices" onClick={(e) => e.stopPropagation()}>
            {choices.map((c, i) => {
              const { name, hint } = splitChoiceLabel(c.label);
              return (
                <button
                  key={c.key}
                  type="button"
                  className={`wed-choice ${c.key === 'attend' ? 'attend' : 'decline'}`}
                  disabled={phase === 'submitting'}
                  onClick={() => choose(c.key)}
                >
                  <span className="key">［ {i + 1} ］</span>
                  <span className="name">{name}</span>
                  {hint && <span className="hint">{hint}</span>}
                </button>
              );
            })}
          </div>
        )}

        {phase === 'result' && done && (
          <div className="wed-confirm" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="confirm-btn wed-confirm-btn" onClick={() => dismissEvent(eventLogId)}>
              <span className="arr">▶</span>확인
            </button>
          </div>
        )}

        <div className="narration wed-narration">
          <div className="nar-head">
            <div className="nar-portrait">♥</div>
            <span className="nar-name">시스템</span>
            <span className="nar-tag">{phase === 'celebrate' ? 'CELEBRATION' : phase === 'result' ? 'RESULT' : 'EVENT'}</span>
            <span className="nar-prog">STEP <b>{stepTag.prog}</b> / 2</span>
          </div>
          <div className="nar-body">
            <span dangerouslySetInnerHTML={{ __html: html }} />
            {!done && <span className="cursor" />}
          </div>
          {phase === 'celebrate' && done && (
            <div className="nar-next">{celebrateIdx < CELEBRATE_LINES.length - 1 ? '▶ 계속' : '▶ 결과 보기'}</div>
          )}
        </div>

        <div className="crt" />
      </div>
    </div>
  );
}
