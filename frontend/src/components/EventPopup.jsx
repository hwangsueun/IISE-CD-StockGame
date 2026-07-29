// 이벤트 팝업 — 선택형(choice) 이벤트는 해결 전 턴 진행 불가 (§10)
// 독촉전화(loan_shark_call)는 디자인 원본 Loanshark Call.html, 투자 스터디(invest_study)는
// game-live/Invest Study Event.html 픽셀 연출을 이식. 나머지 이벤트 타입은 공용 모달 유지.
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
  if (eventType === 'invest_study') return <InvestStudyEvent event={event} />;
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

// --- 투자/경제 개념 문제 풀 (프론트 전용 플레이버. 서버엔 대응 개념이 없어 채점하지 않고
//     정답만 바로 보여준다 — 문제은행을 서버로 옮길 계획이 생기면 이 배열을 그쪽으로 옮길 것) ---
const CONCEPT_QUIZ = [
  { chip: '기초 원칙', q: '"계란을 한 바구니에 담지 마라"가 강조하는 원칙은?',
    opts: ['한 종목에 몰빵', '분산투자', '초단타 매매', '빚내서 투자'], answer: 1,
    explain: '여러 종목에 나눠 담아야 하나가 무너져도 계좌 전체는 버틴다 — 분산투자.' },
  { chip: '위험 관리', q: '미리 정한 손실 한계에서 감정 없이 파는 규칙은?',
    opts: ['물타기', '손절선', '존버', 'FOMO'], answer: 1,
    explain: '감정이 아니라 규칙이 팔게 해야 큰 손실을 막는다 — 손절선.' },
  { chip: '사기 주의', q: '누군가 "무위험 고수익"을 약속한다면?',
    opts: ['당장 전 재산 투자', '사기일 가능성이 높다', '대출받아 투자', '친구도 데려간다'], answer: 1,
    explain: '위험 없는 고수익은 없다. 무위험 고수익 제안은 대부분 사기다.' },
  { chip: '시간의 힘', q: '이자가 다시 이자를 낳으며 눈덩이처럼 불어나는 효과는?',
    opts: ['단리', '복리', '인플레이션', '레버리지'], answer: 1,
    explain: '복리는 시간이 길수록 강해진다.' },
  { chip: '거시 경제', q: '기준금리가 오르면 일반적으로 나타나는 현상은?',
    opts: ['대출 이자 부담이 커진다', '예금 이자가 사라진다', '물가가 반드시 오른다', '주가가 항상 오른다'], answer: 0,
    explain: '금리가 오르면 빚의 무게가 무거워진다 — 대출 이자 부담 증가.' },
  { chip: '거시 경제', q: '물가가 올라 돈의 가치가 떨어지는 현상은?',
    opts: ['디플레이션', '인플레이션', '스프레드', '리밸런싱'], answer: 1,
    explain: '현금만 쥐고 있어도 가치가 줄어들 수 있다 — 인플레이션.' },
  { chip: '매매 습관', q: '"남들 다 벌었대"라는 소문에 뒤늦게 뛰어드는 심리는?',
    opts: ['FOMO', '손절', '분산', '복리'], answer: 0,
    explain: '조급함이 개미의 가장 큰 적이다 — FOMO.' },
];
function pickOne(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// 옆자리 동료의 제안 대사 (프론트 전용 플레이버 — 서버 prompt와 별개로, 선택은 event.choices를 그대로 사용)
const STUDY_OFFER_LINES = [
  '아직 안 갔네? 나도 방금 끝났어.',
  '있잖아… 나 요즘 <span class="em">투자 스터디</span> 하거든.<br>오늘 배운 거 하나만 같이 볼래?',
  '오래 안 걸려. 딱 하나만.<br>아무거나 찍어서 사는 것보단 낫잖아. 어때?',
];

/**
 * 디자인 원본: public/game/Invest Study Event.html (옆자리 동료 제안 → 참여/거절 → 흰 스터디 창)
 * onResolve/onDismiss: 실제 게임에서는 생략하면 스토어의 resolveEvent/dismissEvent를 그대로 쓴다.
 * IntroPage의 [개발용] 미리보기처럼 세션 없이 렌더링할 때만 목업 함수로 대체해서 넘긴다.
 */
export function InvestStudyEvent({ event, onResolve, onDismiss }) {
  const storeResolveEvent = useGameStore((s) => s.resolveEvent);
  const storeDismissEvent = useGameStore((s) => s.dismissEvent);
  const resolveEvent = onResolve || storeResolveEvent;
  const dismissEvent = onDismiss || storeDismissEvent;
  const eventLogId = event.eventLogId || event.event_log_id;
  const choices = event.choices || event.detail?.choices || [];

  const [lineIdx, setLineIdx] = useState(0);
  const [phase, setPhase] = useState('offer'); // 'offer' | 'submitting' | 'study' | 'summary' | 'declined'
  const [result, setResult] = useState(null);
  const [showQuiz] = useState(() => Math.random() < 0.5);
  const [quiz] = useState(() => pickOne(CONCEPT_QUIZ));
  const [quizPicked, setQuizPicked] = useState(null);

  const atLastLine = lineIdx === STUDY_OFFER_LINES.length - 1;
  const { html, done, skip } = useTypewriter(STUDY_OFFER_LINES[lineIdx], phase === 'offer');

  const advanceLine = () => {
    if (phase !== 'offer') return;
    if (!done) { skip(); return; }
    if (!atLastLine) setLineIdx((i) => i + 1);
  };

  const choose = async (key) => {
    setPhase('submitting');
    const r = await resolveEvent(eventLogId, key);
    setResult(r);
    setPhase(key === 'decline' ? 'declined' : 'study');
  };

  const stressDelta = result?.stressDelta;
  const detail = result?.detail || {};
  // 퀴즈는 정답을 확인해야, 인사이트는 바로 다음으로 넘어갈 수 있다
  const canContinue = showQuiz ? quizPicked !== null : true;

  return (
    <div className="cutscene-overlay">
      <div className="game-frame study-frame">
        <div className="title-plate">★ EVENT · 투자 스터디 ★</div>
        <div className="study-stage" />

        {(phase === 'offer' || phase === 'submitting') && (
          <div className="narration" onClick={advanceLine}>
            <div className="nar-head">
              <div className="nar-portrait">🙂</div>
              <span className="nar-name">김대리</span>
              <span className="nar-tag">옆자리 · 동료</span>
            </div>
            <div className="nar-body">
              <span dangerouslySetInnerHTML={{ __html: html }} />
              {!done && <span className="cursor" />}
            </div>

            {done && atLastLine && (
              <div className="nar-choices" onClick={(e) => e.stopPropagation()}>
                {choices.map((c) => (
                  <div key={c.key} className="choice">
                    <span className="num">CHOICE</span>
                    <span className="text">{c.label}</span>
                    <button
                      className="choice-confirm"
                      disabled={phase === 'submitting'}
                      onClick={() => choose(c.key)}
                    >
                      선택한다 ▶
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {phase === 'declined' && (
          <div className="narration">
            <div className="nar-head">
              <div className="nar-portrait">🙂</div>
              <span className="nar-name">김대리</span>
              <span className="nar-tag">옆자리 · 동료</span>
            </div>
            <div className="nar-body">
              에이, 아쉽네. 뭐 오늘은 피곤하겠지.<br />다음엔 꼭 같이 하자. 자료는 남겨둘게.
            </div>
            <div className="nar-next" onClick={() => dismissEvent(eventLogId)}>▶ 확인</div>
          </div>
        )}

        {phase === 'study' && result && (
          <div className="study-card-overlay">
            <div className="study-card">
              <div className="study-card-bar">
                <span className="logo">ANT INVEST ACADEMY</span>
                <span className="sub">{showQuiz ? '오늘의 개념' : '오늘의 인사이트'}</span>
              </div>

              <div className="study-card-body">
                {showQuiz ? (
                  <>
                    <span className="study-chip">{quiz.chip}</span>
                    <p className="study-q">{quiz.q}</p>
                    <div className="study-opts">
                      {quiz.opts.map((o, i) => (
                        <button
                          key={i}
                          className={
                            'study-opt' +
                            (quizPicked === null ? '' : i === quiz.answer ? ' correct' : ' locked')
                          }
                          disabled={quizPicked !== null}
                          onClick={() => setQuizPicked(i)}
                        >
                          <span className="key">{['A', 'B', 'C', 'D'][i]}</span>{o}
                        </button>
                      ))}
                    </div>
                    {quizPicked !== null && <p className="study-explain">→ {quiz.explain}</p>}
                  </>
                ) : (
                  <>
                    <span className="study-chip">오늘의 인사이트</span>
                    <p className="study-text">{detail.insight}</p>
                    {detail.directionHint && (
                      <p className="study-hint">🧭 {detail.directionHint.text}</p>
                    )}
                    {detail.omenHint && (
                      <p className="study-hint omen">🔮 {detail.omenHint.text}</p>
                    )}
                  </>
                )}
              </div>

              <div className="study-card-foot">
                <span className="spacer" />
                <button
                  className="choice-confirm"
                  disabled={!canContinue}
                  onClick={() => setPhase('summary')}
                >
                  다음 ▶
                </button>
              </div>
            </div>
          </div>
        )}

        {phase === 'summary' && (
          <div className="narration">
            <div className="nar-head">
              <div className="nar-portrait">🙂</div>
              <span className="nar-name">김대리</span>
              <span className="nar-tag">옆자리 · 동료</span>
            </div>
            <div className="nar-body">
              오늘도 하나 배웠다. 사무실 불이 꺼지기 전에, 김대리가 씩 웃었다.
              {!!stressDelta && (
                <div className="study-stress-badge study-stress-badge--dark">
                  🧘 스트레스 {stressDelta}
                </div>
              )}
            </div>
            <div className="nar-next" onClick={() => dismissEvent(eventLogId)}>▶ 확인</div>
          </div>
        )}

        <div className="crt" />
      </div>
    </div>
  );
}
