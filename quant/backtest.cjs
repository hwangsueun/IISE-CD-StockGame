// Uses exactly the runtime's order amounts, rebalance dates and valuation.
const fs = require('node:fs');
const path = require('node:path');
const { replayQuant } = require('../server/src/services/quantReplay');
const inputFile = process.argv[2];
if (!inputFile) throw new Error('Usage: node quant/backtest.cjs MODEL_FOLDER/backtest_input.json');
const input = JSON.parse(fs.readFileSync(inputFile));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const results = {};
for (const [name, artifact] of Object.entries(input.strategies)) {
  const result = replayQuant({ ...input, artifact });
  const history = result.history;
  const returns = history.slice(1).map((row, i) => row.totalAsset / history[i].totalAsset - 1);
  const avg = mean(returns);
  const std = Math.sqrt(returns.reduce((sum, r) => sum + (r - avg) ** 2, 0) / (returns.length - 1));
  let peak = input.initialCash;
  let mdd = 0;
  for (const h of history) { peak = Math.max(peak, h.totalAsset); mdd = Math.min(mdd, h.totalAsset / peak - 1); }
  const years = (Date.parse(history.at(-1).date) - Date.parse(history[0].date)) / (365.25 * 86400000);
  const turnover = result.trades.reduce((sum, trade) => sum + trade.amount / history[trade.turn - 1].totalAsset, 0) / 2;
  results[name] = { net_return: result.returnRate, cagr: (1 + result.returnRate) ** (1 / years) - 1,
                   sharpe_weekday_260: std > 0 ? avg / std * Math.sqrt(260) : null, mdd,
                   turnover_one_way: turnover, trades: result.trades.length, cash: result.cash,
                   final_asset: result.totalAsset };
}
const report = { from: input.turns[0].trade_date, to: input.turns.at(-1).trade_date,
  model: 'lgb-20220101 frozen throughout test',
  policies: Object.fromEntries(Object.entries(input.strategies).map(([name, a]) => [name, {
    top_k: a.top_k, rebalance_turns: a.rebalance_turns, strategy: a.strategy || 'equal_weight_rebalance',
    n_drop: a.n_drop ?? null, label_horizon: a.label_horizon || { unit: 'weekdays', value: 120 },
    execution:a.execution, label_price:a.label_price||'close',
  }])),
  fee_rate: require('../server/src/config/constants').TRADE_FEE_RATE, tax_rate: 0, slippage_rate: 0,
  scope: 'Historical diagnostic on the supplied game universe; 2022-2023 was already inspected for earlier versions and is not a fresh holdout. No tuning based on this test.',
  limitations: input.strategies.frozen_alpha158.limitations,
  baseline_note: 'No existing Alpha+Momentum strategy found in checkout; momentum60 is a separate simple control. V3 equal_weight allocates initially and holds; vacant slots may be filled later, but existing holdings are not rebalanced.', results };
fs.writeFileSync(path.join(path.dirname(inputFile), 'backtest.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
