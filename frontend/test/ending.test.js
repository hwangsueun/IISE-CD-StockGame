import test from 'node:test';
import assert from 'node:assert/strict';
import { gameDuration, hasReachedEndingDeadline } from '../src/utils/ending.js';

test('early endings preserve actual elapsed turns instead of rounding up to a month or year', () => {
  assert.equal(gameDuration(1), '1일');
  assert.equal(gameDuration(19), '19일');
  assert.equal(gameDuration(20), '1개월');
  assert.equal(gameDuration(40), '2개월');
  assert.equal(gameDuration(41), '2개월 1일');
  assert.equal(gameDuration(239), '11개월 19일');
  assert.equal(gameDuration(240), '1년');
});

test('a trust failure before the deadline must not claim that the full year has elapsed', () => {
  assert.equal(hasReachedEndingDeadline(40), false);
  assert.equal(hasReachedEndingDeadline(239), false);
  assert.equal(hasReachedEndingDeadline(240), true);
});
