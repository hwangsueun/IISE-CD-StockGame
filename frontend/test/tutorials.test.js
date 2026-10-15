import test from 'node:test';
import assert from 'node:assert/strict';
import { TUTORIAL_STORAGE_KEY, readTutorialProgress, saveTutorialProgress } from '../src/utils/tutorials.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('tutorial completion survives reload without suppressing other categories', () => {
  const storage = memoryStorage();
  saveTutorialProgress({ welcome: true, market: true }, storage);
  const reloaded = readTutorialProgress(storage);
  assert.deepEqual(reloaded, { welcome: true, market: true });
  assert.equal(reloaded.news, undefined);
  saveTutorialProgress({ ...reloaded, news: true }, storage);
  assert.deepEqual(readTutorialProgress(storage), { welcome: true, market: true, news: true });
});

test('the old whole-game tutorial does not hide unseen category explanations', () => {
  const storage = memoryStorage({ antsurvival_tutorial_done: '1' });
  assert.deepEqual(readTutorialProgress(storage), {});
});

test('corrupt or invalid stored progress is ignored', () => {
  for (const value of ['broken', 'null', '1', '[]', '"market"']) {
    assert.deepEqual(readTutorialProgress(memoryStorage({ [TUTORIAL_STORAGE_KEY]: value })), {});
  }
  const value = JSON.stringify({ market: true, news: 'true', portfolio: false, unknown: true });
  assert.deepEqual(readTutorialProgress(memoryStorage({ [TUTORIAL_STORAGE_KEY]: value })), { market: true });
});

test('blocked browser storage does not prevent opening or finishing an explanation', () => {
  const storage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } };
  assert.deepEqual(readTutorialProgress(storage), {});
  assert.doesNotThrow(() => saveTutorialProgress({ news: true }, storage));
});

test('finishing the day-10 quant tour is remembered after reload', () => {
  const storage = memoryStorage();
  saveTutorialProgress({ welcome: true, quant: true, quantTour: true }, storage);
  assert.deepEqual(readTutorialProgress(storage), { welcome: true, quant: true, quantTour: true });
});
