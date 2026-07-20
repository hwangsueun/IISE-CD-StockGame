// 세션별 코인 층화추출 (migration 005_session_coin_universe.sql)
//
// assets에는 코인이 1,267개 들어간다 - 이건 종토방/뉴스 본문이 어떤 코인이든 언급할 수 있어야
// 하는 "참조 유니버스"다. 반면 게임이 실제로 거래 대상으로 노출하는 코인은 세션마다 새로
// 뽑는 10개뿐이다. 이 서비스가 그 추출을 담당하고, session_coin_universe(005)에 결과를
// 영속화해 이어하기 시에도 동일한 10개가 복원되게 한다(재계산 방식은 유니버스 데이터가
// 갱신되면 같은 시드로도 다른 결과가 나와 이어하기가 깨지므로 채택하지 않는다 — 005 주석).
//
// 추출 규칙 (기획 확정, 변경 금지):
//   후보 = 세션 240거래일 전 기간에 걸쳐 시세가 존재하고(listed_from <= 첫날, listed_to >=
//          마지막날) 기간 내 첫 종가가 C.COIN_MIN_PRICE_KRW(100원) 이상인 코인.
//          원 단위 정수 현금 체계라 1원 미만은 거래 금액이 0원으로 뭉개지고, 1~99원대는
//          가격 해상도가 없다(1원 -> 2원 = +100%). 밸런싱 값이라 constants.js에서만 조정한다.
//   쿼터 = mega 2 / large 2 / mid 3 / small 3 = 10
//   미달 = 특정 티어가 쿼터를 못 채우면 남는 자리를 잔여 후보 풀에서 티어 무관 보충
//   완화 = 후보가 10개에 못 미치면 RELAXATION_LADDER를 따라 조건을 단계적으로 푼다(아래)
//   부족 = 마지막 단계까지 가도 10개가 안 되면 있는 만큼 전부 사용 (에러 아님)
// 추출은 Math.random() 기반 셔플이라 매 세션 다른 10개가 나온다(다른 서비스의 랜덤 로직과
// 동일한 방식 — surgeStockService, eventEngine 등도 별도 유틸 없이 Math.random()을 직접 쓴다).
const { query } = require('../db');
const C = require('../config/constants');

const TIER_QUOTAS = [
  ['mega', 2],
  ['large', 2],
  ['mid', 3],
  ['small', 3],
];
const TARGET_TOTAL = TIER_QUOTAS.reduce((sum, [, quota]) => sum + quota, 0); // 10

// 후보 완화 단계 (기획 확정: "10개 안 되는 해에는 강제로 10개 채워").
// 위에서부터 시도하고, TARGET_TOTAL을 채우면 멈춘다. 아래로 갈수록 제약이 느슨하다.
//
// 완화 순서의 근거 (실측 후보 수 - 시작연도별):
//              2013  2014  2015  2016  2017
//   fullSpan      1     8    10    13    22
//   overlap       2    26    34    42   108
//   가격하한 해제는 2013~2014에 효과가 없다(그 시기엔 저가 코인이 아니라 코인 자체가 없다).
// 그래서 기간 조건을 먼저 풀고 가격 하한(방금 확정한 밸런싱 값)은 마지막에 푼다.
//
// overlap 단계에서 들어온 코인은 세션 도중에 상장하거나 도중에 폐지될 수 있는데, 런타임이
// 이미 두 경우를 모두 처리한다 - 상장 전에는 tradeService의 listed_from 체크가 매수를 막고,
// 폐지 시점에는 turnService의 강제청산이 보유분을 정리한다(migration 003).
const RELAXATION_LADDER = [
  { key: 'fullSpan', span: 'full',    priceFloor: true  }, // 전 기간 생존 + 가격 하한
  { key: 'overlap',  span: 'overlap', priceFloor: true  }, // 기간 중 존재 + 가격 하한
  { key: 'anyPrice', span: 'overlap', priceFloor: false }, // 기간 중 존재, 가격 하한 해제
];

/** Fisher-Yates 셔플. 원본 배열은 건드리지 않고 새 배열을 반환한다. */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 후보 코인 조회. 적용 조건은 level(RELAXATION_LADDER 원소)에 따라 달라진다.
 * assets.listed_from/listed_to는 asset_prices 실측 min/max로 채워지는 상장기간의 단일 기준이다
 * (migration 003, seeds/finalize_listing_range.js).
 * @param {import('pg').PoolClient} client 호출자의 트랜잭션 client
 * @param {string} firstTradeDate 세션 1턴 거래일 (YYYY-MM-DD)
 * @param {string} lastTradeDate 세션 마지막 턴 거래일 (YYYY-MM-DD)
 * @param {{span:'full'|'overlap', priceFloor:boolean}} [level] 기본값 = 사다리 최상단(가장 엄격)
 * @returns {Promise<{assetId: string, tier: string|null}[]>}
 */
async function getCandidates(client, firstTradeDate, lastTradeDate, level = RELAXATION_LADDER[0]) {
  // 기간 조건
  //   full    : 세션 전 기간에 걸쳐 상장 유지 (listed_from <= 첫날 AND listed_to >= 마지막날)
  //   overlap : 세션 기간과 겹치기만 하면 됨 (도중 상장/도중 폐지 허용)
  const spanCond =
    level.span === 'full'
      ? `a.listed_from <= $1 AND a.listed_to >= $2`
      : `a.listed_from <= $2 AND a.listed_to >= $1`;

  // 가격 기준 시점: full은 항상 첫날 시세가 있지만, overlap은 도중 상장이라 첫날 시세가
  // 없을 수 있다. 그래서 "세션 기간 내 첫 시세"를 LATERAL로 집어 가격 하한을 적용한다.
  // 하한을 해제하는 단계에서는 $3을 SQL에서 아예 빼므로 파라미터도 같이 빼야 한다
  // (pg는 "bind message supplies 3 parameters, but prepared statement requires 2"로 거절한다).
  const priceCond = level.priceFloor ? `AND fp.close_price >= $3` : ``;
  const params = level.priceFloor
    ? [firstTradeDate, lastTradeDate, C.COIN_MIN_PRICE_KRW]
    : [firstTradeDate, lastTradeDate];

  // market_cap_tier IS NOT NULL: session_coin_universe.tier가 NOT NULL 컬럼이라(005), 티어
  // 라벨이 없는 코인이 후보로 섞이면 INSERT 단계에서 제약조건 위반으로 세션 생성 전체가
  // 실패한다. 정상 데이터(coin_info 전량 적재)에서는 걸러질 코인이 없어야 하는 방어 조건이다.
  const { rows } = await client.query(
    `SELECT a.asset_id AS asset_id, ci.market_cap_tier AS tier
     FROM assets a
     JOIN coin_info ci ON ci.asset_id = a.asset_id
     JOIN LATERAL (
       SELECT p.close_price FROM asset_prices p
       WHERE p.asset_id = a.asset_id AND p.trade_date BETWEEN $1 AND $2
       ORDER BY p.trade_date LIMIT 1
     ) fp ON TRUE
     WHERE a.asset_type = 'coin'
       AND a.listed_from IS NOT NULL AND a.listed_to IS NOT NULL
       AND ${spanCond}
       ${priceCond}
       AND ci.market_cap_tier IS NOT NULL`,
    params
  );
  return rows.map((r) => ({ assetId: r.asset_id, tier: r.tier }));
}

/**
 * 완화 사다리를 따라 TARGET_TOTAL을 채울 때까지 후보를 넓힌다.
 * 마지막 단계까지 가도 부족하면 그 시점 최대 후보로 진행한다(에러 아님 — 2013년처럼
 * 코인 데이터 자체가 거의 없는 구간이 실재한다. 실측 최대 2종).
 * @returns {Promise<{candidates: {assetId,tier}[], level: string}>}
 */
async function getCandidatesWithFallback(client, firstTradeDate, lastTradeDate) {
  let best = { candidates: [], level: RELAXATION_LADDER[0].key };
  for (const level of RELAXATION_LADDER) {
    const candidates = await getCandidates(client, firstTradeDate, lastTradeDate, level);
    if (candidates.length > best.candidates.length) best = { candidates, level: level.key };
    if (candidates.length >= TARGET_TOTAL) return { candidates, level: level.key };
  }
  return best;
}

/**
 * 티어 쿼터대로 랜덤 층화추출. 미달 티어는 잔여 후보 풀(티어 무관, 이미 선택된 코인 제외)에서
 * 보충하고, 후보 총량이 TARGET_TOTAL(10) 미만이면 있는 만큼 전부 반환한다(에러 아님).
 * @param {{assetId: string, tier: string|null}[]} candidates
 * @returns {{assetId: string, tier: string|null}[]} 최대 TARGET_TOTAL(10)개
 */
function pickUniverse(candidates) {
  const byTier = new Map();
  for (const c of candidates) {
    const key = c.tier || '';
    if (!byTier.has(key)) byTier.set(key, []);
    byTier.get(key).push(c);
  }

  const selected = [];
  const usedIds = new Set();

  // 1) 티어별 쿼터만큼 랜덤 추출
  for (const [tier, quota] of TIER_QUOTAS) {
    const pool = shuffle(byTier.get(tier) || []);
    for (const c of pool.slice(0, quota)) {
      selected.push(c);
      usedIds.add(c.assetId);
    }
  }

  // 2) 미달분 보충: 아직 선택되지 않은 전체 후보(티어 무관)에서 랜덤 보충
  const shortfall = TARGET_TOTAL - selected.length;
  if (shortfall > 0) {
    const leftover = shuffle(candidates.filter((c) => !usedIds.has(c.assetId)));
    for (const c of leftover.slice(0, shortfall)) {
      selected.push(c);
      usedIds.add(c.assetId);
    }
  }

  return selected;
}

/**
 * 세션 코인 유니버스를 추출해 session_coin_universe에 영속화한다.
 * 반드시 세션 생성과 같은 트랜잭션의 client로 호출해야 한다(원자성 — 세션 따로, 유니버스
 * 따로 커밋되면 유니버스 없는 세션이 남을 수 있다). gameService.startGame이 240턴 날짜
 * 생성 직후에 호출한다.
 * @param {import('pg').PoolClient} client 호출자의 트랜잭션 client (필수, fallback 없음)
 * @param {string} sessionId
 * @param {string} firstTradeDate 세션 1턴 거래일 (game_turns 중 최소 turn_number의 trade_date)
 * @param {string} lastTradeDate 세션 마지막 턴 거래일 (game_turns 중 최대 turn_number의 trade_date)
 * @returns {Promise<{assetId: string, tier: string|null}[]>} 실제 삽입된 유니버스 (0~10개)
 */
async function selectForSession(client, sessionId, firstTradeDate, lastTradeDate) {
  const { candidates, level } = await getCandidatesWithFallback(client, firstTradeDate, lastTradeDate);
  const selected = pickUniverse(candidates);
  if (level !== RELAXATION_LADDER[0].key || selected.length < TARGET_TOTAL) {
    console.warn(
      `[coinUniverse] ${firstTradeDate}~${lastTradeDate}: 완화단계=${level} 후보=${candidates.length} 선택=${selected.length}/${TARGET_TOTAL}`
    );
  }
  if (selected.length === 0) return selected; // 후보 0건: 삽입할 것도 없음 (에러 아님)

  const values = [];
  const params = [sessionId];
  selected.forEach((c, i) => {
    params.push(c.assetId, c.tier);
    values.push(`($1, $${params.length - 1}, $${params.length}, ${i})`);
  });
  await client.query(
    `INSERT INTO session_coin_universe (session_id, asset_id, tier, slot) VALUES ${values.join(',')}`,
    params
  );
  return selected;
}

/**
 * 세션의 코인 유니버스 asset_id 목록 (slot 순). 조회/거래 필터에서 쓴다.
 * @param {string} sessionId
 * @param {import('pg').PoolClient} [client] 트랜잭션 안에서 호출할 때 전달 (없으면 pool 직접 사용)
 * @returns {Promise<string[]>}
 */
async function getSessionCoinIds(sessionId, client) {
  const q = client || { query };
  const { rows } = await q.query(
    `SELECT asset_id FROM session_coin_universe WHERE session_id = $1 ORDER BY slot`,
    [sessionId]
  );
  return rows.map((r) => r.asset_id);
}

module.exports = { selectForSession, getSessionCoinIds, TIER_QUOTAS, TARGET_TOTAL };
