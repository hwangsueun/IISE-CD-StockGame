export const ORDER_REASONS = {
  investment_locked_hospital: '입원으로 투자 중단',
  investment_locked_side_job: '부업으로 당일 투자 중단',
  investment_locked_stress: '스트레스 한계로 투자 중단',
  model_automation_stopped: '모델 자동 투자 해제',
  no_open_price: '시가 없음',
  stock_only: '주식 전용으로 변경',
  invalid_quantity: '잘못된 수량',
  order_budget_exceeded: '시가가 주문 예산을 초과함',
  // Older orders used this reason for both account cash and the reserved budget.
  insufficient_cash: '매수 가능 금액 부족',
  insufficient_holdings: '보유 부족',
  user_cancelled: '직접 취소',
  game_ended: '게임 종료',
  unfilled_remainder_cancelled: '남은 수량 취소',
};

// The API returns newest orders first. Automatic orders must not replace the
// manual purchase the first-day tutorial is explaining.
export function latestManualBuy(orders) {
  return orders.find((order) => order.tradeType === 'buy' && !order.strategyVersionId) || null;
}

export function tutorialBuySummary(order) {
  if (!order) return '예약한 매수의 처리 결과를 [주문 내역]에서 확인하자.';
  if (order.status === 'pending') return '매수 주문이 대기 중이다. 다음 개장일에 주문 예산 안에서 체결한다.';
  if (order.status === 'filled') return `매수 주문 ${order.filledQuantity}주가 체결됐다.`;
  if (order.status === 'partial') return `${order.quantity}주 중 ${order.filledQuantity}주가 체결됐다. 남은 수량은 취소됐다.`;
  if (order.status === 'rejected' && order.reason === 'order_budget_exceeded') {
    return '시가가 주문 예산을 넘어 매수하지 못했다. 계좌에 현금이 있어도 예약한 예산을 넘겨 쓰지는 않는다.';
  }
  const reason = ORDER_REASONS[order.reason];
  if (order.status === 'rejected') return `매수가 체결되지 않았다.${reason ? ` 사유: ${reason}.` : ' [주문 내역]에서 사유를 확인하자.'}`;
  if (order.status === 'cancelled') return `매수 주문이 취소됐다.${reason ? ` 사유: ${reason}.` : ''}`;
  return '예약한 매수의 처리 결과를 [주문 내역]에서 확인하자.';
}
