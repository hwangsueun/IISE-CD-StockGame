'use strict';
// Temporary maintenance entrypoint. This module never imports the application.
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');
const SOURCE_DB_ID = 'dpg-db6bk48473hc73dt7ss0-a';
const MAGIC = Buffer.from('ANTPGM1\n');
const ALG = 'RSA-OAEP-SHA256+A256GCM';
const MAX_BYTES = 1024 ** 3, MAX_HEADER = 8192, MAX_MANIFEST = 1024 ** 2;
const problem = (code, status = 400) => Object.assign(new Error(code), { code, status });
const q = name => '"' + name.replaceAll('"', '""') + '"';
const u32 = number => { const b = Buffer.alloc(4); b.writeUInt32BE(number); return b; };
const fingerprint = key => crypto.createHash('sha256').update((key?.type === 'public' ? key : crypto.createPublicKey(key)).export({ type: 'spki', format: 'der' })).digest('hex');
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
function databaseId(url) { return /^(dpg-[a-z0-9]+-[a-z])(?:\.|$)/.exec(url.hostname)?.[1]; }
function connectionEnv(url) {
  return { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password), PGAPPNAME: 'antsurvival-migration',
    PGSSLMODE: url.searchParams.get('sslmode') || 'prefer' };
}
async function defaultCommand(tool, args, env, signal) {
  const native = await require('./pg-client.cjs').getPgTools(tool);
  await new Promise((resolve, reject) => {
    const child = spawn(native.command, [...native.argsPrefix, ...args], { env, signal, stdio: 'ignore' });
    child.once('error', () => reject(problem('native_command_failed', 500)));
    child.once('close', code => code === 0 ? resolve() : reject(problem('native_command_failed', 500)));
  });
}
async function version(client) {
  const { rows } = await client.query('SHOW server_version');
  const text = String(rows[0]?.server_version || '');
  const major = Number(/^\d+/.exec(text)?.[0]);
  if (!major) throw problem('server_version_invalid', 500);
  return { serverVersion: text, serverMajor: major };
}
async function empty(client) {
  const { rows } = await client.query(`SELECT
    NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('public','information_schema'))
    AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')
    AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')
    AND NOT EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')
    AND NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname <> 'plpgsql')
    AND NOT EXISTS(SELECT 1 FROM pg_event_trigger)
    AND NOT EXISTS(SELECT 1 FROM pg_largeobject_metadata) AS empty`);
  return rows[0]?.empty === true;
}
async function checks(client) {
  const { rows: tables } = await client.query(`SELECT n.nspname AS schema,c.relname AS table FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p')
    AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' ORDER BY n.nspname,c.relname`);
  const tableCounts = [];
  for (const table of tables) {
    const { rows } = await client.query(`SELECT COUNT(*)::text AS count FROM ${q(table.schema)}.${q(table.table)}`);
    tableCounts.push({ ...table, count: rows[0].count });
  }
  const { rows: columns } = await client.query(`SELECT n.nspname AS schema,c.relname AS table,a.attname AS column FROM pg_attribute a
    JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped AND a.atttypid='uuid'::regtype
    AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' ORDER BY n.nspname,c.relname,a.attname`);
  const uuidChecks = [];
  for (const [index, column] of columns.entries()) {
    const cursor = q(`migration_uuid_${index}`), hash = crypto.createHash('sha256'); let total = 0n;
    await client.query(`DECLARE ${cursor} NO SCROLL CURSOR FOR SELECT ${q(column.column)}::text AS value FROM ${q(column.schema)}.${q(column.table)} ORDER BY ${q(column.column)} NULLS FIRST`);
    for (;;) {
      const { rows } = await client.query(`FETCH FORWARD 1000 FROM ${cursor}`);
      for (const row of rows) { hash.update(row.value === null ? '\\N\n' : String(row.value).toLowerCase() + '\n'); total++; }
      if (rows.length < 1000) break;
    }
    await client.query(`CLOSE ${cursor}`);
    uuidChecks.push({ ...column, totalCount: String(total), sha256: hash.digest('hex') });
  }
  return { tableCounts, uuidChecks };
}
async function fileHash(file) {
  const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file)) hash.update(chunk); return hash.digest('hex');
}
async function readAt(file, start, length) {
  const handle = await fsp.open(file, 'r');
  try { const b = Buffer.alloc(length); const { bytesRead } = await handle.read(b, 0, length, start); if (bytesRead !== length) throw problem('invalid_envelope'); return b; }
  finally { await handle.close(); }
}
function validManifest(m, sourceId, targetId) {
  const identifier = value => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 63 && !value.includes('\0');
  const count = value => typeof value === 'string' && /^\d+$/.test(value);
  const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (!m || m.version !== 1 || m.format !== 'pg_dump-custom' || m.sourceDbId !== sourceId || m.targetDbId !== targetId ||
      !Number.isSafeInteger(m.archiveBytes) || m.archiveBytes < 5 || m.archiveBytes > MAX_BYTES || !digest(m.archiveSha256) ||
      !Number.isInteger(m.serverMajor) || m.serverMajor < 10 || typeof m.serverVersion !== 'string' ||
      !Array.isArray(m.tableCounts) || m.tableCounts.length > 10000 || !Array.isArray(m.uuidChecks) || m.uuidChecks.length > 20000) throw problem('manifest_invalid');
  for (const row of m.tableCounts) if (!identifier(row.schema) || !identifier(row.table) || !count(row.count)) throw problem('manifest_invalid');
  for (const row of m.uuidChecks) if (!identifier(row.schema) || !identifier(row.table) || !identifier(row.column) || !count(row.totalCount) || !digest(row.sha256)) throw problem('manifest_invalid');
  for (const [list, keys] of [[m.tableCounts, ['schema','table']], [m.uuidChecks, ['schema','table','column']]]) {
    if (new Set(list.map(row => JSON.stringify(keys.map(key => row[key])))).size !== list.length) throw problem('manifest_invalid');
  }
}
function canonicalChecks(value) {
  const sorted = list => list.map(row => Object.fromEntries(Object.entries(row).sort())).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify({ tableCounts: sorted(value.tableCounts), uuidChecks: sorted(value.uuidChecks) });
}
function createMigrationServer(options = {}) {
  const env = options.env || process.env, now = options.now || Date.now;
  const mode = env.MIGRATION_MODE;
  if (!mode) return null;
  const expires = Date.parse(env.MIGRATION_EXPIRES_AT || '');
  if (!['export','restore'].includes(mode) || !/^[a-fA-F0-9]{64}$/.test(env.MIGRATION_TOKEN || '') || !Number.isFinite(expires) || expires <= now() || expires - now() > 7200000) throw problem('migration_configuration_invalid');
  let url; try { url = new URL(env.DATABASE_URL); } catch { throw problem('database_binding_invalid'); }
  const sourceId = options.sourceDbId || SOURCE_DB_ID, id = (options.identifyDatabase || databaseId)(url);
  const allowedHost = url.hostname === id || (typeof id === 'string' && url.hostname.startsWith(id + '.') && /^[a-z0-9-]+-postgres\.render\.com$/.test(url.hostname.slice(id.length + 1)));
  if (!allowedHost || !['postgres:','postgresql:'].includes(url.protocol) || !url.username || !url.pathname.slice(1) || !id ||
      (mode === 'export' ? id !== sourceId : id === sourceId || env.MIGRATION_TARGET_DB_ID !== id)) throw problem('database_binding_invalid');
  const token = Buffer.from(env.MIGRATION_TOKEN, 'hex'), pgEnv = connectionEnv(url);
  const clientFactory = options.clientFactory || (() => new (require('pg').Client)({ connectionString: env.DATABASE_URL, application_name: 'antsurvival-migration', connectionTimeoutMillis: 15000, query_timeout: 120000 }));
  const command = options.command || defaultCommand;
  let publicKey;
  if (mode === 'export') {
    try { publicKey = crypto.createPublicKey(env.MIGRATION_PUBLIC_KEY); if (publicKey.asymmetricKeyType !== 'rsa' || publicKey.asymmetricKeyDetails.modulusLength < 3072) throw new Error(); }
    catch { throw problem('migration_public_key_invalid'); }
  }
  let pairPromise, busy = false, used = false, state = 'idle', active;
  const pair = () => pairPromise ||= promisify(crypto.generateKeyPair)('rsa', { modulusLength: 3072, publicKeyEncoding: { type:'spki', format:'pem' }, privateKeyEncoding: { type:'pkcs8', format:'pem' } });
  async function database(fn, signal) {
    const client = clientFactory(); client.on?.('error', () => {});
    const stop = () => { Promise.resolve(client.end()).catch(() => {}); };
    signal?.addEventListener('abort', stop, { once: true });
    try { if (signal?.aborted) throw problem('expired',410); await client.connect(); return await fn(client); }
    finally { signal?.removeEventListener('abort', stop); await client.end().catch(() => {}); }
  }
  async function exportArchive(res, directory, signal) {
    const archive = path.join(directory,'archive.dump'); await fsp.writeFile(archive,'',{mode:0o600,flag:'wx'});
    const manifest = await database(async client => {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try {
        const v = await version(client);
        const { rows } = await client.query('SELECT pg_export_snapshot() AS snapshot');
        const snapshot = rows[0]?.snapshot; if (typeof snapshot !== 'string' || !/^[a-f0-9-]+$/i.test(snapshot)) throw problem('snapshot_invalid',500);
        const data = await checks(client);
        await command('pg_dump',['--format=custom','--no-owner','--no-privileges',`--snapshot=${snapshot}`,`--file=${archive}`],pgEnv,signal);
        return { version:1,format:'pg_dump-custom',sourceDbId:sourceId,...v,...data,archiveBytes:(await fsp.stat(archive)).size,archiveSha256:await fileHash(archive) };
      } finally { await client.query('ROLLBACK').catch(() => {}); }
    },signal);
    const metadata = Buffer.from(JSON.stringify(manifest));
    if (metadata.length > MAX_MANIFEST || manifest.archiveBytes < 5) throw problem('archive_invalid',500);
    const key = crypto.randomBytes(32), nonce = crypto.randomBytes(12), wrappedKey = crypto.publicEncrypt({key:publicKey,padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key);
    const header = Buffer.from(JSON.stringify({version:1,alg:ALG,nonce:nonce.toString('base64'),wrappedKey:wrappedKey.toString('base64'),recipient:fingerprint(publicKey),ciphertextLength:4+metadata.length+manifest.archiveBytes}));
    const prefix = Buffer.concat([MAGIC,u32(header.length),header]);
    if (prefix.length+4+metadata.length+manifest.archiveBytes+16 > MAX_BYTES) throw problem('archive_too_large',413);
    const cipher = crypto.createCipheriv('aes-256-gcm',key,nonce); cipher.setAAD(prefix); key.fill(0);
    async function* payload() { yield u32(metadata.length); yield metadata; yield* fs.createReadStream(archive); }
    const tag = new Transform({ transform(chunk,_encoding,done){done(null,chunk);},flush(done){this.push(cipher.getAuthTag());done();} });
    res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':prefix.length+4+metadata.length+manifest.archiveBytes+16,'Cache-Control':'no-store'}); res.write(prefix);
    await pipeline(Readable.from(payload()),cipher,tag,res,{signal});
  }
  async function restoreArchive(req, directory, signal) {
    const length = Number(req.headers['content-length']);
    if (!/^\d+$/.test(req.headers['content-length'] || '') || !Number.isSafeInteger(length) || length < 30 || length > MAX_BYTES || req.headers['content-type']?.split(';')[0] !== 'application/octet-stream') throw problem('invalid_upload',413);
    const encrypted=path.join(directory,'encrypted'),payload=path.join(directory,'payload'),archive=path.join(directory,'archive.dump'); let received=0;
    const limiter=new Transform({transform(chunk,_e,done){received+=chunk.length;done(received>length?problem('invalid_upload',413):null,chunk);}});
    await pipeline(req,limiter,fs.createWriteStream(encrypted,{mode:0o600,flags:'wx'}),{signal});
    if(received!==length)throw problem('invalid_upload');
    const lead=await readAt(encrypted,0,12),headerLength=lead.readUInt32BE(8);
    if(!lead.subarray(0,8).equals(MAGIC)||headerLength<2||headerLength>MAX_HEADER||12+headerLength+16>=length)throw problem('invalid_envelope');
    const raw=await readAt(encrypted,12,headerLength),header=JSON.parse(raw.toString()),keys=await pair();
    if(header.version!==1||header.alg!==ALG||header.recipient!==fingerprint(keys.publicKey)||!Number.isSafeInteger(header.ciphertextLength)||header.ciphertextLength<9||12+headerLength+header.ciphertextLength+16!==length)throw problem('invalid_envelope');
    const nonce=Buffer.from(header.nonce||'','base64'),wrapped=Buffer.from(header.wrappedKey||'','base64');
    if(nonce.length!==12||wrapped.length!==384)throw problem('invalid_envelope');
    const key=crypto.privateDecrypt({key:keys.privateKey,padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},wrapped);
    if(key.length!==32)throw problem('invalid_envelope');
    const decipher=crypto.createDecipheriv('aes-256-gcm',key,nonce);key.fill(0);decipher.setAAD(Buffer.concat([lead,raw]));decipher.setAuthTag(await readAt(encrypted,length-16,16));
    await pipeline(fs.createReadStream(encrypted,{start:12+headerLength,end:length-17}),decipher,fs.createWriteStream(payload,{mode:0o600,flags:'wx'}),{signal});
    await fsp.unlink(encrypted);
    const manifestLength=(await readAt(payload,0,4)).readUInt32BE();
    if(manifestLength<2||manifestLength>MAX_MANIFEST||manifestLength+9>header.ciphertextLength)throw problem('manifest_invalid');
    const manifest=JSON.parse((await readAt(payload,4,manifestLength)).toString());validManifest(manifest,sourceId,id);
    if(4+manifestLength+manifest.archiveBytes!==header.ciphertextLength)throw problem('manifest_invalid');
    await pipeline(fs.createReadStream(payload,{start:4+manifestLength}),fs.createWriteStream(archive,{mode:0o600,flags:'wx'}),{signal});await fsp.unlink(payload);
    if(!(await readAt(archive,0,5)).equals(Buffer.from('PGDMP'))||await fileHash(archive)!==manifest.archiveSha256)throw problem('archive_invalid');
    await database(async client=>{
      const before=await version(client);if(before.serverMajor!==manifest.serverMajor)throw problem('version_mismatch',409);
      if(!await empty(client))throw problem('target_not_empty',409);
      await command('pg_restore',['--no-owner','--no-privileges','--exit-on-error','--single-transaction','--dbname',pgEnv.PGDATABASE,archive],pgEnv,signal);
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try {const after=await version(client),data=await checks(client);
        if(after.serverVersion!==before.serverVersion||canonicalChecks(data)!==canonicalChecks(manifest))throw problem('verification_failed',500);
      } finally {await client.query('ROLLBACK').catch(()=>{});}
    },signal);
  }
  const timer=setTimeout(()=>active?.abort(),Math.max(1,expires-now()));timer.unref();
  const server=http.createServer((req,res)=>{(async()=>{
    const route=new URL(req.url,'http://migration.invalid');
    if(route.pathname==='/health'&&req.method==='GET')return json(res,200,{ok:true,maintenance:true});
    if(!route.pathname.startsWith('/migration/')) {res.setHeader('Retry-After','600');if(route.pathname.startsWith('/api/')||(req.headers.accept||'').includes('application/json'))return json(res,503,{error:'서비스 점검 중입니다. 잠시 후 다시 접속해 주세요.',maintenance:true});res.writeHead(503,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><title>서비스 점검 중</title><body><h1>서비스 점검 중입니다.</h1><p>잠시 후 다시 접속해 주세요.</p></body></html>');return;}
    if(route.search)throw problem('query_not_allowed');
    const provided=/^Bearer ([a-fA-F0-9]{64})$/.exec(req.headers.authorization||'');
    if(!provided||!crypto.timingSafeEqual(token,Buffer.from(provided[1],'hex')))throw problem('unauthorized',401);
    if(now()>=expires)throw problem('expired',410);
    if(route.pathname==='/migration/status'&&req.method==='GET')return json(res,200,{mode,state,used,expiresAt:new Date(expires).toISOString()});
    if(busy)throw problem('busy',409);
    if(route.pathname==='/migration/target'&&req.method==='GET'&&mode==='restore'){
      const info=await database(async client=>({empty:await empty(client),...await version(client)}));const keys=await pair();
      return json(res,200,{...info,targetDbId:id,publicKey:keys.publicKey,keyFingerprint:fingerprint(keys.publicKey),expiresAt:new Date(expires).toISOString(),maxUploadBytes:MAX_BYTES});
    }
    if(!((route.pathname==='/migration/export'&&req.method==='GET'&&mode==='export')||(route.pathname==='/migration/restore'&&req.method==='POST'&&mode==='restore')))throw problem('not_found',404);
    if(mode==='restore'&&used)throw problem('already_used',409);
    busy=true;if(mode==='restore')used=true;state=mode==='export'?'exporting':'restoring';active=new AbortController();
    let directory;
    try {directory=await fsp.mkdtemp(path.join(options.tmpRoot||os.tmpdir(),'antsurvival-migration-'));await fsp.chmod(directory,0o700);if(mode==='export')await exportArchive(res,directory,active.signal);else{await restoreArchive(req,directory,active.signal);json(res,200,{ok:true,verified:true});}state=mode==='export'?'exported':'restored';}
    catch(error){state='failed';throw error;}
    finally{if(directory)await fsp.rm(directory,{recursive:true,force:true});busy=false;active=null;}
  })().catch(error=>{if(res.headersSent)res.destroy();else json(res,error.status||500,{error:error.code||'migration_failed'});});});
  server.requestTimeout=7200000;server.headersTimeout=30000;
  server.once('close',()=>{clearTimeout(timer);active?.abort();});
  return server;
}
async function startFromEnv() {
  const server=createMigrationServer();if(!server)return null;
  const port=Number(process.env.PORT||10000);if(!Number.isInteger(port)||port<1||port>65535)throw problem('port_invalid');
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'0.0.0.0',resolve);});return server;
}
module.exports={createMigrationServer,startFromEnv,SOURCE_DB_ID,MAGIC,ALG,MAX_BYTES,canonicalChecks,validManifest};
