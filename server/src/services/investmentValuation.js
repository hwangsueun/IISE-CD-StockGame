// The return shown beside holdings uses their remaining purchase cost, not cash.
// Fees and realized gains belong to the separate account-performance ledger.
class InvestmentValuation {
  constructor(holdings) {
    this.cost = 0;
    this.value = 0;
    this.available = true;
    for (const holding of holdings) {
      const { quantity, avgPrice, value } = holding;
      if (![quantity, avgPrice, value].every(Number.isFinite) || quantity < 0 || avgPrice <= 0 || value < 0) {
        this.available = false;
        continue;
      }
      this.cost += quantity * avgPrice;
      this.value += value;
    }
  }

  toJSON() {
    const cost = this.available ? this.cost : null;
    const value = this.available ? this.value : null;
    const unrealizedPnl = this.available ? value - cost : null;
    return { cost, value, unrealizedPnl,
      returnRate: cost > 0 ? unrealizedPnl / cost : null };
  }
}

module.exports = { InvestmentValuation };
