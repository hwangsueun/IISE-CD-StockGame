// 스텁 데이터 생성기 (ARCHITECTURE.md §3: 데이터 미완성 시에도 개발 가능해야 한다)
// 실데이터 없이 프론트/백엔드 개발용 최소 데이터를 합성 적재한다.
// - 주식 20 + 코인 5 (채권 4는 migration 시드) = 29자산
// - 2013-01-02부터 평일 300일 시세 (랜덤워크)
// - 하루 3~8건 뉴스, 종목당 게시글/댓글, 거시지표 4종
const { bulkInsert, pool } = require('./lib/db');

const DAYS = 300;
const START = new Date('2013-01-02');

function* weekdays(n) {
  const d = new Date(START);
  let count = 0;
  while (count < n) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) {
      yield d.toISOString().slice(0, 10);
      count++;
    }
    d.setDate(d.getDate() + 1);
  }
}

const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function seedStub() {
  const dates = [...weekdays(DAYS)];

  // --- 자산 ---
  const stocks = Array.from({ length: 20 }, (_, i) => {
    const code = String(100000 + i).slice(1);
    return { assetId: `STOCK_${code}`, code, name: `스텁종목${i + 1}`, masked: `종목${String(i + 1).padStart(3, '0')}`, sector: pick(['반도체', '자동차', '화학', '금융', '바이오']) };
  });
  const coins = ['BITCOIN', 'ETHEREUM', 'RIPPLE', 'DOGECOIN', 'SOLANA'].map((c) => ({
    assetId: `COIN_${c}`, code: c.toLowerCase(), name: c, masked: c,
  }));

  await bulkInsert('assets', ['asset_id', 'asset_type', 'code', 'name', 'masked_name', 'sector', 'currency'], [
    ...stocks.map((s) => [s.assetId, 'stock', s.code, s.name, s.masked, s.sector, 'KRW']),
    ...coins.map((c) => [c.assetId, 'coin', c.code, c.name, c.masked, null, 'KRW']),
  ]);
  await bulkInsert('coin_info', ['asset_id', 'symbol', 'survived_to_2023'], coins.map((c) => [c.assetId, c.code.slice(0, 3), true]));

  // --- 시세 (랜덤워크) + 채권 포함 ---
  const allIds = [
    ...stocks.map((s) => ({ id: s.assetId, p0: rand(5000, 200000), vol: 0.03 })),
    ...coins.map((c) => ({ id: c.assetId, p0: rand(100000, 50000000), vol: 0.07 })),
    { id: 'BOND_KTB3Y', p0: 10000, vol: 0.002 },
    { id: 'BOND_KTB10Y', p0: 10000, vol: 0.004 },
    { id: 'BOND_CORPAA', p0: 10000, vol: 0.003 },
    { id: 'BOND_CORPBBB', p0: 10000, vol: 0.006 },
  ];
  for (const a of allIds) {
    let price = a.p0;
    const rows = [];
    for (const date of dates) {
      const change = rand(-a.vol, a.vol);
      price = Math.max(1, price * (1 + change));
      rows.push([a.id, date, Math.round(price * 100) / 100, change, 'KRW']);
    }
    await bulkInsert('asset_prices', ['asset_id', 'trade_date', 'close_price', 'change_rate', 'currency'], rows);
  }

  // --- 주식 상세/재무 스텁 ---
  await bulkInsert('stock_financials',
    ['asset_id', 'fiscal_year', 'half', 'revenue', 'operating_income', 'net_income'],
    stocks.flatMap((s) => [
      [s.assetId, 2012, 2, 1e12 * rand(0.5, 5), 1e10 * rand(1, 50), 1e10 * rand(1, 30)],
      [s.assetId, 2013, 1, 1e12 * rand(0.5, 5), 1e10 * rand(1, 50), 1e10 * rand(1, 30)],
    ])
  );

  // --- 거시지표 (게임 노출 10종 전체 — 001_init.sql의 is_game_visible=TRUE와 맞춘다) ---
  const macros = [
    { code: 'kospi', v: 2000, vol: 15 },
    { code: 'kosdaq', v: 550, vol: 5 },
    { code: 'usdkrw', v: 1100, vol: 8 },
    { code: 'kr_policy_rate', v: 2.75, vol: 0 },
    { code: 'cpi', v: 100, vol: 0.1 },
    { code: 'ktb_3y_rate', v: 2.8, vol: 0.02 },
    { code: 'ktb_10y_rate', v: 3.5, vol: 0.03 },
    { code: 'wti_price', v: 93, vol: 1.5 },
    { code: 'gold_price', v: 1300, vol: 10 },
    { code: 'leading_index', v: 100, vol: 0.2 },
  ];
  for (const m of macros) {
    let v = m.v;
    const rows = dates.map((date) => {
      v += rand(-m.vol, m.vol);
      return [m.code, date, Math.round(v * 100) / 100];
    });
    await bulkInsert('macro_daily', ['indicator_code', 'trade_date', 'value'], rows);
  }

  // --- 뉴스 (계약 스키마 준수 스텁) ---
  const newsRows = [];
  let newsSeq = 0;
  for (const date of dates) {
    const n = Math.floor(rand(3, 9));
    for (let i = 0; i < n; i++) {
      const isMacro = Math.random() < 0.5;
      if (isMacro) {
        newsRows.push([
          `stub__${date}__macro__${newsSeq++}`, 'market_macro', date, date,
          JSON.stringify([`[스텁] ${date} 거시 뉴스 ${i + 1}: 원/달러 환율이 움직였다.`]),
          'fx_move', pick(['positive', 'negative', 'neutral']), pick([4, 5]),
          null, null, '원/달러 환율', null, null,
        ]);
      } else {
        const s = pick(stocks);
        newsRows.push([
          `stub__${date}__stock__${newsSeq++}`, 'stock_disclosure', date, date,
          JSON.stringify([`[스텁] ${s.masked}의 매출액이 공시됐다.`]),
          null, pick(['positive', 'negative', 'neutral']), null,
          null, null, null, s.code, s.assetId,
        ]);
      }
    }
  }
  await bulkInsert('news',
    ['news_id', 'category', 'publish_date', 'game_publish_date', 'news_lines',
     'event_type', 'direction', 'strength', 'market', 'sector', 'macro_asset_label',
     'stock_code', 'asset_id'],
    newsRows
  );

  // --- 종토방 스텁 ---
  for (const s of stocks.slice(0, 10)) {
    for (let i = 0; i < 5; i++) {
      const date = pick(dates);
      const { rows } = await pool.query(
        `INSERT INTO community_posts (gall_id, post_date, asset_id, npc_nickname, title, body, recommend_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        ['stub_gall', date, s.assetId, `개미${i}`, `[스텁] ${s.masked} 어떻게 보시나요`, '스텁 본문입니다.', Math.floor(rand(0, 50))]
      );
      await pool.query(
        `INSERT INTO community_comments (post_id, npc_nickname, body) VALUES ($1,$2,$3)`,
        [rows[0].id, 'ㅇㅇ', pick(['가즈아', '탈출은 지능순', '존버가 답이다'])]
      );
    }
  }

  console.log(`[stub] 자산 ${allIds.length} / 거래일 ${dates.length} / 뉴스 ${newsRows.length}건 적재 완료`);
}

module.exports = { seedStub };

if (require.main === module) {
  seedStub()
    .then(() => pool.end())
    .catch((e) => { console.error(e); process.exit(1); });
}
