// Chain investment returns between external cash flows (time-weighted return).
// Deposits/withdrawals reset the reference asset, never create investment profit.
function investmentReturn(state, totalAsset) {
  const reference = Number(state.reference_asset);
  if (state.invalid_period || reference <= 0 || !Number.isFinite(totalAsset) || totalAsset <= 0) return null;
  const value = Number(state.performance_factor) * totalAsset / reference - 1;
  return Number.isFinite(value) ? value : null;
}

function applyFlow(state, beforeAsset, amount) {
  const rate = investmentReturn(state, beforeAsset);
  const afterAsset = beforeAsset + amount;
  return {
    factor: rate === null ? 1 : rate + 1,
    reference: afterAsset,
    invalid: rate === null || beforeAsset <= 0 || afterAsset <= 0,
  };
}

function scoreRound(playerReturn, quantReturn, prizeBase) {
  if (!Number.isFinite(playerReturn) || !Number.isFinite(quantReturn) || !Number.isFinite(prizeBase) || prizeBase <= 0) {
    return { outcome: 'unavailable', excess: null, prize: 0 };
  }
  // Stabilize equality and integer-won prizes against floating point noise.
  const excess = Math.round((playerReturn - quantReturn) * 1e10) / 1e10;
  return { outcome: excess > 0 ? 'win' : excess < 0 ? 'loss' : 'tie', excess,
    prize: Math.floor(Math.max(0, excess) * prizeBase + 1e-7) };
}

function firstEligibleMonth(turn) {
  return turn === 1 ? 1 : Math.ceil(turn / 20) + 1;
}

module.exports = { investmentReturn, applyFlow, scoreRound, firstEligibleMonth };
