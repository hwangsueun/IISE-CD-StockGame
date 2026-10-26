import test from 'node:test';
import assert from 'node:assert/strict';
import { ORDER_REASONS, latestManualBuy, tutorialBuySummary } from '../src/utils/orderPresentation.js';

test('budget-limited orders do not tell a cash-rich player that their account has insufficient cash', () => {
  const message = tutorialBuySummary({ status: 'rejected', reason: 'order_budget_exceeded' });
  assert.match(ORDER_REASONS.order_budget_exceeded, /주문 예산/);
  assert.match(message, /매수하지 못했다/);
  assert.match(message, /계좌에 현금이 있어도/);
  assert.doesNotMatch(message, /현금 부족|체결됐다/);
  assert.match(tutorialBuySummary({ status: 'rejected', reason: 'insufficient_cash' }), /매수 가능 금액 부족/);
});

test('tutorial distinguishes pending, cancelled, rejected, partially filled and filled buys', () => {
  assert.match(tutorialBuySummary({ status: 'pending' }), /대기 중/);
  assert.match(tutorialBuySummary({ status: 'cancelled', reason: 'user_cancelled' }), /직접 취소/);
  assert.match(tutorialBuySummary({ status: 'cancelled', reason: 'investment_locked_hospital' }), /입원/);
  assert.match(tutorialBuySummary({ status: 'rejected', reason: 'no_open_price' }), /시가 없음/);
  assert.match(tutorialBuySummary({ status: 'partial', quantity: 10, filledQuantity: 8 }), /10주 중 8주/);
  assert.match(tutorialBuySummary({ status: 'filled', quantity: 1, filledQuantity: 1 }), /1주가 체결됐다/);
  for (const order of [null, { status: 'unknown' }, { status: 'rejected' }]) {
    assert.match(tutorialBuySummary(order), /주문 내역/);
    assert.doesNotMatch(tutorialBuySummary(order), /체결됐다/);
  }
});

test('tutorial uses the newest manual buy rather than later automatic orders or sell reservations', () => {
  const buy = { orderId: 2, tradeType: 'buy', status: 'rejected', reason: 'order_budget_exceeded' };
  assert.equal(latestManualBuy([
    { orderId: 4, tradeType: 'buy', strategyVersionId: 'auto' },
    { orderId: 3, tradeType: 'sell' },
    buy,
    { orderId: 1, tradeType: 'buy' },
  ]), buy);
  assert.equal(latestManualBuy([]), null);
});
