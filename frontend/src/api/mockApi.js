// 백엔드(P0~P4)가 없을 때 프론트 개발을 가능하게 하는 dev mock.
// 섹션 8 응답 형태를 흉내내며, 실제 백엔드가 붙으면 client.js에서 httpApi로 교체된다.
// 주의: 게임 권위 계산(체결/평가/상태)은 본래 서버 책임이다(섹션 3). 여기서는 개발용 근사치다.

const MAX_TURNS = 240;
const TURNS_PER_MONTH = 20;

const DIFFICULTY_DEBT = {
  easy: 50000000,
  normal: 100000000,
  hard: 150000000,
};

// --- 마스킹된 자산 유니버스 (실데이터 적재 전 stub) ---
const ASSET_DEFS = [
  { assetId: 'STOCK_001', assetType: 'stock', name: 'A전자', sector: '반도체', base: 71000 },
  { assetId: 'STOCK_002', assetType: 'stock', name: 'B하이닉스', sector: '반도체', base: 128000 },
  { assetId: 'STOCK_003', assetType: 'stock', name: 'C바이오', sector: '제약', base: 84000 },
  { assetId: 'STOCK_004', assetType: 'stock', name: 'D모터스', sector: '자동차', base: 215000 },
  { assetId: 'STOCK_005', assetType: 'stock', name: 'E화학', sector: '화학', base: 42000 },
  { assetId: 'STOCK_006', assetType: 'stock', name: 'F금융지주', sector: '금융', base: 58000 },
  { assetId: 'STOCK_007', assetType: 'stock', name: 'G게임즈', sector: 'IT', base: 39000 },
  { assetId: 'BOND_KTB3Y', assetType: 'bond', name: '국채 단기', sector: '채권', base: 10200 },
  { assetId: 'BOND_CORPBBB', assetType: 'bond', name: '투기 회사채', sector: '채권', base: 9800 },
  { assetId: 'COIN_BTC', assetType: 'coin', name: '오렌지코인', sector: '코인', base: 48000000 },
  { assetId: 'COIN_ETH', assetType: 'coin', name: '실버체인', sector: '코인', base: 3200000 },
];

const NEWS_POOL = [
  { type: 'macro', headline: '한국은행 기준금리 동결', sentiment: 'neutral' },
  { type: 'market', headline: '외국인 순매수 전환, 코스피 상승 마감', sentiment: 'positive' },
  { type: 'stock', headline: 'A전자 신형 메모리 양산 소식', sentiment: 'positive', assetId: 'STOCK_001' },
  { type: 'earnings', headline: 'D모터스 분기 영업이익 시장 기대 하회', sentiment: 'negative', assetId: 'STOCK_004' },
  { type: 'macro', headline: '원/달러 환율 1,380원 돌파', sentiment: 'negative' },
  { type: 'stock', headline: 'C바이오 임상 3상 결과 발표 임박', sentiment: 'neutral', assetId: 'STOCK_003' },
  { type: 'market', headline: '가상자산 변동성 확대 경고', sentiment: 'negative' },
];

// 결정론적 의사난수 (시드 기반) — 같은 세션/턴은 같은 결과
function seeded(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function priceAt(assetDef, turn, sessionSeed) {
  const rnd = seeded(hashStr(assetDef.assetId) + sessionSeed + turn * 7);
  // 누적 드리프트 + 턴별 변동
  const drift = 1 + (rnd() - 0.48) * 0.04 * turn * 0.05;
  const noise = 1 + (rnd() - 0.5) * 0.06;
  const price = Math.max(1, Math.round(assetDef.base * drift * noise));
  const prevRnd = seeded(hashStr(assetDef.assetId) + sessionSeed + (turn - 1) * 7);
  const prev = Math.max(1, Math.round(assetDef.base * (1 + (prevRnd() - 0.48) * 0.04 * (turn - 1) * 0.05) * (1 + (prevRnd() - 0.5) * 0.06)));
  const changeRate = (price - prev) / prev;
  return { price, changeRate: Number(changeRate.toFixed(4)) };
}

function dateForTurn(turn) {
  // 2018-01-01 기준 거래일 근사(주말 제외)
  const start = new Date('2018-01-02T00:00:00Z');
  let added = 0;
  const d = new Date(start);
  while (added < turn - 1) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return d.toISOString().slice(0, 10);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// --- 인메모리 세션 저장소 ---
const sessions = new Map();

function delay(value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), 120));
}

function assetSnapshot(turn, sessionSeed) {
  return ASSET_DEFS.map((a) => {
    const { price, changeRate } = priceAt(a, turn, sessionSeed);
    return {
      assetId: a.assetId,
      assetType: a.assetType,
      name: a.name,
      sector: a.sector,
      price,
      changeRate,
    };
  });
}

function newsForTurn(turn) {
  const rnd = seeded(turn * 13 + 1);
  const count = 2 + Math.floor(rnd() * 3);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const n = NEWS_POOL[Math.floor(rnd() * NEWS_POOL.length)];
    out.push({ id: turn * 100 + i, type: n.type, headline: n.headline, sentiment: n.sentiment, assetId: n.assetId ?? null });
  }
  return out;
}

function totalAsset(session) {
  const snap = assetSnapshot(session.current_turn, session.seed);
  const priceMap = Object.fromEntries(snap.map((s) => [s.assetId, s.price]));
  let holdingsValue = 0;
  for (const [assetId, h] of Object.entries(session.holdings)) {
    holdingsValue += (priceMap[assetId] ?? h.avgPrice) * h.quantity;
  }
  return session.cash + holdingsValue;
}

function stateOf(session) {
  return {
    cash: session.cash,
    totalAsset: totalAsset(session),
    debt: session.debt,
    stress: session.stress,
    trust: session.trust,
  };
}

export const mockApi = {
  startGame(difficulty = 'normal') {
    const id = `mock-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const debt = DIFFICULTY_DEBT[difficulty] ?? DIFFICULTY_DEBT.normal;
    const session = {
      id,
      seed: hashStr(id) % 100000,
      status: 'active',
      difficulty,
      current_turn: 1,
      initial_cash: 50000000,
      cash: 50000000,
      debt_initial: debt,
      debt,
      stress: 0,
      trust: 100,
      holdings: {}, // assetId -> { quantity, avgPrice }
      actionLockedUntil: 0,
    };
    sessions.set(id, session);
    return delay({
      sessionId: id,
      difficulty,
      maxTurns: MAX_TURNS,
      state: stateOf(session),
    });
  },

  getGame(sessionId) {
    const s = sessions.get(sessionId);
    if (!s) return Promise.reject(new Error('세션 없음'));
    return delay({
      sessionId,
      status: s.status,
      currentTurn: s.current_turn,
      maxTurns: MAX_TURNS,
      state: stateOf(s),
    });
  },

  getTurn(sessionId, turnNumber) {
    const s = sessions.get(sessionId);
    if (!s) return Promise.reject(new Error('세션 없음'));
    const turn = Number(turnNumber);
    const monthIndex = Math.ceil(turn / TURNS_PER_MONTH);
    return delay({
      turnNumber: turn,
      date: dateForTurn(turn),
      monthIndex,
      isRepaymentTurn: turn % TURNS_PER_MONTH === 0,
      state: stateOf(s),
      assets: assetSnapshot(turn, s.seed),
      news: newsForTurn(turn),
      newsLimit: s.stress > 70 ? 3 : s.stress > 40 ? 6 : 10,
      actionLocked: turn <= s.actionLockedUntil,
    });
  },

  trade(sessionId, { assetId, tradeType, quantity }) {
    const s = sessions.get(sessionId);
    if (!s) return Promise.reject(new Error('세션 없음'));
    const def = ASSET_DEFS.find((a) => a.assetId === assetId);
    if (!def) return Promise.reject(new Error('자산 없음'));
    const { price } = priceAt(def, s.current_turn, s.seed);
    const qty = Number(quantity);
    const amount = price * qty;

    if (tradeType === 'buy') {
      if (amount > s.cash) return Promise.reject(new Error('현금 부족'));
      s.cash -= amount;
      const cur = s.holdings[assetId] ?? { quantity: 0, avgPrice: 0 };
      const newQty = cur.quantity + qty;
      s.holdings[assetId] = {
        quantity: newQty,
        avgPrice: Math.round((cur.avgPrice * cur.quantity + amount) / newQty),
      };
    } else {
      const cur = s.holdings[assetId];
      if (!cur || cur.quantity < qty) return Promise.reject(new Error('보유 수량 부족'));
      s.cash += amount;
      cur.quantity -= qty;
      if (cur.quantity === 0) delete s.holdings[assetId];
    }
    return delay({ ok: true, price, amount, state: stateOf(s) });
  },

  nextTurn(sessionId) {
    const s = sessions.get(sessionId);
    if (!s) return Promise.reject(new Error('세션 없음'));
    if (s.current_turn >= MAX_TURNS) {
      s.status = s.debt <= 0 ? 'success' : 'failed';
      return delay({ turnNumber: s.current_turn, gameOver: true, state: stateOf(s) });
    }
    s.current_turn += 1;
    // 간이 상태 변화: 스트레스 누적, 신뢰도 소폭 변동
    const rnd = seeded(s.seed + s.current_turn * 3);
    s.stress = clamp(s.stress + Math.round(rnd() * 4 - 1), 0, 100);
    if (s.current_turn % TURNS_PER_MONTH === 0) {
      s.trust = clamp(s.trust - 2, 0, 100);
    }
    return delay({
      turnNumber: s.current_turn,
      isRepaymentTurn: s.current_turn % TURNS_PER_MONTH === 0,
      state: stateOf(s),
    });
  },

  repay(sessionId, { amount }) {
    const s = sessions.get(sessionId);
    if (!s) return Promise.reject(new Error('세션 없음'));
    const pay = Math.min(Number(amount) || 0, s.cash, s.debt);
    s.cash -= pay;
    s.debt -= pay;
    const ratio = pay / (s.debt + pay || 1);
    s.trust = clamp(s.trust + (ratio > 0.5 ? 4 : -3), 0, 100);
    s.stress = clamp(s.stress + (ratio > 0.5 ? -5 : 6), 0, 100);
    if (s.debt <= 0) s.status = 'success';
    return delay({ ok: true, paid: pay, state: stateOf(s) });
  },

  resolveEvent(sessionId, { choice }) {
    const s = sessions.get(sessionId);
    if (!s) return Promise.reject(new Error('세션 없음'));
    // 데모용: 수락 시 현금 변동/스트레스 변동
    const cashDelta = choice === 'accept' ? -200000 : 0;
    s.cash += cashDelta;
    s.stress = clamp(s.stress + (choice === 'accept' ? -8 : 4), 0, 100);
    return delay({ ok: true, cashDelta, state: stateOf(s) });
  },

  getResult(sessionId) {
    const s = sessions.get(sessionId);
    if (!s) return Promise.reject(new Error('세션 없음'));
    const success = s.debt <= 0;
    return delay({
      status: success ? 'success' : 'failed',
      finalCash: s.cash,
      finalAsset: totalAsset(s),
      debtRemaining: s.debt,
      turnsPlayed: s.current_turn,
    });
  },

  getPortfolio(sessionId) {
    const s = sessions.get(sessionId);
    if (!s) return Promise.reject(new Error('세션 없음'));
    const snap = assetSnapshot(s.current_turn, s.seed);
    const priceMap = Object.fromEntries(snap.map((a) => [a.assetId, a]));
    const rows = Object.entries(s.holdings).map(([assetId, h]) => {
      const a = priceMap[assetId];
      const cur = a?.price ?? h.avgPrice;
      const evalValue = cur * h.quantity;
      const cost = h.avgPrice * h.quantity;
      return {
        assetId,
        name: a?.name ?? assetId,
        assetType: a?.assetType ?? 'stock',
        quantity: h.quantity,
        avgPrice: h.avgPrice,
        currentPrice: cur,
        evalValue,
        profit: evalValue - cost,
        profitRate: cost ? Number(((evalValue - cost) / cost).toFixed(4)) : 0,
      };
    });
    const holdingsValue = rows.reduce((sum, r) => sum + r.evalValue, 0);
    return delay({
      cash: s.cash,
      holdingsValue,
      totalAsset: s.cash + holdingsValue,
      rows,
    });
  },

  getAssets({ type, sort } = {}) {
    const s = [...sessions.values()].pop();
    const turn = s?.current_turn ?? 1;
    const seed = s?.seed ?? 0;
    let list = assetSnapshot(turn, seed);
    if (type) list = list.filter((a) => a.assetType === type);
    if (sort === 'gainers') list.sort((a, b) => b.changeRate - a.changeRate);
    return delay(list);
  },

  getAsset(assetId) {
    const def = ASSET_DEFS.find((a) => a.assetId === assetId);
    if (!def) return Promise.reject(new Error('자산 없음'));
    return delay({
      assetId: def.assetId,
      assetType: def.assetType,
      name: def.name,
      sector: def.sector,
      info: { 비고: '실데이터 적재 전 stub 정보' },
    });
  },

  getAssetPrices(assetId, { from, to } = {}) {
    const def = ASSET_DEFS.find((a) => a.assetId === assetId);
    if (!def) return Promise.reject(new Error('자산 없음'));
    const s = [...sessions.values()].pop();
    const seed = s?.seed ?? 0;
    const series = [];
    for (let t = 1; t <= (s?.current_turn ?? 30); t += 1) {
      series.push({ date: dateForTurn(t), close: priceAt(def, t, seed).price });
    }
    return delay(series);
  },

  getMacro(date) {
    return delay({
      date,
      indicators: [
        { code: 'base_rate', name: '기준금리', value: 3.5, unit: '%' },
        { code: 'usdkrw', name: 'USD/KRW', value: 1342, unit: '원' },
        { code: 'cpi', name: 'CPI', value: 113.2, unit: '지수' },
        { code: 'wti', name: 'WTI', value: 78.4, unit: 'USD' },
        { code: 'gold', name: '금', value: 1920, unit: 'USD' },
      ],
    });
  },

  getNews(date) {
    const turn = 1;
    return delay(newsForTurn(turn).map((n) => ({ ...n, date })));
  },

  getNewsByAsset(date, assetId) {
    return delay(newsForTurn(1).filter((n) => n.assetId === assetId).map((n) => ({ ...n, date })));
  },

  getCommunity(assetId) {
    return delay([
      { id: 1, postDate: dateForTurn(1), assetId, npcNickname: '존버왕', title: '이거 가즈아', recommendCount: 42, sentiment: 'positive' },
      { id: 2, postDate: dateForTurn(1), assetId, npcNickname: '물린개미', title: '나만 물렸냐', recommendCount: 7, sentiment: 'negative' },
    ]);
  },

  getComments(postId) {
    return delay([
      { id: 1, postId, npcNickname: '눈팅중', body: '저도요', sentiment: 'neutral' },
    ]);
  },

  getMemo() {
    return delay([]);
  },
  createMemo(sessionId, payload) {
    return delay({ ok: true, ...payload });
  },
  updateMemo(sessionId, memoId, payload) {
    return delay({ ok: true, memoId, ...payload });
  },
  deleteMemo() {
    return delay({ ok: true });
  },
};
