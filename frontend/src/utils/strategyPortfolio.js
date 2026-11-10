// Saved reports may predate the detailed history field. Keep missing data
// distinct from a real empty portfolio or a zero balance.
export class StrategyPortfolioSnapshot {
  constructor(report) {
    this.report = report;
  }

  get available() {
    return Array.isArray(this.report.holdings) && Number.isFinite(this.report.cash) &&
      Number.isFinite(this.report.totalAsset);
  }

  get cashWeight() {
    return this.report.totalAsset > 0 ? this.report.cash / this.report.totalAsset : null;
  }

  get holdings() {
    return (this.report.holdings || []).map(holding => {
      const cost = holding.avgPrice * holding.quantity;
      return {
        ...holding,
        price: holding.quantity > 0 ? holding.value / holding.quantity : null,
        weight: this.report.totalAsset > 0 ? holding.value / this.report.totalAsset : null,
        profit: Number.isFinite(cost) ? holding.value - cost : null,
        returnRate: cost > 0 ? holding.value / cost - 1 : null,
      };
    });
  }

  get history() {
    return Array.isArray(this.report.history) ? this.report.history : null;
  }
}
