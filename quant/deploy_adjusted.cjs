// Validate with --check first. --apply requires the API to be stopped.
// All prices, pins and replayed quant orders are migrated in one DB transaction.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {pool}=require('../server/src/db');
const {validateArtifact}=require('../server/src/services/quantReplay');
const root=path.resolve(__dirname,'..');
const backup=path.join(root,'data/quant/deployments/20261006-adjusted');
const liveFile=path.join(root,'data/quant/signals.json');
const oldSha='4feccf6f2cb0b06684f24d143d975c0a6421daab10fbbd06ca6a76d80ef75c1e';
const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const save=(name,obj)=>fs.writeFileSync(path.join(backup,name),JSON.stringify(obj,null,2)+'\n',{flag:'wx'});
function readCsv(file,header){
 const [first,...lines]=fs.readFileSync(file,'utf8').trim().split(/\r?\n/);
 assert.equal(first,header);
 return lines.map(line=>line.split(',').map((s,i)=>i<2?s:s===''?null:Number(s)));
}
async function playerFingerprint(client){
 const names=(await client.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='public'
   AND column_name='session_id' AND table_name<>'quant_session_models' ORDER BY table_name`)).rows.map(r=>r.table_name);
 const result={};
 for(const name of ['game_sessions',...names]){
  assert.match(name,/^[a-z_]+$/);
  const {rows}=await client.query(`SELECT to_jsonb(t) row FROM ${name} t ${name==='market_orders'?"WHERE owner='player'":''} ORDER BY to_jsonb(t)::text`);
  result[name]={rows:rows.length,sha256:hash(JSON.stringify(rows))};
 }
 return result;
}
async function migrate(client,data,artifact,newSha){
 const manifest=JSON.parse(fs.readFileSync(path.join(data,'manifest.json')));
 assert.equal(manifest.schema_version,2);assert.ok(manifest.price_basis.startsWith('adjusted'));
 assert.equal(artifact.data_version,manifest.version);assert.equal(artifact.price_basis,manifest.price_basis);
 for(const [name,sha] of Object.entries(manifest.files))assert.equal(hash(fs.readFileSync(path.join(data,name))),sha,name);
 const detail=readCsv(path.join(data,'stock_price_detail.csv'),'asset_id,trade_date,open_price,high_price,low_price,close_price,volume,amount,vwap,adjustment_factor,adjusted_volume');
 const prices=readCsv(path.join(data,'asset_prices.csv'),'asset_id,trade_date,close_price,change_rate');
 assert.equal(detail.length,manifest.rows);assert.equal(prices.length,manifest.rows);
 for(const r of detail){
  assert.equal(r.length,11);assert.match(r[0],/^STOCK_\d{6}$/);assert.match(r[1],/^\d{4}-\d{2}-\d{2}$/);
  assert.ok(r.slice(2).every(v=>v===null||Number.isFinite(v)));assert.ok(r[5]>0&&r[9]>0);
  assert.ok(r[6]===null||Number.isSafeInteger(r[6]));
 }
 const sessions=(await client.query('SELECT * FROM game_sessions ORDER BY id FOR UPDATE')).rows;
 const pins=(await client.query('SELECT * FROM quant_session_models ORDER BY session_id FOR UPDATE')).rows;
 assert.ok(pins.every(p=>p.artifact_sha256===oldSha),'Unexpected pinned model; do not overwrite');
 const {rows:[occupied]}=await client.query(`SELECT
  (SELECT count(*) FROM holdings h JOIN assets a USING(asset_id) WHERE a.asset_type='stock')::int holdings,
  (SELECT count(*) FROM trades t JOIN assets a USING(asset_id) WHERE a.asset_type='stock')::int trades,
  (SELECT count(*) FROM market_orders WHERE owner='player')::int player_orders`);
 assert.deepEqual(occupied,{holdings:0,trades:0,player_orders:0},'Played stock positions require an explicit position migration; never reset them');
 const before=await playerFingerprint(client);
 const previousQuantOrders=(await client.query("SELECT * FROM market_orders WHERE owner='quant' ORDER BY id")).rows;
 await client.query(fs.readFileSync(path.join(root,'server/migrations/010_adjusted_stock_prices.sql'),'utf8'));
 await client.query(`CREATE TEMP TABLE adjusted_import(asset_id text,trade_date date,open_price numeric,high_price numeric,
  low_price numeric,close_price numeric,volume bigint,amount numeric,vwap numeric,adjustment_factor numeric,adjusted_volume numeric,
  PRIMARY KEY(asset_id,trade_date)) ON COMMIT DROP`);
 for(let offset=0;offset<detail.length;offset+=4000){
  const chunk=detail.slice(offset,offset+4000);
  await client.query(`INSERT INTO adjusted_import VALUES ${chunk.map((r,i)=>`(${r.map((_,j)=>`$${i*11+j+1}`).join(',')})`).join(',')}`,chunk.flat());
 }
 const {rows:[coverage]}=await client.query(`SELECT
  (SELECT count(*) FROM asset_prices p JOIN assets a USING(asset_id) WHERE a.asset_type='stock' AND p.trade_date BETWEEN $1 AND $2)::int existing,
  (SELECT count(*) FROM adjusted_import q JOIN asset_prices p USING(asset_id,trade_date) JOIN stock_price_detail d USING(asset_id,trade_date)
    JOIN assets a USING(asset_id) WHERE a.asset_type='stock' AND d.volume IS NOT DISTINCT FROM q.volume AND d.amount IS NOT DISTINCT FROM q.amount)::int matched`,[manifest.from,manifest.to]);
 assert.equal(coverage.existing,manifest.rows);assert.equal(coverage.matched,manifest.rows,'Raw volume/amount and all existing keys must match');
 // The old workbook included a 2012-12-28 lookback boundary not supplied in
 // quant_data_2. Archive these rows instead of leaving raw prices on an adjusted chart.
 const excluded={};
 for(const table of ['asset_prices','stock_price_detail']){
  excluded[table]=(await client.query(`SELECT p.* FROM ${table} p JOIN assets a USING(asset_id)
   WHERE a.asset_type='stock' AND (p.trade_date<$1 OR p.trade_date>$2) ORDER BY p.asset_id,p.trade_date`,[manifest.from,manifest.to])).rows;
 }
 const {rows:[outsideTurns]}=await client.query('SELECT count(*)::int n FROM game_turns WHERE trade_date<$1 OR trade_date>$2',[manifest.from,manifest.to]);
 assert.equal(outsideTurns.n,0,'Existing game calendar outside adjusted source coverage');
 for(const table of ['asset_prices','stock_price_detail'])await client.query(`DELETE FROM ${table} p USING assets a
  WHERE a.asset_id=p.asset_id AND a.asset_type='stock' AND (p.trade_date<$1 OR p.trade_date>$2)`,[manifest.from,manifest.to]);
 const updated=(await client.query(`UPDATE asset_prices p SET close_price=q.close_price,change_rate=q.change_rate
  FROM (SELECT asset_id,trade_date,close_price,close_price/NULLIF(LAG(close_price) OVER(PARTITION BY asset_id ORDER BY trade_date),0)-1 change_rate FROM adjusted_import) q
  WHERE p.asset_id=q.asset_id AND p.trade_date=q.trade_date`)).rowCount;
 assert.equal(updated,manifest.rows);
 const detailed=(await client.query(`UPDATE stock_price_detail d SET open_price=q.open_price,high_price=q.high_price,low_price=q.low_price,
  close_price=q.close_price,vwap=q.vwap,adjustment_factor=q.adjustment_factor,adjusted_volume=q.adjusted_volume
  FROM adjusted_import q WHERE d.asset_id=q.asset_id AND d.trade_date=q.trade_date`)).rowCount;
 assert.equal(detailed,manifest.rows);
 const {rows:[mismatch]}=await client.query(`SELECT count(*)::int n FROM adjusted_import q
  JOIN stock_price_detail d USING(asset_id,trade_date) JOIN asset_prices p USING(asset_id,trade_date)
  WHERE p.close_price IS DISTINCT FROM q.close_price OR d.close_price IS DISTINCT FROM q.close_price
    OR d.open_price IS DISTINCT FROM q.open_price OR d.high_price IS DISTINCT FROM q.high_price OR d.low_price IS DISTINCT FROM q.low_price
    OR d.vwap IS DISTINCT FROM q.vwap OR d.volume IS DISTINCT FROM q.volume OR d.amount IS DISTINCT FROM q.amount
    OR d.adjustment_factor IS DISTINCT FROM q.adjustment_factor OR d.adjusted_volume IS DISTINCT FROM q.adjusted_volume`);
 assert.equal(mismatch.n,0);
 await client.query('UPDATE market_data_versions SET active=FALSE WHERE active');
 await client.query(`INSERT INTO market_data_versions(version,price_basis,source_sha256,manifest_sha256,active) VALUES($1,$2,$3,$4,TRUE)`,
  [manifest.version,manifest.price_basis,manifest.sources.adjusted.sha256,hash(fs.readFileSync(path.join(data,'manifest.json')))]);
 await client.query('UPDATE quant_session_models SET artifact_sha256=$1,model_version=$2',[newSha,artifact.model_version]);
 await client.query("DELETE FROM market_orders WHERE owner='quant'");
 const {syncQuantOrders}=require('../server/src/services/quantService');
 for(const session of sessions)await syncQuantOrders(client,session);
 const after=await playerFingerprint(client);assert.deepEqual(after,before);
 return {dataVersion:manifest.version,modelVersion:artifact.model_version,sha256:newSha,rows:updated,
  player_state_unchanged:true,player_fingerprints:after,previous_pins:pins,previous_quant_orders:previousQuantOrders,
  excluded_previous_prices:excluded,archived_outside_coverage:Object.fromEntries(Object.entries(excluded).map(([k,v])=>[k,v.length])),
  sessions:sessions.map(s=>({id:s.id,turn:s.current_turn})),
  quant_orders:(await client.query("SELECT session_id,status,count(*)::int count FROM market_orders WHERE owner='quant' GROUP BY session_id,status ORDER BY session_id,status")).rows};
}

(async()=>{
 const data=path.resolve(process.argv[2]),modelDir=path.join(data,'model-v4-adjusted-open');
 const apply=process.argv.includes('--apply');
 if(!apply&&!process.argv.includes('--check'))throw Error('Choose --check or --apply');
 const next=fs.readFileSync(path.join(modelDir,'signals.json')),artifact=JSON.parse(next),previous=fs.readFileSync(liveFile);
 assert.equal(hash(previous),oldSha);validateArtifact(artifact);
 const verification=JSON.parse(fs.readFileSync(path.join(modelDir,'verification.json')));assert.equal(verification.status,'passed');
 assert.ok(fs.existsSync(path.join(modelDir,'backtest.json')));
 process.env.QUANT_SIGNALS_FILE=path.join(modelDir,'signals.json');
 const client=await pool.connect();let replaced=false,committed=false;
 try{
  await client.query('BEGIN');
  const result=await migrate(client,data,artifact,hash(next));
  if(apply){
   assert.ok(fs.statSync(path.join(backup,'database-before.dump')).size>0);
   save('previous-pins.json',result.previous_pins);save('previous-quant-orders.json',result.previous_quant_orders);
   save('excluded-before-coverage.json',result.excluded_previous_prices);
   fs.writeFileSync(`${liveFile}.adjusted-pending`,next);fs.renameSync(`${liveFile}.adjusted-pending`,liveFile);replaced=true;
   await client.query('COMMIT');committed=true;
  }else await client.query('ROLLBACK');
  delete result.previous_quant_orders;
  delete result.excluded_previous_prices;
  result.status=apply?'deployed':'dry_run_passed_rolled_back';result.checked_at=new Date().toISOString();
  save(apply?'deployment.json':'dry-run.json',result);
  console.log(JSON.stringify(result,null,2));
 }catch(e){if(!committed){await client.query('ROLLBACK');if(replaced)fs.writeFileSync(liveFile,previous);}throw e;}
 finally{client.release();await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
