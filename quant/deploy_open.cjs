// One-time local v2 -> v3 migration. Stop the API before running this script.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {pool}=require('../server/src/db');
const {validateArtifact}=require('../server/src/services/quantReplay');
const root=path.resolve(__dirname,'..');
const destination=path.join(root,'data/quant/signals.json');
const backup=path.join(root,'data/quant/deployments/open-execution-v3');
const expectedOld='510ff0ab3b7225efc72458e4508ca33c82a77062764274aa8ea259a3cd26a518';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const write=(name,data)=>fs.writeFileSync(path.join(backup,name),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
async function playerState(client){
 const names=(await client.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='public'
  AND column_name='session_id' AND table_name NOT IN ('market_orders','quant_session_models') ORDER BY table_name`)).rows.map(r=>r.table_name);
 const state={};
 for(const name of ['game_sessions',...names]){
  assert.match(name,/^[a-z_]+$/);
  const rows=(await client.query(`SELECT to_jsonb(t) AS row FROM ${name} t ORDER BY to_jsonb(t)::text`)).rows;
  state[name]={rows:rows.length,sha256:hash(JSON.stringify(rows))};
 }
 return state;
}
(async()=>{
 const source=path.resolve(process.argv[2]);
 const previous=fs.readFileSync(destination),next=fs.readFileSync(source),artifact=JSON.parse(next);
 assert.equal(hash(previous),expectedOld);assert.equal(artifact.schema_version,3);validateArtifact(artifact);
 assert.ok(!fs.existsSync(path.join(backup,'deployment.json')),'This migration is already complete');
 fs.mkdirSync(backup,{recursive:true});
 fs.writeFileSync(path.join(backup,'previous-signals.json'),previous,{flag:'wx'});
 fs.writeFileSync(path.join(backup,'new-signals.json'),next,{flag:'wx'});
 const client=await pool.connect();let replaced=false;
 try{
  await client.query('BEGIN');
  const sessions=(await client.query('SELECT * FROM game_sessions ORDER BY id FOR UPDATE')).rows;
  const pins=(await client.query('SELECT * FROM quant_session_models ORDER BY session_id FOR UPDATE')).rows;
  assert.equal(pins.length,2);
  for(const pin of pins){assert.equal(pin.artifact_sha256,expectedOld);assert.equal(sessions.find(s=>s.id===pin.session_id).current_turn,1);}
  write('previous-pins.json',pins);
  const before=await playerState(client);write('player-state-before.json',before);
  await client.query('UPDATE quant_session_models SET artifact_sha256=$1,model_version=$2 WHERE artifact_sha256=$3',[hash(next),artifact.model_version,expectedOld]);
  fs.writeFileSync(`${destination}.pending`,next);fs.renameSync(`${destination}.pending`,destination);replaced=true;
  process.env.QUANT_SIGNALS_FILE=destination;
  const {syncQuantOrders}=require('../server/src/services/quantService');
  for(const session of sessions)if(session.status==='active')await syncQuantOrders(client,session);
  const after=await playerState(client);assert.deepEqual(after,before);
  const orders=(await client.query("SELECT session_id,owner,status,count(*)::int FROM market_orders GROUP BY session_id,owner,status ORDER BY session_id,owner,status")).rows;
  await client.query('COMMIT');
  write('deployment.json',{deployed_at:new Date().toISOString(),source,previous_sha256:expectedOld,sha256:hash(next),model_version:artifact.model_version,
   execution:artifact.execution,migrated_pins:pins.map(p=>p.session_id),all_sessions:sessions.map(s=>({id:s.id,turn:s.current_turn})),
   player_state_unchanged:true,player_fingerprints:after,orders});
  console.log(JSON.stringify({status:'deployed',sha256:hash(next),player_state_unchanged:true,orders},null,2));
 }catch(e){await client.query('ROLLBACK');if(replaced)fs.writeFileSync(destination,previous);throw e;}
 finally{client.release();await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
