export const strategySignature = value => JSON.stringify(value, function (_key, v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v;
});
export function restoreStrategyDraft(raw, blank, features) {
  try {
    const c = JSON.parse(raw), allowed = new Set(features.map(f => f.id));
    if (!c || c.schemaVersion !== 1 || typeof c.name !== 'string' || typeof c.hypothesis !== 'string' ||
      !['conditions', 'score', 'ridge', 'tree', 'randomForest', 'lightgbm', 'xgboost'].includes(c.method) || !Array.isArray(c.terms) || c.terms.length > 12 ||
      !Array.isArray(c.conditions) || c.conditions.length > 8 ||
      !c.terms.every(t => t && allowed.has(t.feature) && Number.isFinite(t.weight)) ||
      !c.conditions.every(r => r && allowed.has(r.feature) && ['raw', 'rank'].includes(r.measure) && ['gte', 'lte'].includes(r.op) && Number.isFinite(r.value))) return blank;
    if (c.riskAssets !== undefined && (!Array.isArray(c.riskAssets) || c.riskAssets.length > 5 || c.riskAssets.some(id => typeof id !== 'string'))) return blank;
    return { ...blank, ...c };
  } catch { return blank; }
}
