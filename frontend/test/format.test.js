import test from 'node:test';
import assert from 'node:assert/strict';

import { relativeDateValue, relativeYearDate, relativeYearLabel } from '../src/utils/format.js';

test('relative year labels use the game turn year instead of the real current year', () => {
  const gameDate = '2012-01-17';

  assert.equal(relativeYearLabel(2012, gameDate), '올해');
  assert.equal(relativeYearLabel(2010, gameDate), '2년 전');
  assert.equal(relativeYearLabel(2014, gameDate), '2년 후');
});

test('news and chart dates are relative to the supplied game turn', () => {
  const gameDate = '2012-08-20';

  assert.equal(relativeYearDate('2012-01-17', gameDate), '01/17');
  assert.equal(relativeYearDate('2011-12-03', gameDate), '1년 전 12/03');
});

test('maturity dates use the game turn while duration values remain unchanged', () => {
  const gameDate = '2012-08-20';

  assert.equal(relativeDateValue('2015-09-30', gameDate), '3년 후 09/30');
  assert.equal(relativeDateValue('2012-09-30', gameDate), '09/30');
  assert.equal(relativeDateValue('2012-04', gameDate), '04월');
  assert.equal(relativeDateValue('2011-04', gameDate), '1년 전 04월');
  assert.equal(relativeDateValue('3년', gameDate), '3년');
});

test('relative formatting does not silently fall back to the machine clock', () => {
  assert.equal(relativeYearLabel(2012), '연도 미상');
});
