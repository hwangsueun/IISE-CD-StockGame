// Player and quant share execution amounts and fee rules (ARCHITECTURE.md §15).
const { roundTradeAmount } = require('../utils/money');
const C = require('../config/constants');

const EXECUTION_RULES = Object.freeze({ stock: 'next_market_open', bond: 'next_turn_price', coin: 'next_turn_price' });
const COIN_SCALE = 100000000;

function validQuantity(quantity, assetType) {
  if (!Number.isFinite(quantity) || quantity <= 0) return false;
  return assetType === 'coin'
    ? Number.isSafeInteger(Math.round(quantity * COIN_SCALE)) && Number(quantity.toFixed(8)) === quantity
    : Number.isSafeInteger(quantity);
}

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
  return fillPriceOrder(order, { price: openPrice, cash, heldQuantity, avgPrice, missingReason: 'no_open_price' });
}

// Daily bond/coin observations are execution prices, never fabricated stock opens.
function fillPriceOrder(order, { price, cash, heldQuantity = 0, avgPrice = 0, assetType = 'stock', missingReason = 'no_price' }) {
  const rejected = (reason) => ({ status: 'rejected', reason, filledQuantity: 0, price: null, amount: 0, realizedPnl: null });
  if (!Number.isFinite(price) || price <= 0) return rejected(missingReason);
  const budget = Math.min(cash, Number(order.cashBudget));
  let quantity;
  if (assetType === 'coin') {
    let units = Math.round(Number(order.quantity) * COIN_SCALE);
    if (order.side === 'buy') {
      // Search integer 1e-8 units using the actual rounded KRW charge. This avoids
      // fractional precision errors and never spends more than the fixed budget.
      let low = 0, high = units;
      while (low < high) {
        const mid = low + Math.ceil((high - low) / 2);
        if (quoteTradeAmount('buy', price, mid / COIN_SCALE) <= budget) low = mid;
        else high = mid - 1;
      }
      units = low;
    } else units = Math.min(units, Math.round(heldQuantity * COIN_SCALE));
    quantity = units / COIN_SCALE;
  } else quantity = order.side === 'buy'
    ? Math.min(Number(order.quantity), affordableShares(budget, price))
    : Math.min(Number(order.quantity), heldQuantity);
  if (!(quantity > 0)) return rejected(order.side === 'buy' ? 'insufficient_cash' : 'insufficient_holdings');
  return { status: quantity < Number(order.quantity) ? 'partial' : 'filled',
    reason: quantity < Number(order.quantity) ? 'unfilled_remainder_cancelled' : null,
    filledQuantity: quantity, price, amount: quoteTradeAmount(order.side, price, quantity),
    realizedPnl: order.side === 'sell' ? quoteTradeAmount('sell', price, quantity) - avgPrice * quantity : null };
}

module.exports = { quoteTradeAmount, affordableShares, fillOpenOrder, fillPriceOrder, validQuantity, EXECUTION_RULES, COIN_SCALE };
