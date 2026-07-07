// 매수/매도 모달: 수량 입력 -> 예상 금액 -> 확정 (§10)
// 금액 계산은 표시용. 실제 체결가/검증은 서버가 수행한다.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useGameStore } from '../state/gameStore';
import Modal from './Modal';
import { won } from '../utils/format';

export default function TradeModal({ assetId, tradeType: initialType = 'buy' }) {
  const { turn, trade, closeModal } = useGameStore();
  const [tradeType, setTradeType] = useState(initialType);
  const [quantity, setQuantity] = useState('');
  const [detail, setDetail] = useState(null);
  const [holding, setHolding] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  useEffect(() => {
    api.getAssetDetail(assetId, turn.date).then(setDetail).catch(console.error);
    // 보유수량 표시 (매도 한도)
    api.getPortfolio(useGameStore.getState().sessionId).then((p) => {
      setHolding(p.holdings.find((h) => h.assetId === assetId) || null);
    }).catch(console.error);
  }, [assetId, turn.date]);

  const qty = Number(quantity) || 0;
  const isCoin = detail?.assetType === 'coin';
  const estAmount = detail?.price ? detail.price * qty : 0;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const r = await trade(assetId, tradeType, qty);
      setDone(r);
    } catch (e) {
      setError(e.detail ? `${e.message} (${JSON.stringify(e.detail)})` : e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <Modal title="체결 완료">
        <p>{tradeType === 'buy' ? '매수' : '매도'} {done.quantity}주 × {won(done.price)} = {won(done.amount)}</p>
        {done.realizedPnl !== null && <p>실현손익: {won(done.realizedPnl)}</p>}
        <p>남은 현금: {won(done.cash)}</p>
        <button className="btn-primary" onClick={closeModal}>확인</button>
      </Modal>
    );
  }

  return (
    <Modal title={`${detail?.name || ''} 거래`}>
      <div className="filter-bar">
        <button className={tradeType === 'buy' ? 'active' : ''} onClick={() => setTradeType('buy')}>매수</button>
        <button className={tradeType === 'sell' ? 'active' : ''} onClick={() => setTradeType('sell')}>매도</button>
      </div>

      <dl className="info-list">
        <div><dt>현재가</dt><dd>{won(detail?.price)}</dd></div>
        <div><dt>보유수량</dt><dd>{holding ? holding.quantity : 0}</dd></div>
        {holding && <div><dt>평균단가</dt><dd>{won(holding.avgPrice)}</dd></div>}
      </dl>

      <label className="field">
        수량 {isCoin ? '(소수 가능)' : '(정수)'}
        <input
          type="number"
          min="0"
          step={isCoin ? 'any' : '1'}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </label>
      <p className="est-amount">예상 {tradeType === 'buy' ? '매수' : '매도'}금액: <b>{won(estAmount)}</b></p>

      <button className="btn-primary" disabled={submitting || qty <= 0} onClick={submit}>
        {submitting ? '처리 중...' : `${tradeType === 'buy' ? '매수' : '매도'} 확정`}
      </button>
      {error && <p className="error-text">{error}</p>}
    </Modal>
  );
}
