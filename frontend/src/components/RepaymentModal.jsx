// 월말 상환 — 사채업자 방문 컷신 (§10, 기획서 §7 월말 상환 플로우)
// 디자인 원본: public/game/Loanshark Visit.html (Phase D 이식 — 방문 대사/송금 폼/결과 카드 연출 동일)
// 원본의 "최종 회차 자산 청산·엔딩 분기" 로직은 데모 프로토타입 전용이라 이식하지 않음 —
// 실제 게임의 상환은 항상 현금 기준이고(이자 개념 없음), 엔딩은 서버가 내려주는 status로 App/ResultPage가 처리한다.
import { useState } from 'react';
import { useGameStore } from '../state/gameStore';
import { useTypewriter } from '../hooks/useTypewriter';
import { won } from '../utils/format';

const STEP_NAMES = ['현관문 두드림', '인사 한 마디', '송금 입력', '송금 결과', '작별 인사'];
const TOTAL_STEPS = STEP_NAMES.length;

function pickReactionLine(ratio, paid) {
  if (paid === 0) return '<span class="red">0원?</span> 사람을 여기까지 오게 해놓고 빈손이면 섭섭하지. 박사장. 진짜로.';
  if (ratio >= 1.2) return '오? 박사장 <span class="em">오늘 왜 이래?</span> …좋아. 이런 박사장 좋아.';
  if (ratio >= 1.0) return '응. 딱 좋네. 이대로만 가자, 응?';
  if (ratio >= 0.8) return '에이~ 박사장. <span class="em">조금 모자라잖아.</span> …뭐, 알겠어. 이번엔 넘어가.';
  if (ratio >= 0.5) return '박사장. <span class="em">0 하나 덜 친 거 아니지?</span> 다음 주엔 좀 채우자.';
  return '에이~ 박사장 왜 이래? <span class="red">이러면 나도 곤란해.</span>';
}

export default function RepaymentModal() {
  const { state, turn, repay, closeModal } = useGameStore();
  const [step, setStep] = useState(0);
  const [amount, setAmount] = useState('');
  const [inputMsg, setInputMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  const cash = Number(state?.cash ?? 0);
  const debt = Number(state?.debt ?? 0);
  const debtInitial = Number(state?.debtInitial ?? state?.debt ?? 0);
  const due = Math.ceil(debtInitial / 12);
  const remainingCount = Math.max(1, 13 - (turn?.monthIndex ?? 1));

  const narrationText = (() => {
    switch (step) {
      case 1: return '<span class="em">똑똑.</span> 박사장. 나야. <span class="em">월요일마다 오는 사람.</span>';
      case 2: return '에이~ 설마 또 까먹은 척은 아니지? <span class="em">자, 얼마 보낼 건데?</span>';
      case 3: return result ? pickReactionLine(result.ratio, result.paidAmount) : '';
      case 4: return '다음 월요일에 또 보자. 나도 박사장 자주 보기 싫어. <span class="em">근데 박사장이 자꾸 날 부르잖아.</span>';
      default: return '';
    }
  })();

  const hasNarration = step >= 1;
  const { html: typedHtml, done: typedDone, skip } = useTypewriter(narrationText, hasNarration);

  const showFarewellChoice = step === 4 && typedDone;
  const advanceOnClick = step === 0 || ((step === 1 || step === 3) && typedDone);

  const handleStageClick = () => {
    if (hasNarration && !typedDone) { skip(); return; }
    if (advanceOnClick) setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  };

  const setFullAmount = () => setAmount(String(Math.max(0, Math.min(cash, debt))));

  const submitRepay = async () => {
    const v = Number(amount);
    if (!Number.isFinite(v) || v < 0) { setInputMsg('올바른 금액을 입력하세요.'); return; }
    if (v > cash) { setInputMsg('보유 현금이 부족합니다.'); return; }
    if (v > debt) { setInputMsg('남은 빚보다 많이 송금할 수 없습니다.'); return; }
    setSubmitting(true);
    setInputMsg('');
    try {
      const r = await repay(Math.floor(v));
      setResult(r);
      setStep(3);
    } catch (e) {
      setInputMsg(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="event-overlay cutscene-overlay">
      <div className="game-frame ev-frame">
        <div className="title-plate">★ EVENT · 상환일 — 사채업자 방문 ★</div>

        <div className="screen-tag">
          <span className="num">V{step + 1}</span>
          <span className="nm">{STEP_NAMES[step]}</span>
          <span className="step">STEP {step + 1} / {TOTAL_STEPS}</span>
        </div>

        <div className="intro-stage" onClick={handleStageClick}>
          {step === 0 && (
            <div className="big-center">
              <div className="small">★ 월요일 · 상환일 ★</div>
              <div className="knock">똑. 똑. 똑.</div>
              <div className="sub">…누가 문을 두드린다.</div>
            </div>
          )}
          {step === 1 && (
            <div className="big-center" style={{ opacity: 0.55 }}>
              <div className="small">현관 앞</div>
              <div className="big" style={{ fontSize: 28, color: 'var(--px-ink-dim)' }}>사채업자 김씨</div>
            </div>
          )}
          {step === 2 && (
            <div className="remit-card" onClick={(e) => e.stopPropagation()}>
              <div className="remit-head">
                <span className="ttl">★ 월 상환 ★</span>
                <span className="date">{turn?.monthIndex}개월차</span>
              </div>
              <div className="remit-grid">
                <div className="remit-row"><span className="k">보유 현금</span><span className="v cash">{won(cash)}</span></div>
                <div className="remit-row"><span className="k">남은 빚</span><span className="v debt">{won(debt)}</span></div>
                <div className="remit-row"><span className="k">남은 상환 기회</span><span className="v">{remainingCount}회 (오늘 포함)</span></div>
                <div className="remit-row"><span className="k">이번 달 요구액</span><span className="v expect">{won(due)}</span></div>
              </div>
              <div className="input-area">
                <div className="input-wrap">
                  <div className="input-lbl">▶ 송금액 입력 (0원 이상)</div>
                  <div className="input-box">
                    <span className="won">₩</span>
                    <input
                      type="text" inputMode="numeric" autoComplete="off" placeholder="금액을 입력하세요"
                      value={amount}
                      onChange={(e) => { setAmount(e.target.value.replace(/[^0-9]/g, '')); setInputMsg(''); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') submitRepay(); }}
                    />
                    <span className="unit">원</span>
                  </div>
                  <div className={`input-msg ${inputMsg ? '' : 'ok'}`}>{inputMsg || ' '}</div>
                  <button type="button" className="repay-shortcut" onClick={setFullAmount}>
                    ▶ 전액 상환 ({won(Math.max(0, Math.min(cash, debt)))})
                  </button>
                </div>
                <button className="send-btn" disabled={submitting} onClick={submitRepay}>
                  <span className="num">CONFIRM</span>
                  <span className="text">{submitting ? '처리 중...' : '송금한다'}</span>
                </button>
              </div>
            </div>
          )}
          {step === 3 && result && (
            <div className="result-card" onClick={(e) => e.stopPropagation()}>
              <h3>★ 상환 처리 ★</h3>
              <div className="result-row">
                <span className="k">남은 빚</span>
                <span className="before">{won(debt)}</span>
                <span className="after">{won(result.debtRemaining)}</span>
              </div>
              <div className="result-row">
                <span className="k">보유 현금</span>
                <span className="before">{won(cash)}</span>
                <span className="after">{won(cash - result.paidAmount)}</span>
              </div>
              <div className="result-paid">
                <span className="k">송금 완료</span>
                <span className="v">{won(result.paidAmount)}</span>
              </div>
            </div>
          )}
          {step === 4 && (
            <div className="big-center" style={{ opacity: 0.6 }}>
              <div className="small">CALL ENDS</div>
              <div className="big" style={{ fontSize: 28, color: 'var(--px-ink-dim)' }}>…문을 닫는다.</div>
            </div>
          )}
        </div>

        {step === 0 && <div className="press-hint">▶ 화면을 클릭하세요</div>}

        {showFarewellChoice && (
          <div className="choice-strip single">
            <button className="choice-btn gold" onClick={(e) => { e.stopPropagation(); closeModal(); }}>
              <span className="num">CONTINUE</span>
              <span className="text">▶ 문을 닫는다</span>
              <span className="sub">&nbsp;</span>
            </button>
          </div>
        )}

        {hasNarration && (
          <div className="narration" onClick={handleStageClick}>
            <div className="nar-head">
              <div className="nar-portrait">$</div>
              <span className="nar-name">사채업자 김씨</span>
              <span className="nar-tag">
                {step === 2 ? 'REQUEST' : step === 3 ? 'REACTION' : step === 4 ? 'FAREWELL' : 'DIALOG'}
              </span>
              <span className="nar-prog">STEP <b>{step + 1}</b></span>
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
