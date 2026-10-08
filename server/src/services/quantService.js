const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { withTransaction } = require('../db');
const { notFound, conflict } = require('../utils/errors');
const C = require('../config/constants');
const { replayQuant, validateArtifact } = require('./quantReplay');
const { computeTotalAsset } = require('./valuationService');

let cache;
function loadArtifact() {
  const file = process.env.QUANT_SIGNALS_FILE || path.resolve(__dirname, '../../../data/quant/signals.json');
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  if (cache?.file === file && cache.mtime === stat.mtimeMs && cache.size === stat.size) return cache;
  const raw = fs.readFileSync(file);
  const artifact = JSON.parse(raw);
  validateArtifact(artifact);
  cache = { file, mtime: stat.mtimeMs, size: stat.size, artifact,
            sha: crypto.createHash('sha256').update(raw).digest('hex') };
  return cache;
}

async function replaySession(client,session,loaded) {
    const sessionId=session.id;
    const { artifact, sha } = loaded;
    await client.query(`INSERT INTO quant_session_models (session_id, artifact_sha256, model_version)
      VALUES ($1, $2, $3) ON CONFLICT (session_id) DO NOTHING`, [sessionId, sha, artifact.model_version]);
    const { rows: pinned } = await client.query('SELECT artifact_sha256 FROM quant_session_models WHERE session_id = $1', [sessionId]);
    if (pinned[0].artifact_sha256 !== sha) throw conflict('이 게임에서 사용하던 퀀트 모델 버전이 필요합니다');
    const { rows: turns } = await client.query(`SELECT turn_number, trade_date FROM game_turns
      WHERE session_id = $1 AND turn_number <= $2 ORDER BY turn_number`, [sessionId, session.current_turn]);
    if (!turns.length) throw notFound('턴 정보를 찾을 수 없습니다');
    const from = turns[0].trade_date;
    const to = turns.at(-1).trade_date;
    const { rows: assets } = await client.query(`SELECT asset_id, masked_name, listed_from, listed_to, is_active
      FROM assets WHERE asset_type = 'stock'`);
    const { rows: prices } = await client.query(`SELECT p.asset_id, p.trade_date, p.close_price,d.open_price FROM asset_prices p
      JOIN assets a USING (asset_id) LEFT JOIN stock_price_detail d ON d.asset_id=p.asset_id AND d.trade_date=p.trade_date
      WHERE a.asset_type = 'stock' AND p.trade_date >= (
        SELECT COALESCE(MAX(trade_date), $1::date) FROM asset_prices p2 JOIN assets a2 USING (asset_id)
        WHERE a2.asset_type = 'stock' AND p2.trade_date < $1
      ) AND p.trade_date <= $2 ORDER BY p.trade_date, p.asset_id`, [from, to]);
    const replay = replayQuant({ turns, prices, assets, artifact, initialCash: Number(session.initial_cash),
      totalTurns:session.status==='active'?C.TOTAL_TURNS:session.current_turn });
    if(artifact.schema_version===3)await persistQuantOrders(client,session,replay.orders);
    return {replay,to,artifact};
}

async function persistQuantOrders(client,session,orders) {
  if(!orders.length)return;
  const records=orders.map(o=>({order_key:o.orderKey,asset_id:o.assetId,side:o.side,decision_turn:o.decisionTurn,
    decision_date:o.decisionDate,quantity:o.quantity,reference_price:o.referencePrice,cash_budget:o.cashBudget,
    status:session.status!=='active'&&o.status==='pending'?'cancelled':o.status,
    execution_turn:o.executionTurn??null,execution_date:o.executionDate??null,filled_quantity:o.filledQuantity||0,
    execution_price:o.price??null,amount:o.amount??null,realized_pnl:o.realizedPnl??null,
    reason:session.status!=='active'&&o.status==='pending'?'game_ended':o.reason??null}));
  await client.query(`INSERT INTO market_orders(session_id,owner,order_key,asset_id,side,decision_turn,decision_date,
    quantity,reference_price,cash_budget,status,execution_turn,execution_date,filled_quantity,execution_price,amount,realized_pnl,reason)
    SELECT $1,'quant',r.* FROM jsonb_to_recordset($2::jsonb) AS r(order_key text,asset_id varchar(30),side text,decision_turn int,
    decision_date date,quantity numeric,reference_price numeric,cash_budget numeric,status text,execution_turn int,execution_date date,
    filled_quantity numeric,execution_price numeric,amount numeric,realized_pnl numeric,reason text)
    ON CONFLICT(session_id,owner,order_key) DO UPDATE SET status=EXCLUDED.status,execution_turn=EXCLUDED.execution_turn,
    execution_date=EXCLUDED.execution_date,filled_quantity=EXCLUDED.filled_quantity,execution_price=EXCLUDED.execution_price,
    amount=EXCLUDED.amount,realized_pnl=EXCLUDED.realized_pnl,reason=EXCLUDED.reason`,[session.id,JSON.stringify(records)]);
}

// Called during turn advancement even when the quant modal was never opened.
async function syncQuantOrders(client,session) {
  const loaded=loadArtifact();
  if(!loaded || loaded.artifact.schema_version!==3)return;
  await replaySession(client,session,loaded);
}

async function getQuantPortfolio(sessionId) {
  const loaded=loadArtifact();
  return withTransaction(async client=>{
    const {rows:[session]}=await client.query('SELECT * FROM game_sessions WHERE id=$1 FOR UPDATE',[sessionId]);
    if(!session)throw notFound('세션을 찾을 수 없습니다');
    if(!loaded)return {status:'unavailable',message:'퀀트 학습 데이터를 준비 중입니다.'};
    const {replay,to,artifact}=await replaySession(client,session,loaded);
    const playerTotalAsset = await computeTotalAsset(sessionId, client, { tradeDate: to, cash: session.cash });
    return { ...replay, date: to, turnNumber: session.current_turn, modelVersion: artifact.model_version,
      topK: artifact.top_k, rebalanceTurns: artifact.rebalance_turns,
      strategy: artifact.strategy || 'equal_weight_rebalance', nDrop: artifact.n_drop ?? null,
      labelHorizon: artifact.label_horizon || { unit: 'weekdays', value: 120 },
      legacyModel: artifact.schema_version === 1,
      executionRule:artifact.execution, priceBasis:artifact.price_basis, dataVersion:artifact.data_version,
      nextRebalanceTurn: replay.nextRebalanceTurn <= C.TOTAL_TURNS ? replay.nextRebalanceTurn : null,
      playerTotalAsset,
      feeRate: C.TRADE_FEE_RATE, limitations: artifact.limitations,
      comparisonNote: '퀀트는 초기 투자금만 운용합니다. 내 총자산에는 월급·생활비·상환·이벤트가 반영됩니다.' };
  });
}

module.exports = { getQuantPortfolio, loadArtifact, syncQuantOrders };
