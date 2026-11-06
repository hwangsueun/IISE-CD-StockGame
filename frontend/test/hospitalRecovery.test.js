import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldAdvanceHospitalDay } from '../src/utils/hospitalRecovery.js';

const ready = {
  turn: { turnNumber: 20, actionLocked: true, isRepaymentTurn: true },
  status: 'active', loading: false, error: null, turnLoadError: null,
  pendingTurnNumber: null, pendingEvents: [], surgeResults: [], surgePromptPending: false,
  faintEvent: null, activeModal: null, tutorialStep: null, firstDayStep: null, quantTourStep: null,
};

test('hospital recovery advances locked days, including repayment days, and stops on discharge or ending', () => {
  assert.equal(shouldAdvanceHospitalDay(ready), true);
  assert.equal(shouldAdvanceHospitalDay({ ...ready, turn: { actionLocked: false } }), false);
  assert.equal(shouldAdvanceHospitalDay({ ...ready, status: 'failed' }), false);
  assert.equal(shouldAdvanceHospitalDay({ ...ready, status: 'success' }), false);
});

test('hospital recovery waits for narration, unsettled requests, existing choices and user screens', () => {
  for (const change of [
    { loading: true }, { pendingTurnNumber: 21 }, { faintEvent: {} },
    { pendingEvents: [{}] }, { surgeResults: [{}] }, { surgePromptPending: true },
    { activeModal: 'portfolio' }, { tutorialStep: 1 }, { firstDayStep: 1 }, { quantTourStep: 1 },
  ]) assert.equal(shouldAdvanceHospitalDay({ ...ready, ...change }), false, JSON.stringify(change));
});

test('failed hospital requests stop automatic retries until the user retries the saved transition', () => {
  assert.equal(shouldAdvanceHospitalDay({ ...ready, error: 'network unavailable' }), false);
  assert.equal(shouldAdvanceHospitalDay({ ...ready, turnLoadError: 'refresh failed', pendingTurnNumber: 21 }), false);
});
