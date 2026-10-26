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

test('selectTurnDates skips closed Mondays and closed final days while keeping weekday holidays inside 240 turns', async () => {
  const bootstrap = loadService(async () => ({ rows: [] }));
  const weekdays = bootstrap.buildWeekdayCalendar('2020-01-02', '2021-06-30');
  const mondayIndices = weekdays.flatMap((date, index) =>
    new Date(`${date}T00:00:00Z`).getUTCDay() === 1 ? [index] : []
  );
  const closedMonday = weekdays[mondayIndices[0]];
  const closedFinalForSecondMonday = weekdays[mondayIndices[1] + 239];
  const holiday = weekdays[20];
  const marketDates = weekdays.filter(
    (date) => date !== holiday && date !== closedMonday && date !== closedFinalForSecondMonday
  );
  const service = loadService(async () => ({
    rows: marketDates.map((trade_date) => ({ trade_date })),
  }));

  const previousRange = process.env.GAME_START_RANGE;
  process.env.GAME_START_RANGE = `${weekdays[0]}..${weekdays[weekdays.length - 1]}`;
  try {
    const selected = await service.selectTurnDates(() => 0);
    assert.equal(selected.dates.length, 240);
    assert.equal(selected.startDate, weekdays[mondayIndices[2]]);
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

test('selectTurnDates randomly selects only Mondays within the configured start range', async () => {
  const bootstrap = loadService(async () => ({ rows: [] }));
  const marketDates = bootstrap.buildWeekdayCalendar('2020-01-02', '2021-06-30');
  const service = loadService(async () => ({
    rows: marketDates.map((trade_date) => ({ trade_date })),
  }));
  const previousRange = process.env.GAME_START_RANGE;
  process.env.GAME_START_RANGE = '2020-01-02..2020-03-31';
  try {
    const starts = new Set();
    for (const random of [0, 0.2, 0.5, 0.999999]) {
      const selected = await service.selectTurnDates(() => random);
      starts.add(selected.startDate);
      assert.equal(new Date(`${selected.startDate}T00:00:00Z`).getUTCDay(), 1);
      assert.ok(selected.startDate >= '2020-01-02' && selected.startDate <= '2020-03-31');
      assert.equal(selected.dates.length, 240);
      assert.equal(new Date(`${selected.dates[19]}T00:00:00Z`).getUTCDay(), 5);
    }
    assert.equal(starts.size, 4);
  } finally {
    if (previousRange === undefined) delete process.env.GAME_START_RANGE;
    else process.env.GAME_START_RANGE = previousRange;
  }
});

test('selectTurnDates rejects a start range without an eligible Monday', async () => {
  const bootstrap = loadService(async () => ({ rows: [] }));
  const marketDates = bootstrap.buildWeekdayCalendar('2020-01-02', '2021-06-30');
  const service = loadService(async () => ({
    rows: marketDates.map((trade_date) => ({ trade_date })),
  }));
  const previousRange = process.env.GAME_START_RANGE;
  process.env.GAME_START_RANGE = '2020-01-07..2020-01-09';
  try {
    await assert.rejects(service.selectTurnDates(() => 0), /월요일 개장일이 없습니다/);
  } finally {
    if (previousRange === undefined) delete process.env.GAME_START_RANGE;
    else process.env.GAME_START_RANGE = previousRange;
  }
});
