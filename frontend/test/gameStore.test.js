import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { create } from 'zustand';

// Run the actual store with isolated API/storage dependencies, without a browser or HTTP server.
const storeSource = readFileSync(new URL('../src/state/gameStore.js', import.meta.url), 'utf8')
  .replace(/^import .+;\n/gm, '')
  .replace('import.meta.env?.DEV', 'false')
  .replace('export const useGameStore =', 'globalThis.useGameStore =');

function fixture(api) {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const errors = [];
  const context = {
    create, api: { getPendingEvents: async () => [], ...api }, localStorage: storage, sessionStorage: storage,
    TUTORIALS: {}, readTutorialProgress: () => ({}),
    console: { error: (...args) => errors.push(args) },
  };
  runInNewContext(storeSource, context);
  const store = context.useGameStore;
  const state = { cash: 10000, debt: 50000, trust: 99, stress: 2, totalAsset: 15000 };
  store.setState({
    sessionId: 'game-a', status: 'active', state,
    turn: { turnNumber: 20, isRepaymentTurn: true, repaymentCompleted: false, state: { ...state } },
  });
  return { store, errors };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const paid = () => ({
  status: 'active', dueAmount: 1000, paidAmount: 1000,
  cashBefore: 10000, debtBefore: 50000, cash: 9000, debtRemaining: 49000,
  trustDelta: 2, stressDelta: -5,
});

test('successful repayment remains successful when the following turn refresh fails', async () => {
  const result = paid();
  const { store, errors } = fixture({
    repay: async () => result,
    getTurn: async () => { throw new Error('offline'); },
  });
  assert.equal(await store.getState().repay(1000), result);
  const current = store.getState();
  assert.equal(current.state.cash, 9000);
  assert.equal(current.state.debt, 49000);
  assert.equal(current.state.totalAsset, 14000);
  assert.equal(current.state.trust, 100);
  assert.equal(current.state.stress, 0);
  assert.equal(current.turn.state.cash, 9000);
  assert.equal(current.turn.repaymentCompleted, true);
  assert.equal(current.turn.repaymentDueAmount, 1000);
  assert.equal(current.pendingTurnNumber, null);
  assert.equal(current.error, null);
  assert.equal(errors.length, 1);
});

test('repayment updates the account and completion flag before the refresh finishes', async () => {
  const refresh = deferred();
  const refreshStarted = deferred();
  const { store } = fixture({
    repay: async () => ({ ...paid(), trust: 87, stress: 14 }),
    getTurn: () => { refreshStarted.resolve(); return refresh.promise; },
  });
  const request = store.getState().repay(1000);
  await refreshStarted.promise;
  assert.equal(store.getState().turn.repaymentCompleted, true);
  assert.equal(store.getState().state.trust, 87);
  assert.equal(store.getState().state.stress, 14);
  refresh.resolve(store.getState().turn);
  await request;
});

test('a delayed repayment response cannot overwrite a restarted session, even with the same ID', async () => {
  const post = deferred();
  const { store } = fixture({ repay: () => post.promise, getTurn: () => assert.fail('stale response must not refresh') });
  const request = store.getState().repay(1000);
  store.getState().resetGame();
  store.setState({ sessionId: 'game-a', state: { cash: 7777 }, turn: { turnNumber: 1 } });
  post.resolve(paid());
  await request;
  assert.equal(store.getState().state.cash, 7777);
  assert.equal(store.getState().turn.turnNumber, 1);
  assert.equal(store.getState().turn.repaymentCompleted, undefined);
});

test('a turn request started before repayment cannot undo the final account state', async () => {
  const oldRefresh = deferred();
  const result = { ...paid(), status: 'success', debtRemaining: 0, cash: 1234, totalAsset: 8765, trust: 100, stress: 0 };
  const { store } = fixture({ repay: async () => result, getTurn: () => oldRefresh.promise });
  const oldTurn = store.getState().turn;
  const oldRequest = store.getState().loadTurn(20);
  await store.getState().repay(1000);
  oldRefresh.resolve(oldTurn);
  await oldRequest;
  assert.equal(store.getState().status, 'success');
  assert.equal(store.getState().state.cash, 1234);
  assert.equal(store.getState().state.debt, 0);
  assert.equal(store.getState().state.totalAsset, 8765);
  assert.equal(store.getState().turn.repaymentCompleted, true);
});

test('a repayment response for a prior turn refreshes the current turn without applying old balances', async () => {
  const post = deferred();
  const refresh = deferred();
  const refreshStarted = deferred();
  let requestedTurn;
  const { store } = fixture({
    repay: () => post.promise,
    getTurn: (sid, turn) => { requestedTurn = turn; refreshStarted.resolve(); return refresh.promise; },
  });
  const request = store.getState().repay(1000);
  const newerTurn = { turnNumber: 21, state: { cash: 2222, debt: 49000 } };
  store.setState({ turn: newerTurn, state: newerTurn.state });
  post.resolve(paid());
  await refreshStarted.promise;
  assert.equal(requestedTurn, 21);
  assert.equal(store.getState().state.cash, 2222);
  assert.equal(store.getState().turn.repaymentCompleted, undefined);
  refresh.resolve(newerTurn);
  await request;
});

test('ending an unpaid repayment turn opens the visit before any next-turn request', async () => {
  const { store } = fixture({ nextTurn: () => assert.fail('repayment must finish first') });
  assert.equal(store.getState().activeModal, null);
  await store.getState().advanceTurn();
  assert.equal(store.getState().turn.turnNumber, 20);
  assert.equal(store.getState().activeModal, 'repay');
  assert.equal(store.getState().modalProps.advanceAfterRepayment, true);
  assert.equal(store.getState().loading, false);
  await store.getState().advanceTurn();
  assert.equal(store.getState().turn.turnNumber, 20);
});

test('after repayment, ending the day advances exactly once despite repeated clicks', async () => {
  const next = deferred();
  let advances = 0;
  const { store } = fixture({
    nextTurn: () => { advances += 1; return next.promise; },
    getTurn: async (_sid, turnNumber) => ({ turnNumber, isRepaymentTurn: false, repaymentCompleted: false, state: {} }),
  });
  store.setState({ turn: { ...store.getState().turn, repaymentCompleted: true } });
  const request = store.getState().advanceTurn();
  await store.getState().advanceTurn();
  assert.equal(advances, 1);
  assert.equal(store.getState().activeModal, null);
  next.resolve({ status: 'active', turnNumber: 21, events: [] });
  await request;
  assert.equal(store.getState().turn.turnNumber, 21);
  assert.equal(store.getState().loading, false);
});

test('hospitalization bypasses the visit and lets the server process missed repayment', async () => {
  let advances = 0;
  const { store } = fixture({
    nextTurn: async () => { advances += 1; return { status: 'active', turnNumber: 21, events: [] }; },
    getTurn: async () => ({ turnNumber: 21, isRepaymentTurn: false, state: {} }),
  });
  store.setState({ turn: { ...store.getState().turn, actionLocked: true } });
  await store.getState().advanceTurn();
  assert.equal(advances, 1);
  assert.equal(store.getState().activeModal, null);
  assert.equal(store.getState().turn.turnNumber, 21);
});

test('ordinary days advance without a repayment visit', async () => {
  const { store } = fixture({
    nextTurn: async () => ({ status: 'active', turnNumber: 20, events: [] }),
    getTurn: async () => ({ turnNumber: 20, isRepaymentTurn: true, repaymentCompleted: false, state: {} }),
  });
  store.setState({ turn: { ...store.getState().turn, turnNumber: 19, isRepaymentTurn: false } });
  await store.getState().advanceTurn();
  assert.equal(store.getState().turn.turnNumber, 20);
  assert.equal(store.getState().activeModal, null);
});

test('a failed turn refresh cannot be followed by another next-turn request', async () => {
  let advances = 0;
  const { store } = fixture({
    nextTurn: async () => { advances += 1; return { status: 'active', turnNumber: 21, events: [] }; },
    getTurn: async () => { throw new Error('offline'); },
  });
  store.setState({ turn: { ...store.getState().turn, repaymentCompleted: true } });
  await store.getState().advanceTurn();
  assert.equal(store.getState().pendingTurnNumber, 21);
  assert.equal(store.getState().turnLoadError, 'offline');
  await store.getState().advanceTurn();
  assert.equal(advances, 1);
});

test('resume restores current and earlier unresolved choices before allowing another turn', async () => {
  const pending = [
    { event_log_id: 41, event_type: 'travel', turn_number: 18, detail: { prompt: '여행', choices: [{ key: 'skip' }] } },
    { event_log_id: 42, event_type: 'invest_study', turn_number: 21, detail: { prompt: '스터디', choices: [{ key: 'join' }] } },
  ];
  const { store } = fixture({
    getState: async () => ({ currentTurn: 21, status: 'active', cash: 10000 }),
    getTurn: async (_sid, turnNumber) => ({ turnNumber, state: { cash: 10000 } }),
    getPendingEvents: async () => pending,
    nextTurn: () => assert.fail('unresolved choices must block advancement'),
  });
  await store.getState().resumeGame();
  const events = store.getState().pendingEvents;
  assert.equal(events.length, 2);
  assert.equal(events[0].eventLogId, 41);
  assert.equal(events[0].eventType, 'travel');
  assert.equal(events[0].turnNumber, 18);
  assert.equal(events[0].prompt, '여행');
  assert.equal(events[0].choices[0].key, 'skip');
  assert.equal(events[1].eventLogId, 42);
  await store.getState().advanceTurn();
  assert.equal(store.getState().turn.turnNumber, 21);
});

test('failed pending-event recovery blocks advancement and is retried with the turn', async () => {
  let pendingReads = 0;
  const { store } = fixture({
    getState: async () => ({ currentTurn: 21, status: 'active' }),
    getTurn: async (_sid, turnNumber) => ({ turnNumber, state: {} }),
    getPendingEvents: async () => {
      if (++pendingReads === 1) throw new Error('events offline');
      return [{ event_log_id: 43, event_type: 'loan_shark_call', detail: { choices: [{ key: 'hang_up' }] } }];
    },
    nextTurn: () => assert.fail('unread events must block advancement'),
  });
  await store.getState().resumeGame();
  assert.equal(store.getState().pendingTurnNumber, 21);
  assert.equal(store.getState().turnLoadError, 'events offline');
  await store.getState().advanceTurn();
  await store.getState().retryPendingTurn();
  assert.equal(pendingReads, 2);
  assert.equal(store.getState().pendingTurnNumber, null);
  assert.equal(store.getState().turnLoadError, null);
  assert.equal(store.getState().pendingEvents[0].eventLogId, 43);
});

test('pending choices arriving after a session switch cannot leak into the new game', async () => {
  const pending = deferred();
  const pendingStarted = deferred();
  const { store } = fixture({
    getState: async () => ({ currentTurn: 21, status: 'active' }),
    getTurn: async () => ({ turnNumber: 21, state: {} }),
    getPendingEvents: () => { pendingStarted.resolve(); return pending.promise; },
  });
  const request = store.getState().resumeGame();
  await pendingStarted.promise;
  store.getState().resetGame();
  store.setState({ sessionId: 'game-a', turn: { turnNumber: 1 }, state: { cash: 7777 } });
  pending.resolve([{ event_log_id: 44, event_type: 'travel' }]);
  await request;
  assert.equal(store.getState().turn.turnNumber, 1);
  assert.equal(store.getState().state.cash, 7777);
  assert.equal(store.getState().pendingEvents.length, 0);
});

test('a successful event choice returns its result even when the following refresh fails', async () => {
  const result = { status: 'active', cash: 9000, debt: 49000, trust: 99, stress: 0, cashDelta: -1000 };
  let posts = 0;
  const { store, errors } = fixture({
    resolveEvent: async () => { posts += 1; return result; },
    getTurn: async () => { throw new Error('offline'); },
  });
  store.setState({ pendingEvents: [{ eventLogId: 45, eventType: 'loan_shark_call' }] });
  assert.equal(await store.getState().resolveEvent(45, 'pay', { amount: 1000 }), result);
  assert.equal(posts, 1);
  assert.equal(store.getState().state.cash, 9000);
  assert.equal(store.getState().state.totalAsset, 14000);
  assert.equal(store.getState().turn.state.debt, 49000);
  assert.equal(store.getState().pendingEvents.length, 1); // Keep the result visible until confirmation.
  store.getState().dismissEvent(45);
  assert.equal(store.getState().pendingEvents.length, 0);
  assert.equal(errors.length, 1);
});

test('a restored old event refreshes the current turn and keeps its result until dismissed', async () => {
  let refreshedTurn;
  const { store } = fixture({
    resolveEvent: async () => ({ status: 'active', cash: 10000, stress: 0 }),
    getTurn: async (_sid, turnNumber) => { refreshedTurn = turnNumber; return { turnNumber, state: { cash: 10000, stress: 0 } }; },
    getPendingEvents: () => assert.fail('same-turn refresh must not remove a result awaiting confirmation'),
  });
  store.setState({ pendingEvents: [{ eventLogId: 46, eventType: 'invest_study', turnNumber: 17 }] });
  await store.getState().resolveEvent(46, 'join');
  assert.equal(refreshedTurn, 20);
  assert.equal(store.getState().pendingEvents[0].eventLogId, 46);
});

test('event completion invalidates an earlier turn response and cannot restore old balances', async () => {
  const oldRefresh = deferred();
  const oldStarted = deferred();
  let reads = 0;
  const { store } = fixture({
    resolveEvent: async () => ({ status: 'active', cash: 9000, debt: 49000, stress: 0 }),
    getTurn: () => {
      if (++reads === 1) { oldStarted.resolve(); return oldRefresh.promise; }
      throw new Error('new refresh offline');
    },
  });
  const oldTurn = store.getState().turn;
  const request = store.getState().loadTurn(20);
  await oldStarted.promise;
  await store.getState().resolveEvent(47, 'pay');
  oldRefresh.resolve(oldTurn);
  await request;
  assert.equal(store.getState().state.cash, 9000);
  assert.equal(store.getState().turn.state.debt, 49000);
});

test('event POST failure remains a failure without applying or discarding the pending choice', async () => {
  const { store } = fixture({
    resolveEvent: async () => { throw new Error('offline'); },
    getTurn: () => assert.fail('failed POST must not refresh'),
  });
  store.setState({ pendingEvents: [{ eventLogId: 48 }] });
  await assert.rejects(store.getState().resolveEvent(48, 'join'), /offline/);
  assert.equal(store.getState().state.cash, 10000);
  assert.equal(store.getState().pendingEvents.length, 1);
});
