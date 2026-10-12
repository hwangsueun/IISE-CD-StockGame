// Usage: node server/deploy/package-quant.cjs /absolute/path/to/signals.json
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { validateArtifact } = require('../src/services/quantReplay');
const source = process.argv[2];
if (!source || !path.isAbsolute(source)) throw new Error('An absolute signals.json source path is required');
const raw = fs.readFileSync(source);
const artifact = JSON.parse(raw);
validateArtifact(artifact);
const metadata = {
  model_version: artifact.model_version,
  data_version: artifact.data_version,
  price_basis: artifact.price_basis,
  execution: artifact.execution,
  sha256: crypto.createHash('sha256').update(raw).digest('hex'),
  bytes: raw.length,
};
fs.writeFileSync(path.join(__dirname, 'quant-signals.json.gz'), zlib.gzipSync(raw, { level: 9 }), { flag: 'wx' });
fs.writeFileSync(path.join(__dirname, 'quant-manifest.json'), JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(metadata, null, 2));
