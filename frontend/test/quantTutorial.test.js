import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldStartQuantTour, QUANT_TOUR_TURN } from '../src/utils/quantTutorial.js';

const ready = () => ({
  turn: { turnNumber: 11, isRepaymentTurn: false, actionLocked: false },
  loading: false, pendingTurnNumber: null, pendingEvents: [], surgeResults: [],
  surgePromptPending: false, faintEvent: undefined, activeModal: null,
  tutorialStep: null, firstDayStep: null, quantTourStep: null,
  tutorialProgress: { welcome: true },
});

test('alpha158 tour begins on day 11 and catches up after a delayed visit', () => {
  assert.equal(QUANT_TOUR_TURN, 11);
  assert.equal(shouldStartQuantTour({ ...ready(), turn: { turnNumber: 10 } }), false);
  assert.equal(shouldStartQuantTour(ready()), true);
  assert.equal(shouldStartQuantTour({ ...ready(), turn: { turnNumber: 21 } }), true);
});

test('alpha158 tour waits for loading, required events and open screens to finish', () => {
  const blockers = [
    { turn: null }, { loading: true }, { pendingTurnNumber: 11 },
    { pendingEvents: [{ eventType: 'choice' }] }, { surgeResults: [{}] },
    { surgePromptPending: true }, { faintEvent: {} }, { activeModal: 'market' },
    { activeModal: 'repay' }, { tutorialStep: 1 }, { firstDayStep: 2 },
    { turn: { turnNumber: 20, isRepaymentTurn: true } },
    { turn: { turnNumber: 11, actionLocked: true } },
  ];
  for (const blocker of blockers) {
    assert.equal(shouldStartQuantTour({ ...ready(), ...blocker }), false, JSON.stringify(blocker));
  }
  const state = { ...ready(), pendingEvents: [{}] };
  assert.equal(shouldStartQuantTour(state), false);
  state.pendingEvents = [];
  assert.equal(shouldStartQuantTour(state), true);
});

test('alpha158 tour never overlaps onboarding or repeats after completion', () => {
  assert.equal(shouldStartQuantTour({ ...ready(), tutorialProgress: {} }), false);
  assert.equal(shouldStartQuantTour({ ...ready(), quantTourStep: 1 }), false);
  assert.equal(shouldStartQuantTour({ ...ready(), tutorialProgress: { welcome: true, quantTour: true } }), false);
});
