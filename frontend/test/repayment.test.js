import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { repaymentVisitWeekday } from '../src/utils/repayment.js';

test('the visit after a Friday repayment turn happens on Monday', () => {
  assert.equal(repaymentVisitWeekday('2024-01-26'), '월요일');
});

test('legacy games use their next weekday rather than an unconditional Monday', () => {
  assert.equal(repaymentVisitWeekday('2024-01-22'), '화요일');
  assert.equal(repaymentVisitWeekday('2024-01-23'), '수요일');
  assert.equal(repaymentVisitWeekday('2024-01-24'), '목요일');
  assert.equal(repaymentVisitWeekday('2024-01-25'), '금요일');
  assert.equal(repaymentVisitWeekday('2024-01-27'), '월요일');
  assert.equal(repaymentVisitWeekday('2024-01-28'), '월요일');
});

test('repayment visit crosses month and year boundaries and handles leap years', () => {
  assert.equal(repaymentVisitWeekday('2024-05-31'), '월요일');
  assert.equal(repaymentVisitWeekday('2021-12-31'), '월요일');
  assert.equal(repaymentVisitWeekday('2024-02-28'), '목요일');
  assert.equal(repaymentVisitWeekday('2024-02-29'), '금요일');
  assert.equal(repaymentVisitWeekday('2023-02-28'), '수요일');
});

test('invalid dates do not produce a misleading weekday', () => {
  for (const value of [undefined, null, 0, '', 'invalid', '2024-02-30', '2023-02-29', '2024-13-01', '2024-00-01', '2024-01-00', '2024-1-26', '2024-01-26T00:00:00Z']) {
    assert.equal(repaymentVisitWeekday(value), '');
  }
});

test('the visit weekday is independent of the player timezone', () => {
  const moduleUrl = new URL('../src/utils/repayment.js', import.meta.url).href;
  const script = `import { repaymentVisitWeekday } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(['2024-01-26', '2024-02-29', '2024-03-08'].map(repaymentVisitWeekday)));`;
  for (const timezone of ['Asia/Seoul', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
    const result = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ: timezone },
      encoding: 'utf8',
    });
    assert.deepEqual(JSON.parse(result), ['월요일', '금요일', '월요일']);
  }
});
