const test = require('node:test');
const assert = require('node:assert/strict');

const { loanSharkCallProb } = require('../src/services/trustPolicy');

test('loan-shark call probability follows the rebalanced trust curve', () => {
  assert.equal(loanSharkCallProb(100), 0.05);
  assert.equal(loanSharkCallProb(50), 0.125);
  assert.equal(loanSharkCallProb(0), 0.20);
});
