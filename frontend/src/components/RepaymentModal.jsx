// 월말 상환 모달 (§10, 기획서 §7 월말 상환 플로우)
import { useState } from 'react';
import { useGameStore } from '../state/gameStore';
import Modal from './Modal';
import { won } from '../utils/format';

export default function RepaymentModal() {
  const { state, turn, repay, closeModal } = useGameStore();
  const [amount, setAmount] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const due = Math.ceil((state?.debtInitial ?? state?.debt ?? 0) / 12);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      setResult(await repay(Number(amount) || 0));
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <Modal title="상환 결과">
        <p>{won(result.paidAmount)} 상환 (요구액 {won(result.dueAmount)})</p>
        <p>
          {result.ratio >= 1.5 ? '스스로에게 칭찬을 보냈다. 마음이 한결 가볍다.'
            : result.ratio >= 1 ? '이번 달 상환을 정확히 마쳤다.'
            : '사채업자의 독촉 연락이 올 것 같다...'}
        </p>
        <dl className="info-list">
          <div><dt>남은 부채</dt><dd>{won(result.debtRemaining)}</dd></div>
          <div><dt>신뢰도 변화</dt><dd>{result.trustDelta > 0 ? '+' : ''}{result.trustDelta}</dd></div>
          <div><dt>스트레스 변화</dt><dd>{result.stressDelta > 0 ? '+' : ''}{result.stressDelta}</dd></div>
        </dl>
        {result.status === 'success' && <p>🎉 전액 상환! 게임 클리어!</p>}
        <button className="btn-primary" onClick={closeModal}>확인</button>
      </Modal>
    );
  }

  return (
    <Modal title={`${turn.monthIndex}개월차 상환`}>
      <dl className="info-list">
        <div><dt>남은 부채</dt><dd>{won(state?.debt)}</dd></div>
        <div><dt>이번 달 요구액</dt><dd>{won(due)}</dd></div>
        <div><dt>보유 현금</dt><dd>{won(state?.cash)}</dd></div>
      </dl>
      <label className="field">
        상환액
        <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <div className="quick-buttons">
        <button onClick={() => setAmount(String(due))}>요구액</button>
        <button onClick={() => setAmount(String(Math.min(state?.cash ?? 0, state?.debt ?? 0)))}>최대</button>
      </div>
      <button className="btn-primary" disabled={submitting} onClick={submit}>
        {submitting ? '처리 중...' : '상환하기'}
      </button>
      {error && <p className="error-text">{error}</p>}
    </Modal>
  );
}
