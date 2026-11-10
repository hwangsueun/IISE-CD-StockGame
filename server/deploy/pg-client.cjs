// Use the official, pinned Linux/x64 PG16 client without installing host packages.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');

const TOOL_NAMES = new Set(['pg_dump', 'pg_restore']);
const SHA256 = /^[a-f0-9]{64}$/;
let preparing;

const hash = data => createHash('sha256').update(data).digest('hex');

function validateManifest(manifest) {
  if (manifest.schemaVersion !== 1 || manifest.platform !== 'linux' || manifest.architecture !== 'x64'
      || manifest.postgresMajor !== 16 || manifest.loader !== 'lib/ld-linux-x86-64.so.2'
      || manifest.archive?.file !== 'pg-client-linux-x64.tar.gz' || !SHA256.test(manifest.archive.sha256)
      || !manifest.files || !Object.keys(manifest.files).length) throw new Error('Invalid PG client manifest');
  for (const [relative, entry] of Object.entries(manifest.files)) {
    if (!/^(bin|lib|licenses)\/[A-Za-z0-9_.+:-]+$/.test(relative)
        || !SHA256.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0
        || ![0o644, 0o755].includes(entry.mode)) throw new Error('Invalid PG client file manifest');
  }
  for (const relative of ['bin/pg_dump', 'bin/pg_restore', manifest.loader]) {
    if (!manifest.files[relative]) throw new Error('Incomplete PG client manifest');
  }
  return manifest;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let errorOutput = '';
    child.stderr.on('data', data => { if (errorOutput.length < 2000) errorOutput += data; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`PG client extraction failed (${code}): ${errorOutput}`)));
  });
}

async function verifyFiles(directory, manifest) {
  for (const [relative, expected] of Object.entries(manifest.files)) {
    const filename = path.join(directory, relative);
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expected.bytes
        || (stat.mode & 0o777) !== expected.mode || hash(await fs.readFile(filename)) !== expected.sha256) {
      throw new Error('PG client extracted file integrity check failed');
    }
  }
}

async function extractBundle(options = {}) {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error('Bundled PostgreSQL tools require Linux x64');
  }
  const bundleDir = options.bundleDir || __dirname;
  const manifest = validateManifest(JSON.parse(await fs.readFile(path.join(bundleDir, 'pg-client.manifest.json'), 'utf8')));
  const archive = path.join(bundleDir, manifest.archive.file);
  const bytes = await fs.readFile(archive);
  if (bytes.length !== manifest.archive.bytes || hash(bytes) !== manifest.archive.sha256) {
    throw new Error('PG client archive SHA256 mismatch');
  }
  const directory = await fs.mkdtemp(path.join(options.cacheDir || os.tmpdir(), 'antsurvival-pg-client-'));
  await fs.chmod(directory, 0o700);
  try {
    await run('tar', ['-xzf', archive, '--no-same-owner', '--same-permissions', '-C', directory]);
    await verifyFiles(directory, manifest);
    return { directory, manifest };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function getPgTools(tool) {
  if (!TOOL_NAMES.has(tool)) throw new Error('Unsupported PostgreSQL client tool');
  // One extraction per process; a failed attempt can be retried explicitly.
  if (!preparing) preparing = extractBundle().catch(error => { preparing = undefined; throw error; });
  const { directory, manifest } = await preparing;
  return { command: path.join(directory, manifest.loader),
    argsPrefix: ['--inhibit-cache', '--library-path', path.join(directory, 'lib'), path.join(directory, 'bin', tool)] };
}

module.exports = { getPgTools, extractBundle, validateManifest, verifyFiles };
