// Render's existing build runs npm ci here. Fail the build if any model is missing.
if (process.env.RENDER === 'true') {
  const { execFileSync } = require('node:child_process');
  const path = require('node:path');
  execFileSync(process.execPath, [path.resolve(__dirname, '../../scripts/setup-model-runtime.cjs')], { stdio: 'inherit' });
}
