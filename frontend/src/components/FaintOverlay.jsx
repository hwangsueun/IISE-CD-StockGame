// 기절(입원) 연출 — 스트레스 100 도달 시 즉시 발동, 결과 확인용 오버레이 (§10, 미팅5 §E)
// 디자인 원본: public/game/Faint Event.html (Phase D 이식 — 6단계 연출 동일, 수치는 실제 이벤트 결과 사용)
import { useEffect, useState } from 'react';
import { useTypewriter } from '../hooks/useTypewriter';
import { won } from '../utils/format';

const STEP_NAMES = ['기절', '스트레스 한계', '병원 이송', '스트레스 초기화', `일 경과`, '병원비 청구'];
const TOTAL_STEPS = STEP_NAMES.length;
const STRESS_FROM = 100;
const STRESS_TO = 0;

function Gauge({ onCount, cls }) {
  return (
    <div className="gauge-big">
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className={`cell ${i < onCount ? `on ${cls}` : ''}`} />
      ))}
    </div>
  );
}

export default function FaintOverlay({ event, onDismiss }) {
  const [step, setStep] = useState(0);
  const [resetValue, setResetValue] = useState(STRESS_FROM);

  const detail = event.detail || {};
  const days = detail.skipDays ?? 3;
  const hospitalCost = detail.hospitalCost ?? 0;
  const cashPaid = detail.cashPaid ?? hospitalCost;
  const debtAdded = detail.debtAdded ?? 0;

  const narrationText = (() => {
    switch (step) {
      case 0: return '<span class="red">기절 이벤트 발생.</span> 극심한 스트레스에 눈앞이 흐려집니다.';
      case 1: return '<span class="red">스트레스가 한계치에 도달했습니다.</span> 몸이 신호를 보냈지만, 이미 늦었습니다.';
      case 2: return '의식을 잃고 <span class="em">병원으로 이송되었습니다.</span>';
      case 3: return '안정을 되찾았습니다. <span class="em">스트레스 지수가 초기화</span>되었습니다.';
      case 4: return `입원으로 <span class="em">${days}일이 경과</span>했습니다. 그동안 거래는 진행되지 않았습니다.`;
      case 5: return '퇴원 수속과 함께 <span class="red">병원비가 청구되었습니다.</span> 아래 내역을 확인하세요.';
      default: return '';
    }
  })();

  const { html: typedHtml, done: typedDone, skip } = useTypewriter(narrationText, true);

  useEffect(() => {
    if (step !== 3) return undefined;
    setResetValue(STRESS_FROM);
    let v = STRESS_FROM;
    const id = setInterval(() => {
      v = Math.max(STRESS_TO, v - 4);
      setResetValue(v);
      if (v <= STRESS_TO) clearInterval(id);
    }, 28);
    return () => clearInterval(id);
  }, [step]);

  const showConfirm = step === 5 && typedDone;
  const advanceOnClick = step < 5 && typedDone;

  const handleStageClick = () => {
    if (!typedDone) { skip(); return; }
    if (advanceOnClick) setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  };

  return (
    <div className="event-overlay cutscene-overlay faint-overlay">
      <div className="game-frame ev-frame faint-frame">
        <div className="title-plate">＋ 기절 이벤트 ＋</div>
        <div className="room" />

        <div className="vitals">
          <span className="heart">♥</span>
          <svg className="ecg" viewBox="0 0 150 40" preserveAspectRatio="none">
            <polyline points="0,20 22,20 28,20 34,8 40,33 46,20 70,20 76,20 82,4 90,36 98,20 150,20" />
          </svg>
          <span className="bpm">72<small>BPM</small></span>
        </div>

        <div className="screen-tag">
          <span className="num">H{step + 1}</span>
          <span className="nm">{STEP_NAMES[step]}</span>
          <span className="step">STEP {step + 1} / {TOTAL_STEPS}</span>
        </div>

        <div className="intro-stage faint-stage" onClick={handleStageClick}>
          {step === 0 && (
            <div className="big-center shake">
              <div className="small">★ EVENT ★</div>
              <div className="faint">FAINT</div>
              <div className="kr">기 절</div>
              <div className="sub">…눈앞이 새카매진다.</div>
            </div>
          )}
          {step === 1 && (
            <div className="stress-block">
              <div className="lbl">STRESS LEVEL</div>
              <div className="num hot">100</div>
              <Gauge onCount={10} cls="hot" />
              <div className="tag hot">▲ 한계치 도달 — 더 이상 버틸 수 없습니다</div>
            </div>
          )}
          {step === 2 && (
            <div className="big-center">
              <div className="small">＋ EMERGENCY ＋</div>
              <div className="kr med-text">병원 이송</div>
              <div className="sub">의식을 잃은 채, 사이렌 소리가 멀어진다…</div>
            </div>
          )}
          {step === 3 && (
            <div className="stress-block">
              <div className="lbl">STRESS · RESET</div>
              <div className="num cool">{resetValue}</div>
              <Gauge onCount={Math.round(resetValue / 10)} cls="cool" />
              <div className="tag cool">▼ 충분한 휴식 — 스트레스 지수 초기화</div>
            </div>
          )}
          {step === 4 && (
            <div className="big-center">
              <div className="small">TIME PASSED</div>
              <div className="day">+ {days} DAYS</div>
              <div className="kr">{days}일 경과</div>
              <div className="sub">시장은 당신을 기다려주지 않았다.</div>
            </div>
          )}
          {step === 5 && (
            <div className="bill-card" onClick={(e) => e.stopPropagation()}>
              <div className="bill-head">
                <div className="cross">＋ ＋ ＋</div>
                <div className="ttl">병원비 청구서</div>
                <div className="sub">HOSPITALIZATION · 응급 입원 정산</div>
              </div>
              <div className="bill-row">
                <span className="k">스트레스<small>STRESS</small></span>
                <span className="v"><span className="from">{STRESS_FROM}</span><span className="arrow">▶</span><span className="to">{STRESS_TO}</span></span>
              </div>
              <div className="bill-row">
                <span className="k">경과 시간<small>TIME PASSED</small></span>
                <span className="v cool">{days}일</span>
              </div>
              {debtAdded > 0 && (
                <div className="bill-row">
                  <span className="k">현금 부족분<small>ADDED TO DEBT</small></span>
                  <span className="v">{won(debtAdded)} → 부채 편입</span>
                </div>
              )}
              <div className="bill-row total">
                <span className="k">병원비<small>MEDICAL FEE</small></span>
                <span className="v">- {won(cashPaid)}{debtAdded > 0 ? ' (현금)' : ''}</span>
              </div>
            </div>
          )}
        </div>

        {showConfirm && (
          <div className="confirm-strip">
            <button type="button" className="confirm-btn" onClick={onDismiss}>
              <span className="arr">▶</span>확인
            </button>
          </div>
        )}

        <div className="narration faint-narration" onClick={handleStageClick}>
          <div className="nar-head">
            <div className="nar-portrait">＋</div>
            <span className="nar-name">시스템</span>
            <span className="nar-tag">{step === 3 ? 'RECOVER' : step === 4 ? 'TIME' : step === 5 ? 'BILL' : 'SYSTEM'}</span>
            <span className="nar-prog">STEP <b>{step + 1}</b> / {TOTAL_STEPS}</span>
          </div>
          <div className="nar-body">
            <span dangerouslySetInnerHTML={{ __html: typedHtml }} />
            {!typedDone && <span className="cursor" />}
          </div>
          {advanceOnClick && <div className="nar-next">▶ 계속</div>}
        </div>

        <div className="crt" />
      </div>
    </div>
  );
}
