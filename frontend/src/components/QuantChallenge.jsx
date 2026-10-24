import { useState } from 'react';
import { won, pct, changeClass } from '../utils/format';

const rate = value => Number.isFinite(value) ? pct(value) : '—';
const gap = value => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${(value * 100).toFixed(2)}%p` : '—';
const resultLabel = { win: '승리', loss: '패배', tie: '무승부', unavailable: '집계 불가' };

export function ChallengeInvitation({ challenge, available, busy, error, onJoin, onLater, onExplore }) {
  const [step, setStep] = useState(0);
  const scenes = [
    { title: '다음 상환일이 다가온다.', speaker: '나',
      text: '투자 앱에 공지가 떴다. “투자 챌린지 참가자 모집.” 참가하면 상금을 받을 수 있다고 한다.' },
    { title: '“우리 alpha158보다 높은 수익률을 기록해 보세요.”', speaker: '투자 플랫폼의 공지',
      text: '매달 20턴 동안 참가자와 alpha158의 투자 성과를 비교합니다. alpha158보다 앞선 만큼 상금을 지급합니다. 지금 운용하는 포트폴리오로 참가할 수 있습니다.' },
    { title: '상금을 받으면 상환에 보탤 수 있겠는데?', speaker: '나',
      text: '내 수익률이 이 모델보다 높으면 된다. 어떤 종목에 투자했는지도 볼 수 있다. 한번 해볼까?' },
  ];
  const scene = scenes[step];
  return <section className="challenge-invitation" aria-label="투자 챌린지 초대">
    <div className="challenge-letterhead"><span>INVITATION / 투자 플랫폼</span><span>{step + 1} / 3</span></div>
    <div className="challenge-envelope" aria-hidden="true">↗</div>
    <p className="quant-eyebrow">투자 챌린지</p>
    <h3>{scene.title}</h3>
    <div className="challenge-dialog"><strong>{scene.speaker}</strong><p>{scene.text}</p></div>
    {step === 2 && <>
      <div className="challenge-rules">
        <p><b>20턴마다 결산</b> · 같은 시장에서 같은 기간의 투자수익률을 비교합니다.</p>
        <p><b>상금 = 해당 월 시작 자산 × alpha158 대비 초과수익률</b></p>
        {Number.isFinite(challenge.prizeBase) && <p>현재 시작 예정 자산 {won(challenge.prizeBase)} 으로 1%p 앞서면 {won(challenge.prizeBase * 0.01)}입니다.</p>}
        <p>시작 자산은 현금과 보유자산을 합산해 매달 새로 정합니다. 전월 상금·상환과 월초 급여·생활비도 반영합니다. 동률·패배 시 상금은 없습니다.</p>
        <p>월급·부업비·생활비·상환금·상금 등 투자 외 입출금은 수익률에서 제외합니다.</p>
      </div>
      <p className="quant-footnote">{challenge.canJoin
        ? `${challenge.firstMonth}개월차부터 참가 · 첫 결산 ${challenge.firstMonth * 20}턴. 이후 매달 자동으로 이어집니다.`
        : '이번 게임에는 새로 참가할 수 있는 달이 남아 있지 않습니다.'}</p>
      {!available && <p role="status">alpha158을 준비 중입니다. 준비가 끝나면 참가할 수 있습니다.</p>}
    </>}
    {error && <p role="alert" className="quant-notice">{error}</p>}
    <div className="challenge-actions">
      {step > 0 && <button className="btn-secondary" disabled={busy} onClick={() => setStep(step - 1)}>이전</button>}
      {step < 2 ? <button className="btn-primary" onClick={() => setStep(step + 1)}>계속 읽기 →</button>
        : <button className="btn-primary" disabled={busy || !available || !challenge.canJoin} onClick={onJoin}>
          {busy ? '참가 신청 중…' : '투자 챌린지에 참가한다'}</button>}
      <button className="btn-secondary" disabled={busy} onClick={onLater}>나중에</button>
    </div>
    <button className="challenge-text-button" disabled={busy} onClick={onExplore}>alpha158 먼저 살펴보기</button>
  </section>;
}

export default function QuantChallenge({ challenge, busy, message, error, onClaim, onInvite, onExplore }) {
  if (!challenge?.enrolled) return <section className="challenge-card">
    <h3>투자 챌린지</h3><p>20턴마다 수익률을 비교합니다. alpha158보다 앞선 만큼 상금을 받으세요.</p>
    <button className="btn-primary" onClick={onInvite}>초대장 읽기</button>
  </section>;
  const current = challenge.current;
  const settled = challenge.rounds.find(r => r.month === current.month);
  const shown = settled || current;
  const excess = settled?.excessReturn ?? (Number.isFinite(current.playerReturn) && Number.isFinite(current.quantReturn)
    ? current.playerReturn - current.quantReturn : null);
  return <section className="challenge-panel" aria-label="월간 투자 챌린지">
    <div className="challenge-card">
      <div className="challenge-letterhead"><span>MONTH {String(current.month).padStart(2, '0')}</span>
        <span>{current.state === 'settled' ? '결과 확정' : current.state === 'waiting' ? '참가 대기' : `${current.endTurn}턴 결산`}</span></div>
      <h3>{settled ? `${current.month}개월차 · ${resultLabel[settled.outcome]}`
        : current.state === 'waiting' ? `${challenge.firstMonth}개월차에 경쟁을 시작합니다` : '이번 달 alpha158을 이겨라'}</h3>
      {current.state === 'waiting' ? <p>지금은 상대를 살펴보고 투자를 준비하세요. 첫 결산은 {challenge.firstMonth * 20}턴입니다.</p> : <>
        <p className="quant-footnote">이번 달 상금 기준 자산 <b>{won(shown.prizeBase)}</b> · 현금 + 보유자산 평가액</p>
        <div className="challenge-score">
          <div><span>내 투자수익률</span><strong className={changeClass(shown.playerReturn)}>{rate(shown.playerReturn)}</strong></div>
          <span className="challenge-vs">VS</span>
          <div><span>alpha158 투자수익률</span><strong className={changeClass(shown.quantReturn)}>{rate(shown.quantReturn)}</strong></div>
        </div>
        <div className="challenge-reward"><span>alpha158 대비 <b>{gap(excess)}</b></span>
          <span>{settled ? '확정 상금' : '현재 기준 예상 상금'} <strong>{won(settled?.prize ?? current.estimatedPrize)}</strong></span></div>
        {settled?.prize > 0 && <button className="btn-primary challenge-claim" disabled={busy || settled.claimed || !challenge.canClaim}
          onClick={() => onClaim(settled.month)}>{settled.claimed ? '상금 수령 완료' : !challenge.canClaim ? '게임 종료 · 수령 마감'
            : busy ? '수령 처리 중…' : `${won(settled.prize)} 상금 받기`}</button>}
        {settled?.outcome === 'unavailable' && <p className="quant-notice">{settled.reason === 'nonpositive_capital'
          ? '평가 자산이 0 이하인 구간이 있어 이번 달 수익률을 산정할 수 없습니다.'
          : 'alpha158 운용 기록이 없어 이번 달 결과를 산정할 수 없습니다.'} 이번 달 상금은 지급되지 않습니다.</p>}
        {!settled && <p className="quant-footnote">예상 상금은 결산까지 달라집니다. 두 수익률이 모두 음수여도 alpha158보다 앞서면 상금을 받습니다.</p>}
      </>}
      {message && <p role="status" className="challenge-receipt">{message}</p>}
      {error && <p role="alert" className="quant-notice">{error}</p>}
      <button className="challenge-text-button" onClick={onExplore}>상대의 포트폴리오 살펴보기 →</button>
    </div>
    <details className="challenge-rules"><summary>수익률과 상금은 어떻게 계산하나요?</summary>
      <p>20·40·…·240턴에 도착하면 그날 가격과 주문·자동 이벤트 처리를 반영해 결과를 확정합니다. 첫 달은 1턴 참가 시점부터 비교합니다. 이후에는 직전 결산 시점이 기준입니다.</p>
      <p>내 수익률은 현금과 보유 주식(급등주 포함)을 포함합니다. 월급·부업비·생활비·상환·상금 등 투자 외 입출금 전후를 나누어 계산하고 연결합니다. alpha158은 주식과 현금만 운용하며 상환 의무가 없습니다.</p>
      <p>상금은 해당 월 시작 자산 × 두 수익률의 차이입니다. {Number.isFinite(shown.prizeBase)
        ? `이번 달 기준액은 ${won(shown.prizeBase)}이므로 1%p 앞서면 ${won(shown.prizeBase * 0.01)}입니다.`
        : '참가할 달이 시작될 때 기준액을 확정합니다.'} 원 미만은 버리고 동률·패배는 0원입니다.</p>
      <p>첫 달 기준액은 첫날을 마칠 때의 자산입니다. 다음 달부터는 전월 말 상금 수령·상환을 마친 자산에 월초 급여·생활비를 반영합니다. 새 달의 가격 변동이나 월중 입출금으로 이 기준액을 바꾸지 않습니다.</p>
      <p>결산 뒤의 행동은 다음 달에 반영됩니다. 상금은 게임 종료 전까지 수령할 수 있습니다. 참가 이후에는 매달 자동으로 이어집니다. 투자 원금과 상대의 보유 종목은 월말에 초기화하지 않습니다.</p>
    </details>
    <div className="challenge-history-heading"><h4>월별 경쟁 기록</h4><span>누적 수령 {won(challenge.totalClaimed)}</span></div>
    {challenge.rounds.length === 0 ? <p className="quant-empty">첫 결산을 기다리고 있습니다.</p> :
      <div className="quant-table-wrap"><table className="data-table"><thead><tr>
        <th>월</th><th>기준 자산</th><th>나</th><th>alpha158</th><th>차이</th><th>결과</th><th>상금</th>
      </tr></thead><tbody>{challenge.rounds.map(r => <tr key={r.month}>
        <td>{r.month}개월차</td><td>{won(r.prizeBase)}</td><td>{rate(r.playerReturn)}</td><td>{rate(r.quantReturn)}</td><td>{gap(r.excessReturn)}</td>
        <td>{resultLabel[r.outcome]}</td><td>{r.prize > 0 && !r.claimed && challenge.canClaim
          ? <button className="btn-secondary" disabled={busy} onClick={() => onClaim(r.month)}>{won(r.prize)} 받기</button>
          : `${won(r.prize)}${r.claimed ? ' · 수령 완료' : r.prize > 0 ? ' · 수령 마감' : ''}`}</td>
      </tr>)}</tbody></table></div>}
  </section>;
}
