// Deterministic read-only replay. Clicking the button never places player orders.
const { quoteTradeAmount, affordableShares } = require('./executionService');

function validateArtifact(artifact) {
  const common = Array.isArray(artifact.models) && artifact.sessions &&
    Number.isInteger(artifact.top_k) && artifact.top_k > 0;
  // Version 1 is immutable: never turn its 120-turn trained scores into daily signals.
  const legacy = artifact.schema_version === 1 && artifact.rebalance_turns === 120 &&
    (!artifact.strategy || artifact.strategy === 'equal_weight_rebalance');
  const daily = artifact.schema_version === 2 && artifact.strategy === 'topk_dropout' &&
    artifact.rebalance_turns === 1 && artifact.label_horizon?.unit === 'market_sessions' &&
    artifact.label_horizon?.value === 1 && Number.isInteger(artifact.n_drop) &&
    artifact.n_drop > 0 && artifact.n_drop <= artifact.top_k;
  const open = artifact.schema_version === 3 && artifact.execution === 'next_market_open' && artifact.label_price === 'open' &&
    artifact.strategy === 'topk_dropout' && artifact.rebalance_turns === 1 && artifact.label_horizon?.unit === 'market_sessions' &&
    artifact.label_horizon?.value === 1 && Number.isInteger(artifact.n_drop) && artifact.n_drop>0 && artifact.n_drop<=artifact.top_k;
  if (!common || (!legacy && !daily && !open)) throw new Error('퀀트 모델 파일 형식·학습 기간·운용 주기가 올바르지 않습니다');
}

function replayQuant(input) {
  if(input.artifact.schema_version===3)return require('./quantOpenReplay').replayOpenQuant(input);
  const { turns, prices, assets, artifact, initialCash } = input;
  const dropout = artifact.strategy === 'topk_dropout';
  const holdings = new Map();
  const lastPrices = new Map();
  const byDate = new Map();
  for (const row of prices) {
    if (!byDate.has(row.trade_date)) byDate.set(row.trade_date, new Map());
    byDate.get(row.trade_date).set(row.asset_id, Number(row.close_price));
  }
  const assetMap = new Map(assets.map((a) => [a.asset_id, a]));
  const modelMap = new Map(artifact.models.map((m) => [m.id, m]));
  let cash = initialCash;
  let cycle = -1;
  let pending = false;
  let decision = null;
  const trades = [];
  const history = [];
  const decisions = [];
  for (const turn of turns) {
    const date = turn.trade_date;
    const dailyPrices = byDate.get(date) || new Map();
    const cycleIndex = Math.floor((turn.turn_number - 1) / artifact.rebalance_turns);
    if (cycleIndex !== cycle) { cycle = cycleIndex; pending = true; }
    const sell = (id, price, reason) => {
      const held = holdings.get(id);
      const amount = quoteTradeAmount('sell', price, held.quantity);
      cash += amount;
      trades.push({ turn: turn.turn_number, assetId: id, side: 'sell', quantity: held.quantity, price, amount, reason });
      holdings.delete(id);
    };
    for (const [id, held] of holdings) {
      const asset = assetMap.get(id);
      // Same final available-price convention as player delisting; no future prices.
      if (asset?.listed_to && date > asset.listed_to) sell(id, lastPrices.get(id) || held.avgPrice, 'delisted');
    }
    for (const [id, price] of dailyPrices) if (price > 0) lastPrices.set(id, price);
    if (pending && dailyPrices.size > 0) {
      const signal = artifact.sessions[date];
      pending = false;
      if (!signal) {
        decision = { status: 'no_signal', turn: turn.turn_number, date, selections: [] };
      } else {
        const model = modelMap.get(signal.model_id);
        if (!model || signal.signal_date >= date || model.trained_through >= signal.signal_date ||
            model.available_from > signal.signal_date) throw new Error('퀀트 모델의 학습·예측 날짜가 올바르지 않습니다');
        const previous = byDate.get(signal.signal_date);
        // An artifact for a different price history must never silently trade in this game.
        for (const [id, , sourceClose] of signal.ranking) {
          const dbClose = previous?.get(id);
          if (assetMap.has(id) && (!dbClose || Math.abs(dbClose - sourceClose) > .01)) {
            throw new Error('퀀트 데이터와 게임 시세가 일치하지 않습니다');
          }
        }
        const eligible = signal.ranking.filter(([id, score]) => {
          const a = assetMap.get(id);
          return a && a.is_active !== false && Number.isFinite(score) && dailyPrices.get(id) > 0 &&
            (!a.listed_from || date >= a.listed_from) && (!a.listed_to || date <= a.listed_to);
        });
        const ranked = eligible.slice(0, artifact.top_k);
        let selections;
        if (dropout) {
          const scores = new Map(signal.ranking.map(([id, score]) => [id, score]));
          const wasHeld = new Set(holdings.keys());
          // Qlib's top/bottom dropout: compare holdings with at most n_drop new
          // challengers (plus empty slots), then sell held names in the bottom n_drop.
          // Equal scores retain existing names; asset ID breaks remaining ties.
          const scoreOrder = (a, b) => (scores.get(b) ?? -Infinity) - (scores.get(a) ?? -Infinity) ||
            Number(wasHeld.has(b)) - Number(wasHeld.has(a)) || a.localeCompare(b);
          const candidates = eligible.filter(([id]) => !wasHeld.has(id))
            .slice(0, artifact.n_drop + Math.max(0, artifact.top_k - holdings.size)).map(([id]) => id);
          const combined = [...holdings.keys(), ...candidates].sort(scoreOrder);
          if (candidates.length) {
            for (const id of combined.slice(-artifact.n_drop)) {
              if (holdings.has(id) && dailyPrices.get(id) > 0) sell(id, dailyPrices.get(id), 'dropout');
            }
          }
          const buys = candidates.slice(0, Math.max(0, artifact.top_k - holdings.size));
          const budget = buys.length ? cash / buys.length : 0;
          for (const id of buys) {
            const price = dailyPrices.get(id);
            const quantity = affordableShares(Math.min(cash, budget), price);
            if (!quantity) continue;
            const amount = quoteTradeAmount('buy', price, quantity);
            cash -= amount;
            holdings.set(id, { quantity, avgPrice: price, score: scores.get(id) });
            trades.push({ turn: turn.turn_number, assetId: id, side: 'buy', quantity, price, amount, reason: 'dropout' });
          }
          const equity = cash + [...holdings].reduce((sum, [id, h]) =>
            sum + h.quantity * (lastPrices.get(id) || h.avgPrice), 0);
          const ranks = new Map(signal.ranking.map(([id], i) => [id, i + 1]));
          selections = [...holdings.keys()].sort(scoreOrder).map((id) => {
            const held = holdings.get(id);
            held.score = scores.get(id) ?? null;
            return { assetId: id, name: assetMap.get(id).masked_name || '이름 미등록',
              rank: ranks.get(id) ?? null, score: held.score, targetWeight: null,
              weight: held.quantity * (lastPrices.get(id) || held.avgPrice) / equity,
              action: wasHeld.has(id) ? 'held' : 'bought' };
          });
        } else if (ranked.length) {
          // Keep unavailable held names until an actual price permits selling; use only cash for new buys.
          for (const [id] of holdings) if (dailyPrices.get(id) > 0) sell(id, dailyPrices.get(id), 'rebalance');
          const budget = cash / ranked.length;
          for (const [id, score] of ranked) {
            if (holdings.has(id)) continue;
            const price = dailyPrices.get(id);
            const quantity = affordableShares(Math.min(cash, budget), price);
            if (!quantity) continue;
            const amount = quoteTradeAmount('buy', price, quantity);
            cash -= amount;
            holdings.set(id, { quantity, avgPrice: price, score });
            trades.push({ turn: turn.turn_number, assetId: id, side: 'buy', quantity, price, amount, reason: 'rebalance' });
          }
        }
        decision = { status: ranked.length ? 'ready' : 'no_eligible_stocks', turn: turn.turn_number, date,
                     signalDate: signal.signal_date, modelId: signal.model_id,
                     trainedThrough: model.trained_through,
                     selections: selections || ranked.map(([id, score], i) => ({ assetId: id, name: assetMap.get(id).masked_name || '이름 미등록',
                       rank: i + 1, score, targetWeight: 1 / ranked.length })) };
      }
      decisions.push(decision);
    }
    const totalAsset = cash + [...holdings].reduce((sum, [id, h]) => sum + h.quantity * (lastPrices.get(id) || h.avgPrice), 0);
    history.push({ turn: turn.turn_number, date, totalAsset, cash, returnRate: totalAsset / initialCash - 1 });
  }
  const latest = history.at(-1);
  return { status: decision?.status || 'waiting', decision, decisions, cash, totalAsset: latest?.totalAsset ?? initialCash,
           initialCash, returnRate: latest?.returnRate ?? 0,
           rebalancePending: pending,
           nextRebalanceTurn: (cycle + (pending ? 0 : 1)) * artifact.rebalance_turns + 1,
           holdings: [...holdings].map(([id, h]) => {
             const price = lastPrices.get(id) || h.avgPrice;
             return { assetId: id, name: assetMap.get(id)?.masked_name || '이름 미등록', ...h,
                      price, value: price * h.quantity, weight: price * h.quantity / latest.totalAsset,
                      returnRate: price / h.avgPrice - 1 };
           }), history, trades };
}

module.exports = { replayQuant, validateArtifact };
