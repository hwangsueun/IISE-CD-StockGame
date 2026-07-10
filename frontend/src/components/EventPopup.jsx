// 이벤트 팝업 — 선택형(choice) 이벤트는 해결 전 턴 진행 불가 (§10)
// 독촉전화(loan_shark_call)는 디자인 원본 Loanshark Call.html 픽셀 연출 이식, 나머지 이벤트 타입은 공용 모달 유지.
import { useEffect, useState } from 'react';
import { useGameStore } from '../state/gameStore';
import { useTypewriter } from '../hooks/useTypewriter';
import { won } from '../utils/format';

const EVENT_ICON = {
  loan_shark_call: '📞', invest_study: '📚', travel: '✈️',
  condolence: '💌', holiday: '🎑',
};
// 금액 입력이 필요한 선택지 (eventType:choiceKey)
const AMOUNT_CHOICES = new Set(['loan_shark_call:pay']);

export default function EventPopup({ event }) {
  const eventType = event.eventType || event.event_type;
  if (eventType === 'loan_shark_call') return <LoanSharkCallEvent event={event} />;
  return <GenericEventPopup event={event} />;
}

function GenericEventPopup({ event }) {
  const resolveEvent = useGameStore((s) => s.resolveEvent);
  const dismissEvent = useGameStore((s) => s.dismissEvent);
  const [submitting, setSubmitting] = useState(false);
  const [amount, setAmount] = useState('');
  const [result, setResult] = useState(null);

  const detail = event.detail || {};
  const prompt = event.prompt || detail.prompt;
  const choices = event.choices || detail.choices || [];
  const needsAmount = (key) => AMOUNT_CHOICES.has(`${event.eventType || event.event_type}:${key}`);

  const choose = async (key) => {
    setSubmitting(true);
    try {
      const payload = needsAmount(key) ? { amount: Number(amount) || 0 } : undefined;
      setResult(await resolveEvent(event.eventLogId || event.event_log_id, key, payload));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay event-overlay">
      <div className="modal event-popup">
        <h3>{EVENT_ICON[event.eventType || event.event_type] || '⚡'} 이벤트</h3>
        {result ? (
          <>
            {result.detail?.paid !== undefined && <p>{won(result.detail.paid)} 상환했다.</p>}
            {result.detail?.insight && <p>💡 {result.detail.insight}</p>}
            {result.detail?.directionHint && <p>🧭 {result.detail.directionHint.text}</p>}
            {result.detail?.omenHint && <p>🔮 {result.detail.omenHint.text}</p>}
            {!result.detail && <p>처리 완료</p>}
            <button className="btn-primary" onClick={() => dismissEvent(event.eventLogId || event.event_log_id)}>
              확인
            </button>
          </>
        ) : (
          <>
            <p className="event-prompt">{prompt}</p>
            {detail.label && <p className="minigame-help">{detail.label} (스트레스 반영됨)</p>}
            {choices.some((c) => needsAmount(c.key)) && (
              <label className="field">
                상환 금액
                <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
            )}
            <div className="event-choices">
              {choices.map((c) => (
                <button key={c.key} disabled={submitting} onClick={() => choose(c.key)}>
                  {c.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 델타 배지: 이벤트 시작 시점 대비 변화량 (변화가 없으면 ±0) */
function Delta({ value, lowerBetter, suffix = '' }) {
  if (!value) return <span className="delta neutral">±0</span>;
  const sign = value > 0 ? '+' : '';
  const good = lowerBetter ? value < 0 : value > 0;
  return <span className={`delta ${good ? 'up' : 'down'}`}>{sign}{value}{suffix}</span>;
}

function resultText(result) {
  const paid = result.detail?.paid;
  if (paid) return `<span class="em">${won(paid)}</span>을 상환했다. 좋아. 그래야 사람이지. 약속 어기면 어떻게 되는지 알지?`;
  if (paid === 0) return '…상환액이 없었다. 다음 주에 사람 보낸다.';
  return '…뚝. 전화를 끊었다.';
}

/** 디자인 원본: public/game/Loanshark Call.html (Phase D 이식 — 전화벨/타이핑/스탯 델타 연출 동일) */
function LoanSharkCallEvent({ event }) {
  const resolveEvent = useGameStore((s) => s.resolveEvent);
  const dismissEvent = useGameStore((s) => s.dismissEvent);
  const liveState = useGameStore((s) => s.state) || {};
  const [baseline] = useState({ trust: liveState.trust, stress: liveState.stress, debt: liveState.debt });

  const detail = event.detail || {};
  const prompt = event.prompt || detail.prompt || '사채업자에게 전화가 걸려왔다...';
  const choices = event.choices || detail.choices || [];
  const eventType = event.eventType || event.event_type;
  const needsAmount = (key) => AMOUNT_CHOICES.has(`${eventType}:${key}`);

  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [elapsed, setElapsed] = useState(0);

  const { html: typedHtml, done: typedDone, skip } = useTypewriter(prompt, true);

  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  const choose = async (key) => {
    setSubmitting(true);
    try {
      const payload = needsAmount(key) ? { amount: Number(amount) || 0 } : undefined;
      setResult(await resolveEvent(event.eventLogId || event.event_log_id, key, payload));
    } finally {
      setSubmitting(false);
    }
  };

  const stat = (key) => Number(liveState[key] ?? 0);
  const delta = (key) => stat(key) - Number(baseline[key] ?? 0);
  const debtMan = (n) => `${Math.round(n / 10000).toLocaleString('ko-KR')}만`;

  return (
    <div className="event-overlay cutscene-overlay">
      <div className="game-frame ev-frame">
        <div className="title-plate">★ EVENT · 사채업자의 전화 ★</div>

        <div className="ev-stage" />

        <div className="ev-header">
          <span className="icon">!!</span>
          <span className="lbl">EVENT</span>
          <span className="nm">사채업자의 전화</span>
        </div>

        <div className="ev-stats">
          <div className="ev-stat-pill">
            <span className="ic" style={{ color: '#4ade80' }}>♥</span>
            <span className="k">신뢰도</span>
            <span className="v">{stat('trust')}</span>
            <Delta value={delta('trust')} lowerBetter={false} />
          </div>
          <div className="ev-stat-pill">
            <span className="ic" style={{ color: '#ef4444' }}>⚡</span>
            <span className="k">스트레스</span>
            <span className="v">{stat('stress')}</span>
            <Delta value={delta('stress')} lowerBetter />
          </div>
          <div className="ev-stat-pill">
            <span className="ic" style={{ color: '#f5c542' }}>☠</span>
            <span className="k">남은 빚</span>
            <span className="v">{debtMan(stat('debt'))}</span>
            <Delta value={Math.round(delta('debt') / 10000)} lowerBetter suffix="만" />
          </div>
        </div>

        <div className="ring-waves"><span /><span /><span /></div>
        <div className="phone-wrap">
          <img src="/game/assets/phone.png" alt="전화" />
          <div className="phone-screen">
            <div className="label">▶ INCOMING</div>
            <div className="caller">사채업자 김씨</div>
            <div className="number">010-XXXX-3949</div>
            <div className="timer">{mm}:{ss}</div>
          </div>
          <div className="phone-glow" />
        </div>

        <div className="narration ev-narration" onClick={() => { if (!result && !typedDone) skip(); }}>
          <div className="nar-head">
            <div className="nar-portrait">☠</div>
            <span className="nar-name">사채업자 김씨</span>
            <span className="nar-tag">통화 중 · LINE 1</span>
          </div>
          <div className="nar-body">
            <span dangerouslySetInnerHTML={{ __html: result ? resultText(result) : typedHtml }} />
            {!result && !typedDone && <span className="cursor" />}
          </div>

          {!result && typedDone && (
            <div className="nar-choices">
              {choices.map((c) => (
                <div key={c.key} className="choice" onClick={(e) => e.stopPropagation()}>
                  <span className="num">CHOICE</span>
                  <span className="text">{c.label}</span>
                  {needsAmount(c.key) && (
                    <input
                      className="choice-amount"
                      type="number" min="0" placeholder="상환액 (원)"
                      value={amount} onChange={(e) => setAmount(e.target.value)}
                    />
                  )}
                  <button className="choice-confirm" disabled={submitting} onClick={() => choose(c.key)}>
                    선택한다 ▶
                  </button>
                </div>
              ))}
            </div>
          )}

          {result && (
            <div
              className="nar-next"
              onClick={(e) => { e.stopPropagation(); dismissEvent(event.eventLogId || event.event_log_id); }}
            >
              ▶ 확인
            </div>
          )}
        </div>

        <div className="crt" />
      </div>
    </div>
  );
}
