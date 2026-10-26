const { Worker } = require('node:worker_threads');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { query, withTransaction } = require('../db');
const { badRequest, notFound, conflict, ApiError } = require('../utils/errors');
const { validateConfig } = require('../strategy/engine');
const { features, references, template } = require('../strategy/catalog');
const { loadArtifact } = require('./quantService');
const { capabilities } = require('../strategy/nativeModels');
const C = require('../config/constants');
const { withModelWork } = require('./modelWorkGate');
const activeSessions = new Set();
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function configOf(input) { try { return validateConfig(input); } catch (e) { throw badRequest(e.message); } }
async function snapshot(sessionId) {
  if (!uuid(sessionId)) throw badRequest('게임 식별자가 올바르지 않습니다.');
  const { rows: [s] } = await query(`SELECT s.*,t.trade_date FROM game_sessions s JOIN game_turns t
    ON t.session_id=s.id AND t.turn_number=s.current_turn WHERE s.id=$1`, [sessionId]);
  if (!s) throw notFound('게임을 찾을 수 없습니다.');
  return s;
}
function minusYears(date, years) { const d = new Date(`${date}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() - years); return d.toISOString().slice(0, 10); }
async function inputs(s, from = minusYears(s.trade_date, 4), client = { query }) {
  const q=(text,params)=>client.query(text,params);
  const results = [
    await q(`SELECT asset_id,masked_name,listed_from,listed_to,is_active FROM assets WHERE asset_type='stock' ORDER BY asset_id`),
    await q(`SELECT p.asset_id,p.trade_date,p.close_price,d.open_price,d.adjusted_volume,d.amount,d.high_price,d.low_price FROM asset_prices p
      JOIN assets a USING(asset_id) LEFT JOIN stock_price_detail d ON d.asset_id=p.asset_id AND d.trade_date=p.trade_date
      WHERE a.asset_type='stock' AND p.trade_date >= $1 AND p.trade_date <= $2 ORDER BY p.trade_date,p.asset_id`, [from, s.trade_date]),
    await q(`SELECT trade_date,value FROM macro_daily WHERE indicator_code='kospi' AND trade_date >= $1 AND trade_date <= $2 ORDER BY trade_date`, [from, s.trade_date]),
  ];
  const quant = loadArtifact();
  // Every game/observation and practice has at most 240 weekdays. Share the
  // corresponding pinned signals, not a second parsed copy of ten years.
  const comparisonFrom = require('../strategy/engine').weekdays(minusYears(s.trade_date, 1), s.trade_date).slice(-C.TOTAL_TURNS)[0];
  const quantArtifact = quant ? { ...quant.artifact, sessions: Object.fromEntries(Object.entries(quant.artifact.sessions)
    .filter(([date]) => date >= comparisonFrom && date <= s.trade_date)) } : null;
  return { assets: results[0].rows, prices: results[1].rows, benchmark: results[2].rows, asOf: s.trade_date,
    initialCash: Number(s.initial_cash), quantFile: quant?.file, quantSha: quant?.sha || null, quantArtifact, sourceFrom: from };
}
function run(input) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.resolve(__dirname, '../strategy/worker.js'), { workerData: input });
    let settled = false;
    const finish = async (error, result) => {
      if (settled) return; settled = true; clearTimeout(timer);
      // A timed-out worker can still own its native child. Keep the shared slot
      // until the worker has exited so the next model cannot overlap its memory.
      try { await worker.terminate(); } catch (terminationError) { error ||= terminationError; }
      error ? reject(error) : resolve(result);
    };
    // Saved comparisons run 2–4 independently trained models in sequence. Keep
    // the existing per-model allowance and a hard eight-minute request ceiling.
    const count = input.mode === 'compareSaved' && Array.isArray(input.versions) ? input.versions.length : 1;
    const timeoutMs = 120000 * (count >= 2 && count <= 4 ? count : 1);
    const timer = setTimeout(() => finish(new ApiError(503, '계산 시간이 길어졌습니다. 지표 수를 줄이고 다시 시도해 주세요.')), timeoutMs);
    worker.once('message', m => finish(m.error ? badRequest(m.error) : null, m.result ? JSON.parse(JSON.stringify(m.result)) : m.result));
    worker.once('error', e => finish(e));
    worker.once('exit', code => { if (!settled) finish(new Error(`전략 계산이 종료되었습니다 (${code}).`)); });
  });
}
function runFromSource(source, options) {
  // Worker construction clones its input synchronously. Do not retain a second
  // four-year price history on the API's suspended async stack during training.
  const pending = run({ ...source, ...options });
  source.prices = null; source.assets = null; source.benchmark = null; source.quantArtifact = null;
  return pending;
}
async function exclusive(sid, fn) {
  if (activeSessions.has(sid)) throw new ApiError(429, '다른 전략을 계산하고 있습니다. 완료 후 다시 시도해 주세요.');
  activeSessions.add(sid);
  try { return await fn(); } finally { activeSessions.delete(sid); }
}
async function workspace(sid) {
  const s = await snapshot(sid);
  const [versions, runs, modelCapabilities, assets] = await Promise.all([
    query(`SELECT id,saved_turn,saved_date,config,created_at FROM user_strategy_versions WHERE session_id=$1 ORDER BY created_at DESC LIMIT 20`, [sid]),
    query(`SELECT id,config,created_at,report->'own' AS performance,report->>'from' AS from_date,report->>'to' AS to_date,
      report->>'feeBps' AS fee_bps,report->>'kind' AS kind,report->>'comparison' AS comparison,
      report->>'comparisonPeriod' AS comparison_period FROM user_strategy_runs WHERE session_id=$1 ORDER BY created_at DESC LIMIT 12`, [sid]),
    capabilities(),
    query("SELECT asset_id,masked_name FROM assets WHERE asset_type='stock' AND is_active=true ORDER BY masked_name"),
  ]);
  return { features, assets: assets.rows, references: references.map(r => ({ ...r, template: r.recipe ? template(r.id) : null })), blank: template(),
    versions: versions.rows, runs: runs.rows, date: s.trade_date, turn: s.current_turn, initialCash: Number(s.initial_cash),
    ended: s.status !== 'active', feeBps: C.TRADE_FEE_RATE * 10000, modelCapabilities,
    automation:await require('./strategyAutomation').state(sid) };
}
async function practice(sid, body, mode = 'practice') {
  const config = configOf(body.config);
  if (![0, 10, 20].includes(body.feeBps)) throw badRequest('편도 비용은 0·10·20bp 중 선택해 주세요.');
  return exclusive(sid, async () => {
    const s = await snapshot(sid);
    const report = await withModelWork(async () => {
      const input = await inputs(s);
      return runFromSource(input, { mode, config, feeBps: body.feeBps });
    });
    const { rows: [row] } = await query(`INSERT INTO user_strategy_runs(session_id,config,report) VALUES($1,$2,$3) RETURNING id`, [sid, config, report]);
    return { ...report, id: row.id };
  });
}
async function compareSaved(sid, body = {}) {
  const { versionIds, period, feeBps } = body;
  if (!Array.isArray(versionIds) || versionIds.length < 2 || versionIds.length > 4 ||
      !versionIds.every(uuid) || new Set(versionIds).size !== versionIds.length) {
    throw badRequest('서로 다른 저장 모델을 2~4개 선택해 주세요.');
  }
  if (!['practice', 'observe'].includes(period)) throw badRequest('비교할 기간을 선택해 주세요.');
  if (period === 'practice' && ![0, 10, 20].includes(feeBps)) throw badRequest('편도 비용은 0·10·20bp 중 선택해 주세요.');
  return exclusive(sid, async () => {
    const s = await snapshot(sid);
    const { rows } = await query('SELECT * FROM user_strategy_versions WHERE session_id=$1 AND id=ANY($2::uuid[])', [sid, versionIds]);
    if (rows.length !== versionIds.length) throw notFound('이 게임에 저장한 모델만 비교할 수 있습니다.');
    const versions = versionIds.map(id => rows.find(v => v.id === id));
    if (versions.some(v => v.saved_date > s.trade_date || v.saved_turn > s.current_turn)) throw conflict('현재 턴 이후에 저장한 모델은 비교할 수 없습니다.');
    const observing = period === 'observe';
    const report = await withModelWork(async () => {
      const input = observing ? await inputs(s, versions.map(v => v.source_from).sort()[0]) : await inputs(s);
      if (observing && versions.some(v => v.quant_sha !== input.quantSha)) throw conflict('저장 당시의 alpha158 비교 모델이 필요합니다.');
      if (observing && versions.some(v => Number(v.fee_bps) !== Number(versions[0].fee_bps))) throw conflict('관찰 비교에는 같은 거래비용으로 저장한 모델이 필요합니다.');
      return runFromSource(input, { mode: 'compareSaved', comparisonPeriod: period,
        feeBps: observing ? Number(versions[0].fee_bps) : feeBps, ended: s.status !== 'active',
        versions: versions.map(v => ({ id: v.id, config: configOf(v.config), model: v.model,
          savedDate: v.saved_date, savedTurn: v.saved_turn, sourceFrom: v.source_from, sourceHash: v.source_hash })) });
    });
    const { rows: [row] } = await query('INSERT INTO user_strategy_runs(session_id,config,report) VALUES($1,$2,$3) RETURNING id',
      [sid, report.config, report]);
    return { ...report, id: row.id };
  });
}
async function save(sid, body) {
  const config = configOf(body.config);
  if (!uuid(body.requestKey)) throw badRequest('저장 요청 식별자가 올바르지 않습니다.');
  const { rows: [previous] } = await query('SELECT id,config FROM user_strategy_versions WHERE session_id=$1 AND request_key=$2', [sid, body.requestKey]);
  if (previous) {
    if (!isDeepStrictEqual(config, configOf(previous.config))) throw conflict('동일한 저장 요청으로 다른 전략을 저장할 수 없습니다.');
    return { id: previous.id, replayed: true };
  }
  return exclusive(sid, async () => {
    const s = await snapshot(sid);
    if (s.status !== 'active' || s.current_turn >= C.TOTAL_TURNS) throw conflict('게임 종료 전까지만 새 전략 관찰을 시작할 수 있습니다.');
    const { rows: [{ count }] } = await query('SELECT COUNT(*) FROM user_strategy_versions WHERE session_id=$1', [sid]);
    if (Number(count) >= 20) throw conflict('이번 게임에는 최대 20개 버전을 저장할 수 있습니다.');
    const { input, result } = await withModelWork(async () => {
      const input = await inputs(s), result = await runFromSource(input, { mode: 'save', config, feeBps: C.TRADE_FEE_RATE * 10000 });
      return { input, result };
    });
    return withTransaction(async client => {
      const { rows: [now] } = await client.query('SELECT current_turn,status FROM game_sessions WHERE id=$1 FOR UPDATE', [sid]);
      const { rows: [existing] } = await client.query('SELECT id,config FROM user_strategy_versions WHERE session_id=$1 AND request_key=$2', [sid, body.requestKey]);
      if (existing) {
        if (!isDeepStrictEqual(config, configOf(existing.config))) throw conflict('동일한 저장 요청으로 다른 전략을 저장할 수 없습니다.');
        return { id: existing.id, replayed: true };
      }
      if (now.current_turn !== s.current_turn || now.status !== 'active') throw conflict('계산 중 게임 턴이 바뀌었습니다. 현재 턴에서 다시 저장해 주세요.');
      const { rows: [{ count: lockedCount }] } = await client.query('SELECT COUNT(*) FROM user_strategy_versions WHERE session_id=$1', [sid]);
      if (Number(lockedCount) >= 20) throw conflict('이번 게임에는 최대 20개 버전을 저장할 수 있습니다.');
      const { rows: [row] } = await client.query(`INSERT INTO user_strategy_versions(session_id,request_key,saved_turn,saved_date,initial_cash,config,model,source_hash,source_from,quant_sha,fee_bps)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [sid, body.requestKey, s.current_turn, s.trade_date, s.initial_cash, config, result.model, result.sourceHash, input.sourceFrom, input.quantSha, C.TRADE_FEE_RATE * 10000]);
      return { id: row.id, savedTurn: s.current_turn, decision: result.decision };
    });
  });
}
async function observe(sid, id) {
  if (!uuid(id)) throw badRequest('전략 식별자가 올바르지 않습니다.');
  return exclusive(sid, async () => {
    const s = await snapshot(sid);
    const { rows: [version] } = await query('SELECT * FROM user_strategy_versions WHERE session_id=$1 AND id=$2', [sid, id]);
    if (!version) throw notFound('저장한 전략을 찾을 수 없습니다.');
    return withModelWork(async () => {
      const input = await inputs(s, version.source_from);
      if (version.quant_sha !== input.quantSha) throw conflict('저장 당시의 alpha158 비교 모델이 필요합니다.');
      return { ...await runFromSource(input, { mode: 'observe', config: version.config, model: version.model, feeBps: Number(version.fee_bps),
        initialCash: Number(version.initial_cash), savedDate: version.saved_date, expectedSourceHash: version.source_hash, ended: s.status !== 'active' }), id, savedTurn: version.saved_turn };
    });
  });
}
async function report(sid, id) {
  await snapshot(sid); if (!uuid(id)) throw badRequest('연습 기록 식별자가 올바르지 않습니다.');
  const { rows: [row] } = await query('SELECT report FROM user_strategy_runs WHERE session_id=$1 AND id=$2', [sid, id]);
  if (!row) throw notFound('연습 기록을 찾을 수 없습니다.');
  return { ...row.report, id };
}
module.exports = { workspace, practice, compare: (sid, body) => practice(sid, body, 'compare'), compareSaved, save, observe, report, inputs, run, runFromSource };
