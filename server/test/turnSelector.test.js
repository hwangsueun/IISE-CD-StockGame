const test = require('node:test');
const assert = require('node:assert/strict');

const dbPath = require.resolve('../src/db');
const servicePath = require.resolve('../src/services/turnSelector');
const realDb = require(dbPath);

function loadService(query) {
  require.cache[dbPath].exports = { ...realDb, query };
  delete require.cache[servicePath];
  return require(servicePath);
}

test.after(() => {
  require.cache[dbPath].exports = realDb;
  delete require.cache[servicePath];
  realDb.pool.end();
});

test('weekday calendar includes weekday holidays but excludes Saturday and Sunday', () => {
  const service = loadService(async () => ({ rows: [] }));

  assert.deepEqual(
    service.buildWeekdayCalendar('2024-02-08', '2024-02-13'),
    ['2024-02-08', '2024-02-09', '2024-02-12', '2024-02-13']
  );
});

test('game calendar fills weekday market holidays missing from stock price dates', async () => {
  const marketDates = ['2024-02-08', '2024-02-13'];
  const service = loadService(async () => ({
    rows: marketDates.map((trade_date) => ({ trade_date })),
  }));

  assert.deepEqual(
    await service.getTradingCalendar(),
    ['2024-02-08', '2024-02-09', '2024-02-12', '2024-02-13']
  );
});

test('selectTurnDates starts and ends on open days while keeping a weekday holiday inside 240 turns', async () => {
  const bootstrap = loadService(async () => ({ rows: [] }));
  const weekdays = bootstrap.buildWeekdayCalendar('2020-01-02', '2021-06-30');
  const holiday = weekdays[10];
  const closedFinalForFirstCandidate = weekdays[239];
  const marketDates = weekdays.filter(
    (date) => date !== holiday && date !== closedFinalForFirstCandidate
  );
  const service = loadService(async () => ({
    rows: marketDates.map((trade_date) => ({ trade_date })),
  }));

  const previousRange = process.env.GAME_START_RANGE;
  process.env.GAME_START_RANGE = `${weekdays[0]}..${weekdays[weekdays.length - 1]}`;
  try {
    const selected = await service.selectTurnDates(() => 0);
    assert.equal(selected.dates.length, 240);
    assert.equal(selected.startDate, weekdays[1]);
    assert.ok(selected.dates.includes(holiday));
    assert.ok(new Set(marketDates).has(selected.dates.at(-1)));
    assert.equal(new Set(selected.dates).size, 240);
    assert.ok(selected.dates.every((date) => {
      const day = new Date(`${date}T00:00:00Z`).getUTCDay();
      return day >= 1 && day <= 5;
    }));
  } finally {
    if (previousRange === undefined) delete process.env.GAME_START_RANGE;
    else process.env.GAME_START_RANGE = previousRange;
  }
});
