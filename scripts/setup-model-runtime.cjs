#!/usr/bin/env node
// Run from any directory. Never modifies .env, existing models, or the database.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
let requestedPython, directory = path.join(root, 'quant', '.runtime'), checkOnly = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--python' && args[i + 1]) requestedPython = args[++i];
  else if (args[i] === '--venv' && args[i + 1]) directory = path.resolve(args[++i]);
  else if (args[i] === '--check') checkOnly = true;
  else { console.error('Usage: node scripts/setup-model-runtime.cjs [--python python3.12] [--venv PATH] [--check]'); process.exit(1); }
}
const executable = path.join(directory, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const environment = { ...process.env, OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', MKL_NUM_THREADS: '1', PYTHONDONTWRITEBYTECODE: '1' };
function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: root, env: environment, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw Error(`${command} 실행 실패. Python 3.11 이상을 설치하고 위 오류를 확인해 주세요.`);
}
try {
  if (!checkOnly) {
    if (!fs.existsSync(executable)) {
      const candidates = requestedPython ? [[requestedPython]] : process.platform === 'win32'
        ? [['py', '-3.12'], ['py', '-3.11'], ['python']] : [['python3.12'], ['python3.11'], ['python3']];
      const interpreter = candidates.find(([command, ...prefix]) => {
        const result = spawnSync(command, [...prefix, '-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'], { stdio: 'ignore' });
        return !result.error && result.status === 0;
      });
      if (!interpreter) throw Error('Python 3.11 이상을 찾지 못했습니다. Python 3.12를 설치한 뒤 다시 실행해 주세요.');
      console.log('게임의 투자 모델 전용 Python 환경을 만듭니다.');
      run(interpreter[0], [...interpreter.slice(1), '-m', 'venv', directory]);
    }
    console.log('투자 모델과 Alpha158 분석에 필요한 패키지를 설치합니다.');
    run(executable, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', path.join(root, 'quant/runtime-requirements.txt')]);
  }
  if (!fs.existsSync(executable)) throw Error('모델 환경이 없습니다. 먼저 node scripts/setup-model-runtime.cjs를 실행해 주세요.');
  const result = spawnSync(executable, [path.join(root, 'quant/check_runtime.py')], { cwd: root, env: environment, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw Error('모델 환경을 확인할 수 없습니다. Python 설치와 실행 권한을 확인해 주세요.');
  const report = JSON.parse(result.stdout);
  for (const [name, module] of Object.entries(report.modules)) console.log(`${module.available ? 'OK' : 'MISSING'} ${name}${module.version ? ` ${module.version}` : ` (${module.error})`}`);
  if (!report.ready) throw Error('필요한 패키지를 불러오지 못했습니다. macOS에서 libomp 오류가 나면 brew install libomp 후 다시 실행하세요. Linux는 libgomp1이 필요합니다.');
  console.log(`완료: ${executable}`);
  console.log(directory === path.join(root, 'quant', '.runtime')
    ? 'API 서버를 다시 시작하고 투자 모델 화면을 열어 주세요. 기본 경로는 자동으로 인식됩니다.'
    : '다른 경로에 설치했습니다. USER_STRATEGY_PYTHON에 위 Python 경로를 지정한 뒤 API 서버를 다시 시작해 주세요.');
  console.log('기존 .env의 USER_STRATEGY_PYTHON 또는 QUANT_EXPLAIN_PYTHON이 다른 PC 경로라면 삭제하거나 새 환경으로 수정하세요.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
