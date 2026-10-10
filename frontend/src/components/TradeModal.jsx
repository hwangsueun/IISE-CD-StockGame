// 매수/매도 모달: 수량 입력 -> 예상 금액 -> 확정 (§10)
// 금액 계산은 표시용. 실제 체결가/검증은 서버가 수행한다.
import { useEffect, useRef, useState } from 'react';
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
  const orderKey=useRef(crypto.randomUUID());

  useEffect(() => {
    api.getAssetDetail(assetId, turn.date).then(setDetail).catch(console.error);
    // 보유수량 표시 (매도 한도)
    api.getPortfolio(useGameStore.getState().sessionId).then((p) => {
      setHolding(p.holdings.find((h) => h.assetId === assetId) || null);
    }).catch(console.error);
  }, [assetId, turn.date]);

  const qty = Number(quantity) || 0;
  const isCoin = detail?.assetType === 'coin';
  const isStock = detail?.assetType === 'stock';
  const executionLabel = isStock ? '다음 개장일 시가로' : '다음 턴 가격으로';
  const unit = isCoin ? '개' : isStock ? '주' : '좌';
  const stockHoliday = isStock && turn.marketOpen === false;
  const estAmount = detail?.price ? detail.price * qty : 0;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const r = await trade(assetId, tradeType, qty,orderKey.current);
      setDone(r);
    } catch (e) {
      setError(e.detail ? `${e.message} (${JSON.stringify(e.detail)})` : e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <Modal title="주문 예약 완료">
        <p>{tradeType === 'buy' ? '매수' : '매도'} {done.quantity}{unit}를 예약했습니다.</p>
        <p>NEXT TURN 이후 {executionLabel} 체결됩니다. 아직 현금과 보유 수량은 바뀌지 않았습니다.</p>
        {tradeType === 'buy' && <p>최대 매수 예산: {won(done.cashBudget)}</p>}
        <p>포트폴리오의 주문 내역에서 체결 전 취소할 수 있습니다.</p>
        <button className="btn-primary" onClick={closeModal}>확인</button>
      </Modal>
    );
  }

  return (
    <Modal title={`${detail?.name || ''} 거래`}>
      {stockHoliday && (
        <p className="market-closed-note">오늘은 주식 휴장일이라 주식 주문을 예약할 수 없습니다.</p>
      )}
      <p>현재 정보로 주문을 예약하고, {executionLabel} 체결합니다.</p>
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
        수량 {isCoin ? '(소수점 8자리까지)' : '(정수)'}
        <input
          type="number"
          min="0"
          step={isCoin ? '0.00000001' : '1'}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </label>
      <p className="est-amount">현재 가격 기준 예상 금액: <b>{won(tradeType === 'buy' ? Math.ceil(estAmount) : Math.floor(estAmount))}</b></p>
      <p className="quant-footnote">매수 예산은 예약 시 고정됩니다. 체결 가격이 오르거나 현금이 줄면 가능한 수량만 체결합니다. {isStock ? '개장일에 해당 종목의 시가가' : '다음 턴에 해당 자산의 가격이'} 없으면 미체결 처리됩니다.</p>

      <button className="btn-primary" disabled={!detail?.orderSupported || !(detail?.price > 0) || turn.turnNumber>=240 || stockHoliday || submitting || !Number.isFinite(qty) || qty <= 0} onClick={submit}>
        {submitting ? '처리 중...' : `${tradeType === 'buy' ? '매수' : '매도'} 예약`}
      </button>
      {error && <p className="error-text">{error}</p>}
    </Modal>
  );
}
