// Player and quant share execution amounts and fee rules (ARCHITECTURE.md §15).
const { roundTradeAmount } = require('../utils/money');
const C = require('../config/constants');

function quoteTradeAmount(side, price, quantity) {
  if (!['buy', 'sell'].includes(side) || !Number.isFinite(price) || price <= 0 ||
      !Number.isFinite(quantity) || quantity <= 0) throw new Error('유효하지 않은 체결 값입니다');
  return roundTradeAmount(side, price * quantity * (1 + (side === 'buy' ? 1 : -1) * C.TRADE_FEE_RATE));
}

function affordableShares(cash, price) {
  if (!(price > 0) || !(cash > 0)) return 0;
  let shares = Math.floor(cash / (price * (1 + C.TRADE_FEE_RATE)));
  while (shares > 0 && quoteTradeAmount('buy', price, shares) > cash) shares -= 1;
  return shares;
}

// Both actors submit a fixed maximum quantity and cash budget at the prior close.
// A gap up can reduce a fill, but never increase the predeclared cash budget.
function fillOpenOrder(order, { openPrice, cash, heldQuantity = 0, avgPrice = 0 }) {
  const rejected = (reason) => ({ status: 'rejected', reason, filledQuantity: 0, price: null, amount: 0, realizedPnl: null });
  if (!Number.isFinite(openPrice) || openPrice <= 0) return rejected('no_open_price');
  const quantity = order.side === 'buy'
    ? Math.min(Number(order.quantity), affordableShares(Math.min(cash, Number(order.cashBudget)), openPrice))
    : Math.min(Number(order.quantity), heldQuantity);
  if (!(quantity > 0)) return rejected(order.side === 'buy' ? 'insufficient_cash' : 'insufficient_holdings');
  return { status: quantity < Number(order.quantity) ? 'partial' : 'filled',
    reason: quantity < Number(order.quantity) ? 'unfilled_remainder_cancelled' : null,
    filledQuantity: quantity, price: openPrice, amount: quoteTradeAmount(order.side, openPrice, quantity),
    realizedPnl: order.side === 'sell' ? quoteTradeAmount('sell', openPrice, quantity) - avgPrice * quantity : null };
}

module.exports = { quoteTradeAmount, affordableShares, fillOpenOrder };
