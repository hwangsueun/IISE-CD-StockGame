const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '../../..');

function pythonExecutable({ explain = false, env = process.env, platform = process.platform, exists = fs.existsSync, projectRoot = root } = {}) {
  const configured = (explain && env.QUANT_EXPLAIN_PYTHON) || env.USER_STRATEGY_PYTHON;
  if (configured) return configured.includes('/') || configured.includes('\\') ? path.resolve(projectRoot, configured) : configured;
  const executable = platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
  for (const directory of ['.runtime', '.venv']) {
    const candidate = path.join(projectRoot, 'quant', directory, executable);
    if (exists(candidate)) return candidate;
  }
  return platform === 'win32' ? 'python' : 'python3';
}
const setupCommand = 'node scripts/setup-model-runtime.cjs';
function unavailableReason(missing = []) {
  const packages = missing.map(name => name === 'sklearn' ? 'scikit-learn' : name);
  return `학습 환경이 준비되지 않았습니다.${packages.length ? ` 필요한 패키지: ${packages.join(', ')}.` : ' Python 실행 환경을 확인해 주세요.'} 저장소 폴더에서 ${setupCommand}를 실행한 뒤 서버를 다시 시작해 주세요. 다른 PC의 USER_STRATEGY_PYTHON 경로가 남아 있다면 삭제하거나 수정해 주세요.`;
}
module.exports = { pythonExecutable, setupCommand, unavailableReason, root };
