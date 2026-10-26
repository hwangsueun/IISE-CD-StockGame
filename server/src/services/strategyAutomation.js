const {query,withTransaction}=require('../db');
const {badRequest,conflict,notFound}=require('../utils/errors');
const turns=require('./turnSelector');
const C=require('../config/constants');
const investmentPolicy=require('./investmentPolicy');
const uuid=s=>typeof s==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
async function state(sid,client={query}) {
  const {rows:[row]}=await client.query(`SELECT a.*,v.config->>'name' AS name,
    s.status AS game_status,s.current_turn,s.action_locked_until_turn,s.side_job_turn,s.stress
    FROM user_strategy_automation a JOIN game_sessions s ON s.id=a.session_id
    LEFT JOIN user_strategy_versions v ON v.id=a.version_id WHERE a.session_id=$1`,[sid]);
  const {rows:history}=await client.query(`SELECT turn_number,detail FROM user_strategy_automation_log
    WHERE session_id=$1 ORDER BY turn_number DESC LIMIT 12`,[sid]);
  const paused=row?.enabled ? investmentPolicy.restriction(row) : null;
  return {enabled:!!row?.enabled,paused:!!paused,pauseReason:paused?.message||null,
    pauseCode:paused?.code||null,resumeTurn:paused?.resumeTurn||null,
    versionId:row?.version_id||null,name:row?.name||null,nextReview:row?.next_review_turn,
    lastTurn:row?.last_turn,lastResult:row?.last_result,history};
}
async function configure(sid,{enabled,versionId}) {
  if(typeof enabled!=='boolean' || (enabled && !uuid(versionId)))throw badRequest('자동 투자 여부와 저장한 모델을 확인해 주세요.');
  return withTransaction(async client=>{
    const {rows:[s]}=await client.query('SELECT * FROM game_sessions WHERE id=$1 FOR UPDATE',[sid]);
    if(!s)throw notFound('게임을 찾을 수 없습니다.');
    if(enabled) {
      if(s.status!=='active' || s.current_turn>=C.TOTAL_TURNS)throw conflict('종료된 게임에서는 자동 투자를 켤 수 없습니다.');
      const {rows:[v]}=await client.query('SELECT * FROM user_strategy_versions WHERE session_id=$1 AND id=$2',[sid,versionId]);
      if(!v || v.saved_turn>s.current_turn)throw notFound('이 게임에 저장한 모델을 선택해 주세요.');
      if(Number(v.fee_bps)!==C.TRADE_FEE_RATE*10000)throw conflict('현재 거래 비용으로 모델을 다시 저장해 주세요.');
      const {rows:[old]}=await client.query('SELECT * FROM user_strategy_automation WHERE session_id=$1',[sid]);
      if(old?.enabled && old.version_id===versionId) {
        await investmentPolicy.enforce(client,s);
        return state(sid,client);
      }
    }
    await client.query(`UPDATE market_orders SET status='cancelled',reason='model_automation_stopped',updated_at=NOW()
      WHERE session_id=$1 AND owner='player' AND strategy_version_id IS NOT NULL AND status='pending'`,[sid]);
    await client.query(`INSERT INTO user_strategy_automation(session_id,version_id,enabled,next_review_turn)
      VALUES($1,$2,$3,$4) ON CONFLICT(session_id) DO UPDATE SET
      version_id=COALESCE($2,user_strategy_automation.version_id),enabled=$3,next_review_turn=$4,updated_at=NOW()`,
    [sid,enabled?versionId:null,enabled,s.current_turn]);
    if(enabled)await investmentPolicy.enforce(client,s);
    return state(sid,client);
  });
}
// Called with the session lock held, before moving to tomorrow's prices.
async function sync(client,session) {
  const sid=session.id;
  const blocked=await investmentPolicy.enforce(client,session);
  const {rows:[a]}=await client.query(`SELECT a.*,v.config,v.model,v.saved_date,v.source_hash,v.source_from
    FROM user_strategy_automation a JOIN user_strategy_versions v ON v.id=a.version_id AND v.session_id=a.session_id
    WHERE a.session_id=$1 AND a.enabled=TRUE`,[sid]);
  if(!a || a.last_turn===session.current_turn)return null;
  const finish=async detail=>{
    await client.query(`UPDATE user_strategy_automation SET last_turn=$2,last_result=$3,
      next_review_turn=$4,updated_at=NOW() WHERE session_id=$1`,
    [sid,session.current_turn,detail,detail.nextReview||a.next_review_turn]);
    await client.query(`INSERT INTO user_strategy_automation_log(session_id,version_id,turn_number,detail)
      VALUES($1,$2,$3,$4) ON CONFLICT(session_id,turn_number) DO NOTHING`,[sid,a.version_id,session.current_turn,detail]);
    return detail;
  };
  if(session.status!=='active' || session.current_turn>=C.TOTAL_TURNS)return finish({status:'waiting',reason:'게임 종료로 자동 주문을 중단했습니다.'});
  if(blocked)
    return finish({status:'paused',reason:blocked.message,pauseCode:blocked.code,resumeTurn:blocked.resumeTurn,
      cancelledOrderCount:blocked.cancelledOrderCount,
      nextReview:Math.min(a.next_review_turn,session.current_turn+1)});
  const {rows:[t]}=await client.query('SELECT trade_date FROM game_turns WHERE session_id=$1 AND turn_number=$2',[sid,session.current_turn]);
  if(!await turns.isMarketOpen(t.trade_date,client) || !await turns.hasFutureMarketOpen(sid,session.current_turn,client))
    return finish({status:'waiting',reason:'현재 또는 다음 개장일을 기다립니다.'});
  const {rows:pending}=await client.query(`SELECT id FROM market_orders WHERE session_id=$1 AND owner='player' AND status='pending'`,[sid]);
  if(pending.length)return finish({status:'waiting',reason:'대기 중인 주문이 있어 새 자동 주문을 쉬었습니다.'});
  const {rows:holdings}=await client.query(`SELECT h.* FROM holdings h JOIN assets a USING(asset_id)
    WHERE h.session_id=$1 AND a.asset_type='stock'`,[sid]);
  const service=require('./userStrategyService');
  const input=await service.inputs({...session,trade_date:t.trade_date},a.source_from,client);
  let result;
  try {
    result=await service.run({...input,mode:'automate',config:a.config,model:a.model,savedDate:a.saved_date,
      expectedSourceHash:a.source_hash,feeBps:C.TRADE_FEE_RATE*10000,holdings,cash:Math.max(0,Number(session.cash)),
      turn:session.current_turn,nextReview:a.next_review_turn});
  } catch(e) { return finish({status:'error',reason:e.message}); }
  for(const o of result.orders) {
    await client.query(`INSERT INTO market_orders(session_id,owner,order_key,asset_id,side,decision_turn,decision_date,
      quantity,reference_price,cash_budget,strategy_version_id) VALUES($1,'player',$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT(session_id,owner,order_key) DO NOTHING`,
    [sid,`model:${a.version_id}:${session.current_turn}:${o.assetId}:${o.side}`,o.assetId,o.side,session.current_turn,
      t.trade_date,o.quantity,o.referencePrice,o.cashBudget,a.version_id]);
  }
  return finish({status:'reviewed',orderCount:result.orders.length,nextReview:result.nextReview,
    reason:result.orders.length?'모델의 주문을 다음 개장일 시가로 예약했습니다.':'현재 보유 상태를 유지합니다.',
    reasons:result.decision?.reasons,targets:result.decision?.rows.map(r=>({assetId:r.id,weight:r.targetWeight}))});
}
module.exports={state,configure,sync};
