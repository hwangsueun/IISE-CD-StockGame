// 회사/코인명 가명 처리 (ARCHITECTURE.md §6 마스킹 / §13 검증기준)
// 원칙: 마스킹은 ETL(seeds/import 단계)에서 완료하고, 서버는 masked_name만 응답에 쓴다.
// 이 서비스는 ETL이 사용하는 본문 내 회사/코인명 치환과 조사 보정 공용 유틸을 제공한다.
//
// =====================================================================================
// 2026-07-20 재작성 — 정본 사전(rename_map)으로 교정
// =====================================================================================
// 직전 리비전은 "가명 사전이 없다"는 잘못된 전제로 자체 가명 생성기
// (seeds/data/generate_masked_names.js -> seeds/data/masked_names.json)를 만들어 썼다.
// 실제로는 사용자가 병렬 세션에서 data-pipeline의 rename_map 파이프라인
// (npc_generator/processor/pr_rename00_build_map.py 등)으로 정본 가명 사전을 이미
// 만들어 두었다. masked_names.json/generate_masked_names.js는 폐기(삭제)했다 —
// $DATA_DIR/data/processed/rename_map/ 의 3개 CSV가 유일한 정본이다. 이 사전은 사용자가
// 계속 다듬는 중이므로(예: 작업 도중 stock_rename_map.csv에 masked_has_batchim 컬럼이
// 새로 추가되고 alias_rename_map.csv 행이 늘어나는 것을 실측함) 이 서비스는 매 프로세스
// 시작 시 CSV를 그대로 다시 읽는다 — 코드 변경 없이 사전 갱신이 반영된다.
//
//   stock_rename_map.csv  (117행) stock_code,stock_name_real,masked_name,draft_masked_name,
//                          changed,category,group_stem_real,group_stem_masked,
//                          masked_has_batchim(1|0|"", 아래 §0-1 참고)
//   coin_rename_map.csv   (1,267행) id,real_name,real_symbol,masked_name,masked_symbol,
//                          ko_name,in_text_corpus,source
//   alias_rename_map.csv  (약 300행) domain,target_or_coin_id,real_alias,alias_type,
//                          match_mode,scope,risk,enabled,masked_target,masked_alias,style,
//                          use_in_replace,note
//
// 세 파일 모두 UTF-8 BOM으로 저장돼 있다 — 헤더 첫 컬럼이 깨지지 않으려면 BOM을 제거하고
// 읽어야 한다(stripBom, 아래). 항상 draft_masked_name이 아니라 masked_name(최종 확정값)을
// 쓴다. group_stem_real/group_stem_masked는 아래 §2 주석의 이유로 쓰지 않는다.
//
// --- 왜 "사전 순차 적용"이 아니라 스팬(위치구간) 기반 통합 엔진인가 ---
// 최초 구현은 옛 코드처럼 "긴 것부터 사전 A 전체 적용 -> 사전 B 전체 적용"을 순서대로
// 하는 방식이었다. 실제 데이터로 테스트하다 alias_rename_map.csv에
// target_or_coin_id==='__MASK__'인 보호용 행(예: real_alias='도지사' -> masked_alias=
// '도지사' 그대로, 목적: 코인 별칭 '도지'가 '도지사'(광역단체장) 안에서 오탐되는 것 방지 —
// 실측 51행, 예: 삼성전자/삼전/신라젠/업비트/효성화학/미래에셋생명 등)이 있는 것을 발견
// 했다. "긴 것부터 순차 치환"으로는 이 보호가 작동하지 않는다 — identity 치환(도지사
// -> 도지사)은 텍스트를 바꾸지 않으므로, 다음 순서로 "도지"를 치환하는 패스가 여전히
// 그 부분문자열을 찾아 오염시킨다("도지사"가 "[도지코인가명]사"가 됨). 게다가 순차
// 다회 패스는 "이미 치환된 결과에 우연히 다른 사전의 실명이 부분문자열로 남아있는" 경우도
// 오염시킨다 (실측: "DB하이텍"을 먼저 전체치환해 "DS하이텍"이 됐는데, 별도 사전에 있는
// 별칭 '하이텍'이 그 결과 문자열 안의 "하이텍"을 다시 찾아 건드리려 시도 — 순차 재스캔
// 구조 자체의 결함).
// data-pipeline의 npc_generator/processor/pr_rename01_apply.py(가명 적용 스크립트 —
// 배경 문서대로 실제로는 파일을 하나도 바꾸지 못했지만, "엔진 설계"는 이 사전 구조가
// 정상 동작하기 위한 전제이자 유일한 레퍼런스라 그대로 신뢰해 이식했다)는 이를 스팬 기반
// 그리디 최長우선 비중첩 선택으로 해결한다: 모든 후보(진짜 치환 + __MASK__ 보호용 no-op)를
// 한 텀 레지스트리에 등록하고, 원문(불변) 위에서 모든 매칭 스팬을 찾아
// "시작위치 오름차순, 길이 내림차순"으로 정렬한 뒤 왼쪽부터 겹치지 않게 그리디로 고른다.
// 같은 시작위치라면 더 긴 후보가 항상 이기므로 "도지사"(길이3, 보호)가 "도지"(길이2,
// 치환)를 이긴다. 치환 결과 문자열을 다시 스캔하는 단계 자체가 없어(스팬은 전부 원문
// 기준으로 한 번에 계산되고 조립도 한 번에 끝남) 재매칭 사고가 구조적으로 불가능하다.
// 이 서비스는 그 설계를 JS로 이식하되, 조사 보정({{}}이 없는 순수 rewrite 엔진인
// pr_rename01_apply.py에는 없는 기능)을 각 스팬 적용 시점에 추가로 수행한다.
//
// pr_rename01_apply.py에서 함께 이식한 안전장치:
//   - FORBIDDEN_SINGLE_NAMES: SK/LG/GS/DL 같은 2~3글자 라틴 약어, 삼성/현대/한화/한국/
//     서울/미래/대한/신라/기아/신한/디오/효성/한미 같은 매우 흔한 한글 단어 — 실제 117
//     종목명과 문자열이 겹치더라도(우리 117 중 DL/GS/LG/SK/기아/디오/효성 7개가 겹침)
//     "너무 흔하거나 중의적"이라 판단해 자동 전체일치 치환에서 원천 제외한다. 이들의
//     더 길고 안전한 파생형(예: "기아차")은 alias_rename_map.csv에 개별 활성화돼 있으면
//     정상적으로 치환된다 — 배제 대상은 "짧고 중의적인 단독형"뿐이다.
//   - MIN_STOCK_NAME_LEN=3: 3글자 미만 종목 정식명(예: "NC")은 별도 word-모드 별칭이
//     없으면 자동 치환 대상에서 제외한다.
//   - 2글자 이하 한글 substring 키는 "바로 앞 글자가 한글이면" 매치를 버린다 — 한글
//     단어 중간에서 짧은 별칭이 우연히 튀어나오는 것을 막는다.
//   - substring 모드는 대소문자 무시(text.toLowerCase() 위에서 매칭), word 모드(주로
//     라틴 티커/코드)는 대소문자 구분 — "dl받았다"(다운로드 인터넷 은어)류 오탐을
//     피하기 위해 직전 작업자가 잡은 버그와 동일 클래스의 문제를 원천 차단한다.
//
// --- masked_has_batchim: 받침 없는(라틴 등) 가명의 조사 보정 ---
// "KVL"(DL의 가명)처럼 마지막 글자가 한글 음절이 아니면 유니코드 코드포인트만으로는
// 받침 유무(따라서 을/를, 이/가, 은/는 중 무엇을 붙일지)를 판정할 수 없다("케이브이엘"로
// 읽으면 받침 있음 판정이 맞다). 사용자가 최근 stock_rename_map.csv에 이 판정을 미리
// 계산해 넣은 masked_has_batchim(1|0) 컬럼을 추가했다(실측 KVL=1, CVN=1, YB=0, M&M=1,
// HMM/KSM=1, VELOS=0, RG=0, T-Oil=1 등 - 전부 발음 기준으로 타당함을 확인) — 이 값을
// 최우선으로 쓰고, 없으면(별칭/코인처럼 이 컬럼이 없는 사전) 코드포인트 판정으로
// 폴백한다. 별칭의 masked_alias가 어느 종목의 masked_name과 완전히 같은 문자열이면
// (실제로 흔함 - 예: 별칭 다수가 "정식 가명 그대로"를 masked_alias로 씀) 그 종목의
// masked_has_batchim을 빌려 쓴다(아래 MASKED_NAME_BATCHIM). 그래도 못 찾으면 원 조사를
// 그대로 둔다(과거 동작과 동일 - 안전한 폴백).
// 알려진 한계: '로/으로' 조사는 받침이 없거나 'ㄹ'받침이면 '로'를 쓰는 예외가 있는데,
// masked_has_batchim은 "받침 있음/없음"만 알려줄 뿐 그 받침이 ㄹ인지는 모른다. 코드포인트로
// 판정 가능한 순한글 이름은 기존처럼 ㄹ받침을 정확히 구분하지만, 라틴 어미 가명 중 발음상
// ㄹ받침인 것(예: KVL="엘", T-Oil="일")은 이 한계로 '으로'가 나올 자리에 정확도가 떨어질
// 수 있다(더 세분화된 컬럼이 없어 여기서 임의로 만들지 않았다 - 보고서 참고).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
// seeds/lib/csv.js의 RFC4180 라인 파서를 재사용한다(중복 구현 방지). 읽기 전용 참조이며
// seeds -> src 방향의 이 require는 seeds/lib가 순수 유틸이라 순환참조를 만들지 않는다.
const { parseLine } = require('../../seeds/lib/csv');

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

// =====================================================================
// 0. 공통 유틸
// =====================================================================

// --- 0-1. 한글 받침 판정 / 조사 보정 ---

/**
 * word 마지막 글자의 받침 유무. override(true/false)가 주어지면 그대로 쓴다
 * (masked_has_batchim 등 데이터 기반 판정 우선). override가 없고 word가 한글 음절로
 * 끝나지 않으면 판정 불가(null).
 */
function hasFinalConsonant(word, override) {
  if (override === true || override === false) return override;
  if (!word) return null;
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return null;
  return (code - 0xac00) % 28 !== 0;
}

/** word 마지막 글자의 받침이 'ㄹ'인지 (로/으로 예외 처리용). 코드포인트 판정만 가능
 *  (override 기반 라틴 어미 가명은 이 함수로 ㄹ 여부를 알 수 없음 - 파일 상단 주석 참고). */
function isRieulFinal(word) {
  if (!word) return false;
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 === 8; // 종성 인덱스 8 = 'ㄹ'
}

/**
 * 받침 유무에 따른 조사 보정 (단어 뒤에 조사를 새로 붙일 때).
 * 예: fixParticle('삼성전자', ['을','를']) -> '삼성전자를'
 */
function fixParticle(word, particlePair, override) {
  const [withFinal, withoutFinal] = particlePair; // 예: ['을','를']
  const hasFinal = hasFinalConsonant(word, override);
  return word + (hasFinal ? withFinal : withoutFinal);
}

const PARTICLE_PAIRS = [
  ['을', '를'],
  ['이', '가'],
  ['은', '는'],
  ['과', '와'],
];
const PARTICLE_ALT = '으로|를|을|는|은|과|와|가|이|로';
const PARTICLE_HEAD_RE = new RegExp(`^(${PARTICLE_ALT})`);

/** 치환된 단어(word) 바로 뒤에 원문 조사(particle)가 이어질 때 받침 기준으로 보정한 조사를 돌려준다 */
function fixTrailingParticle(word, particle, override) {
  const hasFinal = hasFinalConsonant(word, override);
  if (hasFinal === null) return particle; // 판정 불가 -> 원래 조사 유지
  if (particle === '로' || particle === '으로') {
    return hasFinal && !isRieulFinal(word) ? '으로' : '로';
  }
  for (const [withFinal, withoutFinal] of PARTICLE_PAIRS) {
    if (particle === withFinal || particle === withoutFinal) {
      return hasFinal ? withFinal : withoutFinal;
    }
  }
  return particle;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isHangulChar(ch) {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return code >= 0xac00 && code <= 0xd7a3;
}

// --- 0-2. pr_rename01_apply.py에서 그대로 이식한 안전장치 상수 ---
// (data-pipeline/npc_generator/processor/pr_rename01_apply.py의 FORBIDDEN_SINGLE_NAMES/
//  MIN_STOCK_NAME_LEN을 그대로 옮겼다. 데이터가 아니라 알고리즘 상수라 이 파일에서
//  하드코딩해도 "정본 사전을 있는 그대로 신뢰" 원칙에 어긋나지 않는다 - 오히려 이
//  안전장치 없이 임의로 다르게 구현하는 쪽이 원칙 위반이다.)
const FORBIDDEN_SINGLE_NAMES = new Set([
  'SK', 'LG', 'GS', 'DL', '한미', '대한', '한국', '서울', '미래', '신라', '효성',
  '기아', '신한', '디오', '삼성', '한화', '현대',
]);
const MIN_STOCK_NAME_LEN = 3;

// =====================================================================
// 1. rename_map CSV 로딩 (동기, DATA_DIR/data/processed/rename_map/*.csv, UTF-8 BOM)
// =====================================================================

/** 소형~중형 CSV(최대 약 1,300행)를 동기로 읽는다. UTF-8 BOM 헤더를 안전하게 제거한다. */
function parseCsvSync(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const rows = [];
  let header = null;
  for (const rawLine of lines) {
    if (!rawLine) continue;
    const line = header ? rawLine : stripBom(rawLine);
    const cells = parseLine(line);
    if (!header) {
      header = cells.map((h) => h.trim());
      continue;
    }
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i] === undefined ? '' : cells[i]; });
    rows.push(row);
  }
  return rows;
}

const RENAME_MAP_DIR = 'data/processed/rename_map';
const renameMapPath = (dataDir, file) => path.join(dataDir || '.', RENAME_MAP_DIR, file);

function loadCsvSafe(dataDir, file, label) {
  const fp = renameMapPath(dataDir, file);
  if (!dataDir) {
    console.warn(`[maskingService] DATA_DIR 미설정 - ${label} 사전을 건너뜁니다.`);
    return null;
  }
  if (!fs.existsSync(fp)) {
    console.warn(`[maskingService] ${label} 사전 없음: ${fp}`);
    return null;
  }
  try {
    const rows = parseCsvSync(fp);
    console.log(`[maskingService] ${label} 사전 로드: ${fp} (${rows.length}행)`);
    return rows;
  } catch (e) {
    console.warn(`[maskingService] ${label} 사전 파싱 실패: ${e.message}`);
    return null;
  }
}

/** '1'/'0' 문자열 -> true/false/null(빈값 등 판정불가) */
function parseTriBool(s) {
  if (s === '1') return true;
  if (s === '0') return false;
  return null;
}

/**
 * stock_rename_map.csv 로드 (117행).
 *
 * group_stem_real/group_stem_masked (2026-07-20 그룹 어간 치환 추가): 이전 리비전은 이 두
 * 컬럼을 쓰지 않았으나, 이번 변경으로 §2-1에서 실제 치환 텀으로 사용한다(사유는 §2-1 주석
 * 참고). 여기서는 (group_stem_real -> group_stem_masked) 21개 고유쌍만 그대로 뽑아
 * groupStems에 담아 반환한다 - 같은 그룹의 여러 행이 동일 쌍을 반복 보고하므로 Map으로
 * 자연 중복제거된다. 값 재해석/재계산은 하지 않는다(파일 상단 "확정된 결정" 참고 - 사용자가
 * 만든 값을 그대로 신뢰).
 */
function loadStockRenameMap(dataDir) {
  const byCode = new Map();       // code -> maskedName (토큰 해석용)
  const byRealName = new Map();   // stock_name_real -> maskedName (엔진 등록/중복검사용)
  const batchimByMasked = new Map(); // masked_name -> true/false (별칭이 같은 문자열을 쓸 때 재사용)
  const residualTerms = [];       // 잔존 실명 검사용
  const groupStems = new Map();   // group_stem_real -> group_stem_masked (21쌍, §2-1)
  const rows = loadCsvSafe(dataDir, 'stock_rename_map.csv', '종목 가명');
  if (!rows) return { byCode, byRealName, batchimByMasked, residualTerms, groupStems, loaded: false };
  for (const r of rows) {
    const real = r.stock_name_real;
    const masked = r.masked_name;
    const code = r.stock_code;
    if (!real || !masked) continue;
    if (code) byCode.set(code, masked);
    byRealName.set(real, masked);
    const batchim = parseTriBool(r.masked_has_batchim);
    if (batchim !== null) batchimByMasked.set(masked, batchim);
    residualTerms.push({ type: 'stock', key: code || real, label: real, from: real });
    if (r.group_stem_real && r.group_stem_masked) {
      groupStems.set(r.group_stem_real, r.group_stem_masked);
    }
  }
  return { byCode, byRealName, batchimByMasked, residualTerms, groupStems, loaded: true };
}

/**
 * coin_rename_map.csv 로드 (1,267행 중 in_text_corpus==='1' 21종만 사용 - 이유는 파일
 * 상단 주석 참고: 롱테일 1,246종은 실제 코퍼스에 없는 것으로 확인됐고, 그 안에서
 * real_symbol 중복이 27건 발견돼(예: 'xrp'가 ripple/harrypotterobamapacman8inu 양쪽)
 * 전량 등록 시 오탐/모호성만 커진다).
 */
function loadCoinRenameMap(dataDir) {
  const byId = new Map();       // id -> { maskedName, maskedSymbol, koName }
  const realEntries = [];       // [{from, to, wordBoundary}] 직접치환용
  const residualTerms = [];
  const rows = loadCsvSafe(dataDir, 'coin_rename_map.csv', '코인 가명');
  if (!rows) return { byId, realEntries, residualTerms, loaded: false };
  let inCorpus = 0;
  for (const r of rows) {
    if (r.in_text_corpus !== '1') continue;
    inCorpus++;
    const id = r.id;
    const realName = r.real_name;
    const realSymbol = r.real_symbol;
    const maskedName = r.masked_name;
    const maskedSymbol = r.masked_symbol;
    const koName = r.ko_name;
    if (!id || !maskedName) continue;
    byId.set(id, { maskedName, maskedSymbol: maskedSymbol || '', koName: koName || '' });
    if (realName) {
      // 영문 코인 실명(Bitcoin 등) - 흔한 영단어와 겹치는 것(Tether/Stellar 등)도 있어
      // word 경계(앞뒤 alnum 아님)를 강제한다 - 레퍼런스(주식)는 substring이지만 코인은
      // 레퍼런스가 다루지 않는 영역이라 더 보수적으로(누락 위험 < 오탐 위험) 판단했다.
      realEntries.push({ from: realName, to: maskedName, wordBoundary: true });
      residualTerms.push({ type: 'coin', key: `${id}:name`, label: `${realName}(${id})`, from: realName });
    }
    if (realSymbol && maskedSymbol) {
      const sym = realSymbol.toUpperCase(); // 실사용은 대문자 티커 표기가 압도적
      realEntries.push({ from: sym, to: maskedSymbol, wordBoundary: true });
      residualTerms.push({ type: 'coin', key: `${id}:symbol`, label: `${sym}(${id})`, from: sym });
    }
  }
  console.log(`[maskingService] 코인 가명 사전: 전체 ${rows.length}행 중 in_text_corpus=1 ${inCorpus}행 사용`);
  return { byId, realEntries, residualTerms, loaded: true };
}

/**
 * alias_rename_map.csv 로드 (enabled==='1'만 사용 - use_in_replace와 완전 동일함을
 * 검증했다). target_or_coin_id==='__MASK__'(domain=stock)인 51개 보호행도 함께 반환한다
 * - 이건 실제 "치환"이 아니라 "이 문자열은 건드리지 마라"는 보호 신호라 별도 표시
 * (isMask)해 둔다. 잔존 실명 검사(§4)에는 isMask=false인 행만 쓴다(보호행의 real_alias는
 * 애초에 우리가 마스킹하려는 대상이 아니라 "마스킹 안 되게 지키는" 대상이라 "잔존"으로
 * 세는 게 의미가 없다).
 */
function loadAliasRenameMap(dataDir) {
  const raw = [];         // 엔진 등록용 (isMask 포함 전체)
  const replaceable = [];  // 잔존 실명 검사용 (isMask=false만)
  const rows = loadCsvSafe(dataDir, 'alias_rename_map.csv', '별칭 가명');
  if (!rows) return { raw, replaceable, loaded: false };
  let enabledCount = 0;
  let maskCount = 0;
  for (const r of rows) {
    if (r.enabled !== '1') continue;
    if (!r.real_alias) continue;
    const isMask = r.domain === 'stock' && r.target_or_coin_id === '__MASK__';
    if (isMask) {
      maskCount++;
      raw.push({
        domain: r.domain, target: r.target_or_coin_id, from: r.real_alias, to: r.real_alias,
        matchMode: r.match_mode, scope: r.scope || 'all', isMask: true, aliasType: r.alias_type,
      });
      continue;
    }
    if (!r.masked_alias) continue;
    enabledCount++;
    const entry = {
      domain: r.domain, target: r.target_or_coin_id, from: r.real_alias, to: r.masked_alias,
      matchMode: r.match_mode, scope: r.scope || 'all', isMask: false, aliasType: r.alias_type,
    };
    raw.push(entry);
    replaceable.push(entry);
  }
  console.log(
    `[maskingService] 별칭 가명 사전: 전체 ${rows.length}행 중 활성 치환 ${enabledCount}행 + ` +
      `보호(__MASK__) ${maskCount}행 사용`
  );
  return { raw, replaceable, loaded: true };
}

const DATA_DIR = process.env.DATA_DIR;
const STOCK_MAP = loadStockRenameMap(DATA_DIR);
const COIN_MAP = loadCoinRenameMap(DATA_DIR);
const ALIAS_MAP = loadAliasRenameMap(DATA_DIR);

// =====================================================================
// 1-1. 그룹 어간(group_stem) 레지스트리 (2026-07-20 신규 추가)
// =====================================================================
// 배경: stock_rename_map.csv는 그룹 어간 방식으로 만들어졌다(삼성->유원, LG->해린,
// SK->태서 등, group_stem_real/group_stem_masked 컬럼, 21개 그룹 - loadStockRenameMap
// 참고). 그런데 FORBIDDEN_SINGLE_NAMES가 이 중 8개(SK/LG/GS/삼성/현대/효성/한화/신한 -
// FORBIDDEN_SINGLE_NAMES와 21개 그룹이 겹치는 부분)를 "너무 흔하거나 중의적"이라는
// 이유로 §2 STEP2(117 정식명 substring 등록)에서 원천 배제해 왔다. 그 결과 "삼성전자"
// (유니버스 밖 계열사) 같은 표현이 전혀 치환되지 않고 실명 그대로 남아, 같은 문서 안에서
// "유원카드"(삼성카드의 가명) 같은 계열사 가명과 나란히 노출되어 그룹의 실명<->가명
// 대응관계가 역추적된다(보고서 참고, 목표: 이 역추적 지표를 0에 수렴시킴).
//
// 해법: group_stem_real -> group_stem_masked 21쌍 중 "(한글)"/"(라틴)" 라벨이 붙은 2쌍
// (KT그룹을 사람이 구분하려 붙인 주석일 뿐 실제 코퍼스에 등장할 수 없는 문자열 - 예:
// "KT(한글)"이라는 텍스트가 뉴스에 나올 리 없다. 괄호를 기계적으로 벗겨 "KT"로 되돌리면
// 두 서로 다른 KT 그룹이 동일한 "KT" 키로 충돌하므로 그렇게 하지 않는다)를 제외한 19쌍을
// §2의 117 정식명과 동일한 메커니즘(addTerm 한 번 더 호출)으로 등록한다(§2-1 STEP2-1).
// 이 엔진은 substring/word 매칭에서 "매치된 부분만" 치환하고 그 뒤 문자열은 그대로
// 이어붙이므로(§2 applyEngineSpans) "치환 텀 등록" 하나만으로 스펙이 요구하는 두 시나리오가
// 전부 자동으로 커버된다:
//   - "삼성전자" = "삼성"(어간, 매치) + "전자"(그대로 남는 나머지) -> "유원전자" (스펙 §3
//     "어간+접미어 보존")
//   - "삼성"만 단독으로 등장 -> "유원" (뒤에 남는 게 없으니 자연히 스펙 §4 "어간 단독")
// 즉 스펙의 3번/4번은 별도 코드 경로가 필요한 두 단계가 아니라 같은 등록의 두 결과다.
// "3번이 4번보다 먼저"라는 순서 요구도 이미 만족된다 - findSpans는 삽입 순서가 아니라
// (시작위치, 길이 내림차순)으로 후보를 정렬하는 전역 최長우선 방식이라, 동일 위치에서
// 시작하면 더 긴 매치(117 정식명·별칭)가 항상 짧은 그룹 어간보다 우선한다. FORBIDDEN_
// SINGLE_NAMES는 이 등록에는 적용하지 않는다(의도적 - 21개 그룹은 그 자체가 사람이 직접
// 고른 허용목록이다. FORBIDDEN_SINGLE_NAMES 중 21개와 겹치지 않는 9개(DL/한미/대한/한국/
// 서울/미래/신라/기아/디오)는 그룹 어간이 아니므로 계속 완전히 배제된다 - 이 변경의 영향을
// 받지 않는다).
const GROUP_LABEL_PAREN_RE = /\(.+\)$/; // "그룹명(구분라벨)" 형태만 골라내는 일반 규칙
const GROUP_STEM_TERMS = [...STOCK_MAP.groupStems.entries()]
  .filter(([real, masked]) => real && masked && !GROUP_LABEL_PAREN_RE.test(real))
  .map(([real, masked]) => ({
    real,
    masked,
    // 라틴/기호로만 이뤄진 어간(SK/LG/GS/HL/BGF/F&F/NAVER)은 word 모드(대소문자 구분 +
    // 전후 ASCII 경계 강제)로 등록해 "Skintuit"/"risk_reward" 류 영단어 오탐을 막는다
    // (아래 라틴 안전장치 설명 참고). 한글 어간은 기존 substring 모드로 등록해 §2
    // findSpans의 "2글자 이하 한글 substring 키는 바로 앞 글자가 한글이면 버린다" 보호를
    // 그대로 받는다(신규 로직 아님, 기존 §2 findSpans 재사용).
    mode: isAsciiToken(real) ? 'word' : 'substring',
  }));
const GROUP_STEM_REAL_SET = new Set(GROUP_STEM_TERMS.map((t) => t.real));

// --- 라틴 약어 안전장치: 예외 목록 검토 (2026-07-20) ---
// SK/LG/GS/HL/BGF/F&F(+ 그룹 등록에서 제외한 KT, 그룹이 아닌 DL)는 영문 단어에 우연히
// 걸릴 위험이 있는 2~3글자 라틴 토큰이다. word 모드 정규식은 이미 두 규칙을 강제한다:
//   (a) 대소문자 구분 (wordGroups는 원문 그대로의 대문자 키로 등록되고, 정규식에 'i'
//       플래그를 쓰지 않는다 - substring 모드만 대소문자 무시)
//   (b) 단어 경계 (?<![A-Za-z0-9])KEY(?![A-Za-z0-9]) - 매칭 직전/직후에 ASCII 영숫자가
//       있으면 치환하지 않는다
// 요구사항이 예시로 든 잔존 후보 6건을 이 두 규칙만으로 검증하면 전부 이미 안전하다 -
// 별도의 하드코딩 예외 Set이 필요 없다(아래 근거, §6 검증 스크립트로 실제 코퍼스에서도
// 재확인함):
//   - SKY: "SK"+"Y" - Y가 바로 뒤에 오는 ASCII 영문자라 (b)에서 매칭 자체가 안 됨
//   - KTB: KT를 애초에 그룹 어간으로 등록하지 않았으므로(위 "(한글)"/"(라틴)" 라벨 제외
//     사유) 이 토큰과 무관 - 등록됐더라도 "KT"+"B"로 (b)에 걸려 안전
//   - HLB, HLBI: "HL"+"B..." - B가 바로 뒤 ASCII라 (b)에서 매칭 안 됨
//   - USGS: "US"+"GS" - G 앞의 S가 ASCII라 (b)의 앞쪽 경계에서 매칭 안 됨
//   - HODL: DL은 그룹 어간이 아니므로("(DL, "그룹" 아님, §1-1 상단 주석) 무관 - 등록됐더라도
//     "HO"+"DL"의 D 앞이 O(ASCII)라 (b)에서 매칭 안 됨
//   - LGBT: "LG"+"BT" - B가 바로 뒤 ASCII라 (b)에서 매칭 안 됨
// 반대로 LGD/LGES/GSC/GSEPS(요구사항이 "치환 대상"이라 명시한 실제 계열사 약어)는 접미어가
// ASCII 영문자로 시작해도 앞쪽 경계(직전에 ASCII가 없으면 됨)만 통과하면 매칭된다 - 다만
// (b) 규칙상 뒤쪽 경계도 "매칭 직후 ASCII가 없어야" 하므로, "LGD"처럼 어간 바로 뒤에 ASCII
// 문자(D)가 붙는 경우는 현재 word 모드 규칙으로는 "LG"가 매칭되지 않는다(=치환되지 않고
// 그대로 남는다). 이건 §6 검증에서 실측하고 발견된 한계로 별도 보고한다(§ "발견했지만
// 고치지 않은 문제") - 이 요구사항이 원하는 "완전한" 라틴 접미어 커버리지(순수 ASCII
// 접미어까지)는 word 모드의 안전 경계 규칙과 근본적으로 상충해서, 코퍼스 실측으로 실제
// 영향 범위를 확인한 뒤 판단하는 게 맞다고 보았다(임의로 규칙을 깨면 SKY류 오탐이 되살아남).

// __MASK__ 보호행 재해제 판정에 쓰는 "그룹 정체성 표면형". GROUP_STEM_TERMS의 real 값에,
// "그 그룹의 어간과 실명이 완전히 같은 유니버스 멤버"를 가리키는 활성(enabled=1)
// alias_type='reading' 별칭의 real_alias를 더한다. 예: NAVER 그룹은 group_stem_real=
// "NAVER"(라틴)뿐이지만 alias_rename_map.csv에는 이미 활성 "NAVER,네이버,reading,...,
// VELOS,벨로스,..." 행이 있다 - "네이버"는 NAVER 그룹의 한글 표기일 뿐이므로 __MASK__
// 판정에서는 "NAVER"와 동급으로 취급해야 "네이버페이/네이버지도/네이버파이낸셜"(note에
// "카카오페이 마스크와 동일 원칙"이라고 명시된 행들)도 카카오 계열과 같은 기준으로 재해제
// 대상이 된다(실제 CSV에서 이 규칙에 해당하는 건 NAVER/F&F 2그룹뿐임을 확인 - 보고서 참고).
// alias_type을 'reading'으로 제한하는 이유: 다른 타입(예: 카카오의 "좆카오" 멸칭,
// alias_type=nickname)까지 포함하면 "그룹을 가리키는 표준 표기"라는 취지를 벗어난다 -
// reading은 정확히 "실명의 다른 표기(음차/라틴<->한글)"만 다루는 타입이라 안전하다.
// enabled=0인 reading 별칭(LG의 "엘지", SK의 "에스케이", GS의 "지에스" 등)은 데이터팀이
// "그룹 전체 지칭 오탐" 우려로 명시적으로 비활성화해 둔 것이므로 포함하지 않는다 -
// ALIAS_MAP.raw는 애초에 enabled=1 행만 담으므로(loadAliasRenameMap) 별도 필터 불필요.
const GROUP_IDENTITY_SURFACE_FORMS = new Set(GROUP_STEM_TERMS.map((t) => t.real));
for (const r of ALIAS_MAP.raw) {
  if (r.isMask || r.domain !== 'stock' || r.aliasType !== 'reading') continue;
  if (GROUP_STEM_REAL_SET.has(r.target) && STOCK_MAP.byRealName.has(r.target)) {
    GROUP_IDENTITY_SURFACE_FORMS.add(r.from);
  }
}

/** __MASK__ 보호행의 real_alias가 "그룹 정체성 표면형 + 접미어"(예: "삼성전자",
 *  "효성화학", "카카오톡") 형태인지 판정한다. 접미어가 없으면(길이가 같으면) 이 판정
 *  대상이 아니다 - 그 경우는 이미 아래 buildTermRegistry() STEP1의 "117 실명과 완전히
 *  같으면 보호행 스킵" 경로에서 처리된다(예: "카카오뱅크"). word 모드(라틴) 어간은
 *  뒤따르는 문자가 ASCII 영숫자가 아닐 때만 인정한다("SKY" 같은 별개 토큰의 접두부를
 *  오인하지 않도록) - 라틴 안전장치와 동일 경계 규칙. 이 함수는 이미 확정된 __MASK__
 *  real_alias 텍스트(자유 텍스트가 아닌 짧고 고정된 문자열) 앞부분만 검사하므로 §2
 *  findSpans의 "2글자 한글 앞글자" 규칙은 필요 없다(그건 자유 텍스트 중간에서 우연히
 *  매치되는 것을 막는 규칙이고, 여기는 항상 문자열 시작 위치 검사라 다른 문제 - 상황을
 *  혼동하지 않도록 별도 함수로 분리했다). */
function matchesGroupIdentityPrefix(text) {
  for (const stem of GROUP_IDENTITY_SURFACE_FORMS) {
    if (!text.startsWith(stem) || text.length <= stem.length) continue;
    if (isAsciiToken(stem) && /[A-Za-z0-9]/.test(text[stem.length])) continue;
    return true;
  }
  return false;
}

// §5 잔존 실명 검사용 - 그룹 정체성 표면형(GROUP_IDENTITY_SURFACE_FORMS, 19개 어간 +
// NAVER/F&F의 활성 reading 별칭 2개)도 "치환 후에도 남아있으면 안 되는 실명"에 포함한다.
// 이전 리비전은 이 값들을 어느 사전 구조에도 담지 않아 getResidualReport() 계열 함수가
// "삼성전자" 같은 잔존을 아예 추적 대상에 넣지 못하는 사각지대가 있었다(보고서 참고) -
// 이제 실제 치환 텀(§1-1 GROUP_STEM_TERMS)과 동일한 소스에서 파생하므로 항상 최신 상태를
// 반영한다.
const GROUP_STEM_RESIDUAL_TERMS = [...GROUP_IDENTITY_SURFACE_FORMS].map((real) => ({
  type: 'group_stem', key: `group_stem:${real}`, label: real, from: real,
}));

/** 가명 문자열의 받침 override를 찾는다: 종목 masked_name 표에 있으면 그 값을,
 *  없으면(코인/별칭 자체 창작 가명 등) null(코드포인트 폴백에 맡김). */
function batchimOverrideFor(maskedText) {
  const v = STOCK_MAP.batchimByMasked.get(maskedText);
  return v === undefined ? null : v;
}

/** scope 값 해석: all(전역) / coin_board(코인 게시판 전용) / non_coin_board(코인 게시판 제외 전역) */
function scopeMatches(entryScope, callerScope) {
  const es = entryScope || 'all';
  if (es === 'all') return true;
  if (es === callerScope) return true;
  if (es === 'non_coin_board' && callerScope !== 'coin_board') return true;
  return false;
}

// =====================================================================
// 2. 통합 치환 엔진 — 스팬(위치구간) 기반, __MASK__ 보호 지원
//    (data-pipeline/npc_generator/processor/pr_rename01_apply.py RewriteEngine 이식,
//    사유는 파일 상단 "왜 순차 사전 적용이 아닌가" 참고)
// =====================================================================

/** 레지스트리: substring 텀(대소문자 무시, key=소문자)과 word 텀(대소문자 구분)을
 *  따로 모은다. 각 텀은 {to, isMask, scope} 배열로 키를 공유할 수 있다(동일 표기가
 *  여러 출처에 등록된 경우 - 실사용에서는 값이 같아 문제 없음). */
function buildTermRegistry() {
  const substringGroups = new Map(); // lowerKey -> [{to,isMask,scope}]
  const wordGroups = new Map();      // 원 대소문자 key -> [{to,isMask,scope}]
  const dictAliasFroms = new Set();  // domain=stock 별칭의 real_alias 전체 (중복등록 방지)
  const wordOverrideFroms = new Set(); // match_mode='word'이며 real_alias===target인 경우

  const push = (map, key, term) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(term);
  };
  // looseSuffix: 2026-07-20 추가. true면 §2-3 applyEngineSpans의 조사 보정이 "그 뒤가
  // 한글로 계속 이어지면 조사가 아니라 접미어의 일부"로 더 엄격하게 판정한다(예: "SK
  // 이노베이션"의 "이"가 조사 "이"로 오인되어 "이노베이션"이 "가노베이션"으로 깨지는 것을
  // 막음 - §1-1/§2-2 그룹 어간처럼 뒤에 사전에 없는 임의 접미어가 붙을 수 있는 텀에서만
  // 필요하다). 기존 117 정식명·별칭·코인 텀(대부분 사람이 큐레이션한 짧고 안전한 문자열
  // 뒤에 진짜 조사만 오는 경우가 압도적)은 looseSuffix 미지정(undefined=false와 동일)으로
  // 기존 동작을 그대로 유지한다 - 이 판정을 전역에 적용하면 "삼성카드를만들었다"류 공백
  // 생략 캐주얼 표기(조사 뒤에 공백 없이 다음 단어가 바로 이어짐 - 종토방에 흔함)에서
  // 조사 보정이 과도하게 보수적으로 동작할 위험이 있어, 위험이 실제로 있는 곳(사전 밖
  // 접미어가 붙는 그룹 어간)에만 좁혀 적용한다.
  const addTerm = (from, to, matchMode, scope, isMask, looseSuffix) => {
    const term = { to, isMask, scope: scope || 'all', looseSuffix: !!looseSuffix };
    if (matchMode === 'word') push(wordGroups, from, term);
    else push(substringGroups, from.toLowerCase(), term);
  };

  // 1) 별칭 (__MASK__ 보호행 포함) — pr_rename01_apply.py와 동일 순서로 먼저 등록
  let groupStemUnprotected = 0;
  for (const r of ALIAS_MAP.raw) {
    if (r.isMask) {
      // 이미 종목 정식명 자체로 등록될 문자열이면 보호행은 건너뛴다(정상적으로 그
      // 종목의 가명으로 치환되는 게 맞다 - 예: "카카오뱅크" 보호행은 카카오뱅크가
      // 그 자체로 117 종목 중 하나라 여기서 스킵되고, 정식 치환 텀으로만 등록된다).
      if (STOCK_MAP.byRealName.has(r.from)) continue;
      // 2026-07-20 추가: real_alias가 "그룹 정체성 표면형 + 접미어"(예: "삼성전자",
      // "효성화학", "카카오톡", "미래에셋생명")면 보호를 걸지 않는다 - 데이터팀이 이
      // 보호행들을 만든 목적("카카오 오귀속 방지" 등)은 "실명을 실명 그대로 노출시켜서라도
      // 엉뚱한 종목에 잘못 붙는 것을 막자"였는데, 이제 §1-1 STEP2-1이 그룹 어간+접미어를
      // 직접 치환하므로 그 보호가 오히려 어간을 실명 그대로 노출시켜 역추적 벡터가 된다
      // (예: 보호를 유지하면 "삼성전자"는 실명 그대로 남고 바로 옆 "유원카드"(삼성카드
      // 가명)가 그 대응관계를 드러낸다). __MASK__ 중 그룹 어간과 무관한 순수 오탐 방지용
      // (예: "도지사"/"업비트"/"하이마트"/"삼전"/"현기증" - 코인 오탐, 동음이의어, 유니버스
      // 내 개별 종목명과의 충돌 등 21개 그룹과 무관한 이유)은 이 조건에 해당하지 않으므로
      // 그대로 보호를 유지한다(matchesGroupIdentityPrefix가 false를 반환).
      if (matchesGroupIdentityPrefix(r.from)) { groupStemUnprotected++; continue; }
      addTerm(r.from, r.from, r.matchMode, r.scope, true);
      continue;
    }
    addTerm(r.from, r.to, r.matchMode, r.scope, false);
    if (r.domain === 'stock') {
      dictAliasFroms.add(r.from);
      if (r.matchMode === 'word' && r.from === r.target) wordOverrideFroms.add(r.from);
    }
  }

  // 2) 종목 117 공식명 (금지어/최소길이/이미등록 제외) — 전부 substring 모드
  //    (레퍼런스와 동일: 짧고 위험한 것들은 이미 FORBIDDEN_SINGLE_NAMES로 빠지거나
  //    word 모드 별칭으로 별도 등록돼 있다)
  for (const [realName, maskedName] of STOCK_MAP.byRealName) {
    if (wordOverrideFroms.has(realName) || dictAliasFroms.has(realName)) continue;
    if (FORBIDDEN_SINGLE_NAMES.has(realName) || realName.length < MIN_STOCK_NAME_LEN) continue;
    addTerm(realName, maskedName, 'substring', 'all', false);
  }

  // 2-1) 그룹 어간(§1-1 GROUP_STEM_TERMS, 21 중 라벨 2개 제외한 19개) 중 한글 어간만 여기서
  // substring 텀으로 등록한다. FORBIDDEN_SINGLE_NAMES/MIN_STOCK_NAME_LEN 미적용(§1-1 주석
  // 참고, 의도적). 라틴 어간(SK/LG/GS/HL/BGF/F&F/NAVER)은 여기 등록하지 않고 findSpans가
  // 별도로 호출하는 findLatinGroupStemSpans()가 전담한다 - 이유: 표준 word 모드(wordGroups/
  // wordRe)는 좌우 대칭으로 "앞뒤 모두 ASCII 아님"을 요구하는데, 그러면 "LGD"/"LGES"/
  // "GSEPS"처럼 어간 바로 뒤에 사업부 코드가 라틴 대문자로 붙는 실제 계열사 표기(요구사항이
  // 명시한 치환 대상)를 못 잡는다. 라틴 어간은 오른쪽 경계를 완화해야 하는데, 그 완화를
  // wordGroups/wordRe에 그대로 적용하면 HLB/NC/NAVER/BGF/OCI/KMW/WCP/KCC/SKT/JYP 등 기존에
  // 이미 등록된 다른 word 모드 텀(공식명·심볼 별칭)의 경계 규칙까지 전부 함께 느슨해져
  // 버려 그쪽에서 새로운 오탐이 생길 위험이 있다 - 그래서 그룹 어간 전용 스캐너로 완전히
  // 분리했다(아래 findLatinGroupStemSpans 주석 참고). 같은 키가 위 1)/2)에 이미 등록돼
  // 있으면(예: "카카오"·"효성"은 그 자체가 117 정식명) 중복 후보가 추가될 뿐 무해하다 -
  // findSpans는 (시작위치, 길이 내림차순) 안정정렬 후 그리디로 고르므로, 동일 시작·동일
  // 길이 후보끼리는 먼저 push된(=먼저 등록된) 쪽이 이긴다. 이 STEP은 1)/2) 다음에
  // 실행되므로 더 구체적으로 큐레이션된 기존 별칭/정식명 값이 항상 그룹 어간 값보다
  // 우선한다(예: "미래에셋" bare는 이미 활성 별칭으로 "한결에셋"(접미사 제거형)에 매핑돼
  // 있어 group_stem_masked의 "한결에셋증권"(단일 멤버 그룹이라 접미사가 그대로 녹아든 값,
  // §1-1 참고)으로 덮어써지지 않는다).
  const hangulGroupStemTerms = GROUP_STEM_TERMS.filter((t) => t.mode === 'substring');
  console.log(
    `[maskingService] 그룹 어간 사전: 한글 ${hangulGroupStemTerms.length}개(substring 등록) + ` +
      `라틴 ${GROUP_STEM_TERMS.length - hangulGroupStemTerms.length}개(전용 스캐너) ` +
      `(21개 중 라벨 2개 제외), __MASK__ 보호 해제 ${groupStemUnprotected}건`
  );
  for (const { real, masked } of hangulGroupStemTerms) {
    addTerm(real, masked, 'substring', 'all', false, true); // looseSuffix=true, 위 주석 참고
  }

  // 3) 코인 (in_text_corpus=1, 21종) — real_name/real_symbol 전부 word 모드(§1 주석 참고)
  for (const { from, to } of COIN_MAP.realEntries) {
    addTerm(from, to, 'word', 'all', false);
  }

  return { substringGroups, wordGroups };
}

const REGISTRY = buildTermRegistry();

/** scope별 컴파일된 정규식을 캐시한다(호출마다 재구성하지 않음 - 성능). scope별로
 *  "그 scope에서 실제로 쓰일 텀만" 넣어 알고리즘 정확성도 높인다(레퍼런스는 전체 텀을
 *  한 정규식에 넣고 매치 후 scope로 걸러내는데, 그러면 "더 길지만 scope 불일치라 결국
 *  버려질 후보"가 매치 위치를 선점해 버려서 그보다 짧고 scope에 맞는 후보가 아예 시도되지
 *  못하는 이론적 사각지대가 있다 - scope별로 정규식 자체를 다르게 만들면 이 사각지대가
 *  생기지 않는다). */
const engineCache = new Map();
function compileEngine(scope) {
  const subKeys = [];
  for (const [key, terms] of REGISTRY.substringGroups) {
    if (terms.some((t) => scopeMatches(t.scope, scope))) subKeys.push(key);
  }
  subKeys.sort((a, b) => b.length - a.length); // 길이 내림차순 -> 알터네이션에서 긴 것이 항상 먼저 시도됨
  const subRe = subKeys.length ? new RegExp(subKeys.map(escapeRegExp).join('|'), 'g') : null;

  const wordKeys = [];
  for (const [key, terms] of REGISTRY.wordGroups) {
    if (terms.some((t) => scopeMatches(t.scope, scope))) wordKeys.push(key);
  }
  wordKeys.sort((a, b) => b.length - a.length);
  const wordRe = wordKeys.length
    ? new RegExp(`(?<![A-Za-z0-9])(?:${wordKeys.map(escapeRegExp).join('|')})(?![A-Za-z0-9])`, 'g')
    : null;

  return { subRe, wordRe };
}
function getEngine(scope) {
  if (!engineCache.has(scope)) engineCache.set(scope, compileEngine(scope));
  return engineCache.get(scope);
}

// --- 2-2. 라틴 그룹 어간 전용 스캐너 (2026-07-20 신규) ---
// SK/LG/GS/HL/BGF/F&F/NAVER(§1-1 GROUP_STEM_TERMS 중 mode==='word')는 표준 word 모드
// (wordRe, 좌우 대칭 "ASCII 아님" 경계)에 넣지 않고 이 스캐너로 별도 처리한다. 왼쪽 경계는
// 항상 엄격(직전에 ASCII 영숫자가 있으면 매치 안 함 - "USGS"의 GS, "NHLBI"의 HLB를 이
// 규칙 하나로 막는다)하되, 오른쪽 경계는 완화해 어간 바로 뒤에 라틴 대문자가 이어져도
// 매치한다 - 요구사항이 명시한 "LGD/LGES/GSC/GSEPS는 치환 대상" 요건 때문이다(코퍼스
// 실측 결과 LGD 3건·LGES 3건·GSEPS 2건이 전부 "어간+한글 조사"가 아니라 "어간+라틴
// 접미부(사업부 코드)+한글 조사" 형태로 실제 등장함을 확인 - 예: "LGD의", "(LGES)을",
// "GSEPS라는"). 오른쪽 경계를 완화하면서 새로 열리는 위험은 EXACT_LATIN_SUFFIX_EXCEPTIONS
// (아래)로 막는다: 어간 시작 위치부터 이어지는 ASCII 영숫자 연속열(fullToken) 전체가
// 예외 목록과 "정확히" 같을 때만 그 매치를 통째로 버린다(접두 부분매치가 아님 - "SKYNET"
// 같은 미등장 변형까지 과잉 차단하지 않도록 코퍼스에 실제 등장하는 표면형 기준으로
// 판단했다. 향후 코퍼스가 바뀌면 이 목록도 재검증이 필요하다는 뜻이므로 §6 검증 스크립트를
// 재실행해 확인할 것).
const LATIN_GROUP_STEM_TERMS = GROUP_STEM_TERMS.filter((t) => t.mode === 'word');
const EXACT_LATIN_SUFFIX_EXCEPTIONS = new Set([
  // --- 요구사항이 명시한 6건 (근거는 함수 사용처 주석과 함께 아래에 개별 기재) ---
  'SKY',   // "SKY 캐슬"/"SKY 출신" 등 서울대·고려대·연세대 은어. SK그룹과 무관 - 코퍼스
           // 실측 6건 전부 이 의미(예: "SKY 졸업, 해외대 졸업", "SKY 출신 신입사원").
  'KTB',   // KTB투자증권 - KT 계열 아님(별개 금융사, 옛 한국종합기술금융 이니셜). 다만
           // 이 코드에서 "KT" 자체를 그룹 어간으로 등록하지 않으므로(§1-1 라벨 제외 -
           // "KT(한글)"/"KT(라틴)") 현재는 도달 불가능한 방어적 등재.
  'HLB',   // HLB(에이치엘비, 118 유니버스의 별개 종목 - stock_rename_map.csv 참고)는 HL
           // 그룹(HL홀딩스) 계열이 아니다. HLB 자체는 이미 word 모드 공식명 별칭으로 따로
           // 등록돼 있어(§2 STEP1) 관계없이 정상 치환되고, 이 예외는 "NHLBI"(미국 국립
           // 보건원 산하 기관) 같은 더 큰 라틴 토큰 안에서 "HLB"만 잘못 추출되는 것을
           // 막는다 - 다만 이 경우는 왼쪽 경계(N이 직전 ASCII)만으로 이미 막히므로 방어적
           // 이중 안전장치.
  'HLBI',  // 위와 동일 맥락의 변형.
  'USGS',  // 미국 지질조사국(US Geological Survey). GS그룹과 무관 - 코퍼스 실측 4건 전부
           // 이 의미(예: "USGS 보고서", "지질조사국(USGS)"). 왼쪽 경계(S가 직전 ASCII)로
           // 이미 막히므로 방어적 이중 안전장치.
  'HODL',  // 코인 커뮤니티 은어("hold"의 오타에서 유래, 존버). DL은 애초에 21개 그룹에
           // 없어(개별 FORBIDDEN_SINGLE_NAMES일 뿐, 그룹 아님) 현재 도달 불가능한 방어적
           // 등재.
  'LGBT',  // 성소수자 지칭 약어. LG그룹과 무관 - 등장 시 반드시 차단되어야 함.
  // --- 코퍼스 실측으로 추가 발견 (요구사항이 예시한 6건 외) ---
  'GSC',   // "제노리온GSC" - "제노리온"은 셀트리온의 가명(stock_rename_map.csv)이다. 즉
           // 이건 GS그룹과 무관하게 게임 세계관이 만든 가상 자회사명의 라틴 접미부일
           // 뿐이다(코퍼스 실측 2건: "제노리온GSC가", "제노리온GSC의"). 왼쪽 경계(온이
           // 직전 - 한글이라 ASCII 경계 규칙 자체는 통과하지만 fullToken 예외로 최종 차단).
]);

/** 라틴 그룹 어간 후보를 원문에서 찾는다(대소문자 구분, 왼쪽 엄격/오른쪽 완화+예외 -
 *  위 섹션 설명 참고). substring/word 레지스트리와 별개의 세 번째 스캔 경로이며, 결과는
 *  findSpans의 공통 cands 배열에 그대로 합류한다(정렬·그리디 선택은 동일 로직 재사용). */
function findLatinGroupStemSpans(text) {
  const cands = [];
  for (const { real, masked } of LATIN_GROUP_STEM_TERMS) {
    let idx = 0;
    while ((idx = text.indexOf(real, idx)) !== -1) {
      const start = idx;
      const end = start + real.length;
      idx = end;
      if (start > 0 && /[A-Za-z0-9]/.test(text[start - 1])) continue; // 왼쪽 경계: 항상 엄격
      let ext = end;
      while (ext < text.length && /[A-Za-z0-9]/.test(text[ext])) ext++;
      if (EXACT_LATIN_SUFFIX_EXCEPTIONS.has(text.slice(start, ext))) continue; // 예외 표면형 통째로 스킵
      cands.push({ start, end, to: masked, isMask: false, len: end - start, looseSuffix: true });
    }
  }
  return cands;
}

/** text 안에서 치환할 스팬 목록을 찾는다(원문 위치 기준, 비중첩, 그리디 최長우선). */
// =====================================================================
// 1-2. 그룹 어간 오탐 낱말 (2026-07-20 추가)
// =====================================================================
// 그룹 어간(현대/삼성/신한 등)은 회사명이 아닌 일반 낱말의 앞부분과도 겹친다.
// 전 코퍼스(종토방 2,501 + 뉴스 13,497) 전수 스캔으로 실제 치환된 "어간+한글" 조합
// 196종을 모두 검토한 결과, 아래만이 회사 지칭이 아닌 것으로 확인됐다.
// (대부분은 계열사명이거나 조사였다 - 예: 삼성전자 130회, 현대차 28회, 효성중공업 20회.
//  "삼성맨"/"삼성빠"/"삼성놈"처럼 구어적 표현도 삼성 그룹 지칭이므로 치환 대상이 맞다.)
// 여기 없는 조합은 치환한다 - 화이트리스트가 아니라 블랙리스트인 이유는, 사전에 없는
// 계열사(삼성디스플레이·현대미포조선 등)까지 자동으로 덮는 것이 이 기능의 목적이기 때문이다.
// strict=false : 뒤에 무엇이 오든 스킵. 회사명 접두어로 쓰일 수 없는 파생어들
//                ("현대적인", "현대화하다"처럼 어미/접미사가 자유롭게 붙는다)
// strict=true  : 낱말 경계에서만 스킵. 뒤에 한글이 더 이어지면 회사명일 수 있어 치환한다
//                (예: "삼성동"은 지명이지만 "삼성동조합"이라면 회사 지칭일 수 있다)
const GROUP_STEM_COMMON_WORDS = [
  { word: '현대화', strict: false }, // modernization - "항공기 현대화"
  { word: '현대적', strict: false }, // modern/contemporary - "현대적인"
  { word: '현대판', strict: false }, // modern version
  { word: '현대사', strict: false }, // modern history
  { word: '신한국', strict: false }, // "신 한국" / 신한국당
  { word: '삼성역', strict: true },  // 지하철역(지명)
  { word: '삼성동', strict: true },  // 지명
];

/** [start,end)에서 시작하는 그룹 어간 매치가 일반 낱말의 일부인지 판정한다. */
function isGroupStemCommonWord(text, start, end) {
  for (const { word, strict } of GROUP_STEM_COMMON_WORDS) {
    if (word.length <= end - start) continue;        // 어간보다 길어야 의미가 있다
    if (!text.startsWith(word, start)) continue;
    if (!strict) return true;
    const after = text[start + word.length];
    if (after === undefined || !isHangulChar(after)) return true;
    if (PARTICLE_HEAD_RE.test(text.slice(start + word.length))) return true;
  }
  return false;
}

function findSpans(text, scope, protectedSpans = []) {
  const { subRe, wordRe } = getEngine(scope);
  const cands = findLatinGroupStemSpans(text); // 그룹 어간(라틴)은 scope 무관(전부 all)

  if (subRe) {
    const lower = text.toLowerCase();
    subRe.lastIndex = 0;
    let m;
    while ((m = subRe.exec(lower))) {
      const key = m[0];
      const start = m.index;
      if (key.length === 0) { subRe.lastIndex++; continue; } // 방어적 (현재 패턴상 발생 안 함)
      // 2글자 이하 한글 키 + 바로 앞 글자도 한글이면 스킵 (한글 단어 중간 오탐 방지, 레퍼런스 이식)
      if (key.length <= 2 && isHangulChar(key[0])) {
        const prevCh = start > 0 ? lower[start - 1] : '';
        if (isHangulChar(prevCh)) continue;
      }
      const terms = REGISTRY.substringGroups.get(key) || [];
      for (const t of terms) {
        if (!scopeMatches(t.scope, scope)) continue;
        cands.push({
          start, end: start + key.length, to: t.to, isMask: t.isMask, len: key.length,
          looseSuffix: t.looseSuffix,
        });
      }
    }
  }

  if (wordRe) {
    wordRe.lastIndex = 0;
    let m;
    while ((m = wordRe.exec(text))) {
      const key = m[0];
      const start = m.index;
      const terms = REGISTRY.wordGroups.get(key) || [];
      for (const t of terms) {
        if (!scopeMatches(t.scope, scope)) continue;
        cands.push({
          start, end: start + key.length, to: t.to, isMask: t.isMask, len: key.length,
          looseSuffix: t.looseSuffix,
        });
      }
      if (wordRe.lastIndex === m.index) wordRe.lastIndex++; // 빈 매치 방어
    }
  }

  cands.sort((a, b) => (a.start - b.start) || (b.len - a.len));
  const out = [];
  let lastEnd = -1;
  for (const c of cands) {
    if (c.start < lastEnd) continue; // 이미 선택된(더 먼저 시작했거나 더 긴) 스팬과 겹침 -> 버림
    // 토큰 해석으로 이미 삽입된 가명 구간과 겹치면 버린다 (재진입 이중 치환 방지, §3 주석)
    if (protectedSpans.some((p) => c.start < p.end && p.start < c.end)) continue;
    // 그룹 어간이 회사가 아닌 일반 낱말의 일부인 경우 (§1-2 GROUP_STEM_COMMON_WORDS)
    if (c.looseSuffix && isGroupStemCommonWord(text, c.start, c.end)) continue;
    out.push(c);
    lastEnd = c.end;
  }
  return out;
}

/** 스팬을 실제로 적용하고, 각 치환 지점 바로 뒤 조사를 보정한다(§0-1). 원문은 절대
 *  재스캔하지 않는다 - 모든 스팬이 원문 기준으로 미리 확정된 뒤 한 번에 조립된다. */
function applyEngineSpans(text, spans) {
  if (!spans.length) return text;
  let out = '';
  let pos = 0;
  for (const { start, end, to, isMask, looseSuffix } of spans) {
    out += text.slice(pos, start);
    if (isMask) {
      // 보호행: 원문 그대로 둔다(조사 포함 - 애초에 아무것도 안 바뀌므로 보정 불필요)
      out += text.slice(start, end);
      pos = end;
      continue;
    }
    const rest = text.slice(end);
    let particleMatch = rest.match(PARTICLE_HEAD_RE);
    // 2026-07-20 추가: looseSuffix 텀(§1-1/§2-2 그룹 어간)은 뒤에 사전에 없는 임의 접미어가
    // 올 수 있다. "이노베이션"처럼 조사와 같은 음절(이/가/은/는/로 등)로 시작하는 단어가
    // 그 접미어 자리에 오면, 정규식만으로는 진짜 조사와 구별이 안 돼 "SK이노베이션"이
    // "태서가노베이션"처럼 깨진다(실제 코퍼스 재현 확인 - 검증 보고서 참고). 매치된 조사
    // 후보 바로 다음 글자가 한글이면(=조사 뒤에 공백/문장부호/문자열끝 없이 한글 음절이
    // 계속 이어지면) 진짜 조사가 아니라 더 긴 단어의 일부로 보고 보정을 포기한다. 일반
    // 텀(looseSuffix 없음)은 기존 동작 그대로 유지한다 - 사람이 큐레이션한 117 정식명/
    // 별칭/코인 뒤에는 이 오인식이 실질적으로 발생하지 않았고(사전 자체가 흔한 단어를
    // 피해 만들어짐), 오히려 이 체크를 전역 적용하면 종토방의 "조사 뒤 공백 생략" 캐주얼
    // 표기(예: "삼성카드를만들었다")에서 조사 보정이 과도하게 보수적으로 동작할 위험이
    // 있다(§2-1 addTerm 주석 참고).
    if (particleMatch && looseSuffix) {
      const afterParticle = rest[particleMatch[0].length];
      if (afterParticle !== undefined && isHangulChar(afterParticle)) particleMatch = null;
    }
    if (particleMatch) {
      out += to + fixTrailingParticle(to, particleMatch[0], batchimOverrideFor(to));
      pos = end + particleMatch[0].length;
    } else {
      out += to;
      pos = end;
    }
  }
  out += text.slice(pos);
  return out;
}

function applyRealNameEngine(text, scope, protectedSpans = []) {
  const spans = findSpans(text, scope, protectedSpans);
  return applyEngineSpans(text, spans);
}

// =====================================================================
// 3. 토큰 해석 ({{STOCK_<code>}} / {{COIN_<id>}})
// =====================================================================
// dci_board_rewritten 산출물은 스레드 자신의 대상 종목/코인 언급을 이 플레이스홀더로
// 정규화해 뒀다. 코드/id가 토큰 안에 그대로 들어있어 스레드의 target_kind/target_id를
// 몰라도 전역 사전만으로 해석 가능하다 - 그래서 이 구현은 (구버전과 달리) 호출자가
// 대상 종목/코인을 별도로 알려줄 필요 없이 어떤 텍스트에서든 토큰을 찾아 해석한다.
// 뉴스 본문에는 토큰이 없는 것으로 확인됐지만(실측), 있어도 안전하게 동작한다.
// 토큰 뒤에 붙는 조사도 캡처해 보정한다(치환 엔진과 동일한 이유 - 예: "이더리움"(받침
// 있음)의 토큰을 ko_name "루미니스"(받침 없음)로 복원하면 "은"을 "는"으로 바꿔야 한다).
const TOKEN_RE = new RegExp(`\\{\\{(STOCK|COIN)_([A-Za-z0-9_-]+)\\}\\}(${PARTICLE_ALT})?`, 'g');

const unresolvedTokens = new Map(); // "STOCK:code" | "COIN:id" -> 미해석 건수

// 2026-07-20 재진입 버그 수정:
// 이전 리비전은 String.replace로 토큰만 바꾸고 결과 문자열을 그대로 applyRealNameEngine에
// 넘겼다. 그러면 방금 삽입한 가명이 다시 치환 후보가 되어 이중 치환이 발생한다
// (실측: {{STOCK_036460}} -> "대진가스공사" -> "대진대진가스" 61회,
//        {{STOCK_000990}} -> "DS하이텍"    -> "DSDS하이텍"   34회).
// 원인은 가명 자체가 다른 텀의 부분문자열이 될 수 있기 때문이다("대진가스공사"의 "대진"이
// 한국전력 그룹 어간, "DS하이텍"의 "DS"가 DB->DS 별칭 결과와 충돌).
// 해법: 삽입한 가명의 출력 기준 [start,end) 구간을 반환해, 뒤이은 스팬 엔진이 그 구간과
// 겹치는 후보를 전부 버리게 한다(엔진의 기존 __MASK__ 보호와 동일한 취급).
// 조사 보정분은 보호 구간에 넣지 않는다 - 조사는 이미 올바르게 확정됐고, 그 뒤부터는
// 정상적으로 치환 후보를 찾아야 하기 때문이다.
function resolveTokens(text) {
  // 빠른 경로 (대다수 텍스트는 토큰이 없음)
  if (!text.includes('{{')) return { text, protectedSpans: [] };

  const protectedSpans = [];
  let out = '';
  let pos = 0;
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text))) {
    const [whole, kind, id, particle] = m;
    out += text.slice(pos, m.index);
    pos = m.index + whole.length;

    let replacement = null;
    if (kind === 'STOCK') {
      replacement = STOCK_MAP.byCode.get(id) || null;
    } else {
      const coin = COIN_MAP.byId.get(id);
      // 코인은 한글 문맥(커뮤니티) 토큰이므로 ko_name(가명의 한글 발음형)을 우선 쓴다.
      // 비어있으면(이론상 in_text_corpus=1인데 ko_name 누락 등) masked_name(영문) 폴백.
      replacement = coin ? (coin.koName || coin.maskedName) : null;
    }

    if (replacement) {
      const start = out.length;
      out += replacement;
      protectedSpans.push({ start, end: out.length }); // 조사는 제외 (위 주석 참고)
      if (particle) {
        const override = batchimOverrideFor(replacement); // 종목 토큰이면 masked_has_batchim 적용
        out += fixTrailingParticle(replacement, particle, override);
      }
    } else {
      // 사전에 없는 토큰: 삭제하지 않고 원문 그대로 두되(조사 포함, whole에 이미 포함됨)
      // 카운트한다(요구사항). 원문 그대로이므로 보호 구간에 넣지 않는다.
      const key = `${kind}:${id}`;
      unresolvedTokens.set(key, (unresolvedTokens.get(key) || 0) + 1);
      out += whole;
    }
  }
  out += text.slice(pos);
  return { text: out, protectedSpans };
}

/** 미해석 토큰 요약. 적재 종료 시 리포트용. */
function getUnresolvedTokenReport() {
  const entries = [...unresolvedTokens.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
  const total = entries.reduce((sum, e) => sum + e.count, 0);
  return { total, distinct: entries.length, entries };
}

/** unresolvedTokens는 프로세스 전역 누적이다(모듈 싱글턴) - import_all.js처럼 한 프로세스
 *  안에서 import_news 다음에 import_community를 연달아 돌리면 두 번째 리포트가 첫 번째
 *  것까지 누적해 보여줄 수 있다. 각 seeds 스크립트는 자기 작업 시작 시 이걸 호출해
 *  리포트를 자기 범위로 한정한다. */
function resetUnresolvedTokenStats() {
  unresolvedTokens.clear();
}

// =====================================================================
// 4. maskText — 토큰 해석 -> 통합 치환 엔진(실명 직접 치환 + 별칭, §2)
// =====================================================================

/**
 * 본문 문자열에서 회사/코인명을 가명으로 치환한다.
 * 순서: 1) {{STOCK_x}}/{{COIN_x}} 토큰 해석 2) 스팬 기반 통합 엔진(실명 직접 치환 +
 * 별칭 치환을 하나의 비중첩 최長우선 선택으로 함께 수행 - §2 상단 주석 참고) — 각
 * 단계에서 조사 보정을 함께 수행한다.
 * @param {string} text
 * @param {string|{scope?: 'stock_board'|'coin_board'|'news'|'all'}} [scopeOrOptions] 문자열이면 scope로 취급
 */
// =====================================================================
// 3-1. 멱등성 — 이미 가명인 구간 보호 (2026-07-20 추가)
// =====================================================================
// data-pipeline의 pr_rename01_apply.py가 원천 JSONL에 마스킹을 적용하기 시작했다
// (2026-07-20 14:44 실측: stock_news/annual_earnings/split_articles/board에 실명 0건,
// 가명 존재. market_news는 종목명이 없어 미적용).
// 그 상태의 텍스트를 ETL이 다시 마스킹하면, 가명 안의 부분문자열이 짧은 별칭에 재매칭돼
// 이중 치환이 난다 - 실측: "대진가스공사"의 "가스공사"가 별칭에 걸려 "대진대진가스"(66회),
// "DS하이텍"의 "하이텍"이 걸려 "DSDS하이텍"(38회).
//
// ETL 마스킹을 끄지 않는 이유: 원천 적용은 최근에야 성공했고 앞으로도 실패/부분적용될 수
// 있다(같은 스크립트가 오전까지 통계만 쓰고 write-back을 못 하던 상태였다). ETL은 백스톱을
// 유지하되 멱등이어야 한다 - 원천이 마스킹됐든 안 됐든 결과가 같아야 한다.
//
// 방법: 치환 전에 "이미 가명인 표면형"의 위치를 찾아 보호 구간으로 등록한다. §3의 토큰
// 보호와 동일한 메커니즘을 재사용한다.
const MASKED_SURFACE_FORMS = (() => {
  const forms = new Set();
  for (const masked of STOCK_MAP.byRealName.values()) if (masked) forms.add(masked);
  for (const c of COIN_MAP.byId.values()) {
    if (c.maskedName) forms.add(c.maskedName);
    if (c.koName) forms.add(c.koName);
  }
  for (const t of GROUP_STEM_TERMS) if (t.masked) forms.add(t.masked);
  for (const e of ALIAS_MAP.replaceable) if (e.to) forms.add(e.to);
  // 짧은 것은 오히려 과보호(=치환 누락) 위험이 크다. 한글 2글자 이하는 제외한다.
  return [...forms].filter((f) => isAsciiToken(f) || f.length >= 3).sort((a, b) => b.length - a.length);
})();

const MASKED_SUB_RE = (() => {
  const hangul = MASKED_SURFACE_FORMS.filter((f) => !isAsciiToken(f));
  return hangul.length ? new RegExp(hangul.map(escapeRegExp).join('|'), 'g') : null;
})();
const MASKED_WORD_RE = (() => {
  const ascii = MASKED_SURFACE_FORMS.filter((f) => isAsciiToken(f));
  return ascii.length
    ? new RegExp(`(?<![A-Za-z0-9])(?:${ascii.map(escapeRegExp).join('|')})(?![A-Za-z0-9])`, 'g')
    : null;
})();

/** 텍스트에서 이미 가명으로 치환된 구간을 찾아 [{start,end}]로 반환한다(최장우선 비중첩). */
function findAlreadyMaskedSpans(text) {
  const spans = [];
  for (const re of [MASKED_SUB_RE, MASKED_WORD_RE]) {
    if (!re) continue;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      spans.push({ start: m.index, end: m.index + m[0].length });
      if (re.lastIndex === m.index) re.lastIndex++;
    }
  }
  return spans;
}

function maskText(text, scopeOrOptions) {
  if (text === null || text === undefined || text === '') return text;
  const options = typeof scopeOrOptions === 'string' ? { scope: scopeOrOptions } : scopeOrOptions || {};
  const scope = options.scope || 'all';
  // 1. 토큰 해석 — 삽입한 가명 구간을 protectedSpans로 받아 2단계에서 재치환되지 않게 한다
  const { text: resolved, protectedSpans } = resolveTokens(String(text));
  // 1-1. 원천이 이미 마스킹된 경우의 멱등성 확보 (§3-1)
  const guarded = protectedSpans.concat(findAlreadyMaskedSpans(resolved));
  // 2+3. 실명 직접 치환 + 별칭 치환 (통합 엔진)
  return applyRealNameEngine(resolved, scope, guarded);
}

// =====================================================================
// 5. 잔존 실명 검출 (치환 후에도 rename_map의 실명이 남아있는지 전수 검사)
// =====================================================================
// 적재를 실패시키지 않는다 - 결과는 리포트로만 남겨 데이터 담당이 사전을 보강할 근거로
// 쓴다. 종목 정식명 검사는 FORBIDDEN_SINGLE_NAMES/MIN_STOCK_NAME_LEN로 제외하지 않는다
// (실제 마스킹 엔진은 안전을 위해 그것들을 일부러 건드리지 않지만, 리포트는 "그래도
// 원문에 얼마나 남아있는지" 있는 그대로 보여줘야 데이터 담당이 보강 여부를 판단할 수
// 있다). 다만 ASCII 짧은 표기는 여전히 단어 경계를 적용해 "LG전자"류 사전 밖 표현을
// "LG" 잔존으로 오카운트하지 않게 한다. __MASK__ 보호행의 real_alias는 애초에 마스킹
// 대상이 아니므로(오히려 "건드리면 안 되는" 대상) 잔존 검사에서 제외한다.

function isAsciiToken(s) {
  return /^[A-Za-z0-9&.\-]+$/.test(s);
}

function aliasResidualTermsFor(scope) {
  return ALIAS_MAP.replaceable
    .filter((e) => scopeMatches(e.scope, scope))
    .map((e) => ({ type: 'alias', key: `${e.domain}:${e.from}`, label: e.from, from: e.from }));
}

function countOccurrences(text, needle) {
  if (!needle || !text.includes(needle)) return 0;
  if (!isAsciiToken(needle)) {
    let count = 0;
    let idx = 0;
    while ((idx = text.indexOf(needle, idx)) !== -1) {
      count++;
      idx += needle.length;
    }
    return count;
  }
  const re = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(needle)}(?![A-Za-z0-9])`, 'g');
  const m = text.match(re);
  return m ? m.length : 0;
}

/** text(마스킹 후 결과) 안에 rename_map의 실명 표면형이 남아있는지 검사한다. */
function scanResidualRealNames(text, scope = 'all') {
  if (!text) return [];
  const terms = [
    ...STOCK_MAP.residualTerms, ...COIN_MAP.residualTerms, ...aliasResidualTermsFor(scope),
    ...GROUP_STEM_RESIDUAL_TERMS,
  ];
  const hits = [];
  for (const term of terms) {
    const count = countOccurrences(text, term.from);
    if (count > 0) hits.push({ type: term.type, key: term.key, label: term.label, count });
  }
  return hits;
}

/**
 * 여러 텍스트에 걸친 잔존 실명을 누적 집계하는 트래커.
 * 사용법: const t = createResidualTracker('news'); ... t.record(maskedText, scope); ... t.report();
 */
function createResidualTracker(label) {
  const counts = new Map(); // key -> {type,label,count}
  let totalTexts = 0;
  let totalHits = 0;
  return {
    record(text, scope) {
      totalTexts++;
      const hits = scanResidualRealNames(text, scope);
      for (const h of hits) {
        totalHits += h.count;
        const prev = counts.get(h.key) || { type: h.type, label: h.label, count: 0 };
        prev.count += h.count;
        counts.set(h.key, prev);
      }
    },
    report(topN = 20) {
      const sorted = [...counts.values()].sort((a, b) => b.count - a.count);
      console.log(
        `[maskingService] 잔존 실명 검사 (${label}): 검사 텍스트 ${totalTexts}건 중 잔존 ${totalHits}건 ` +
          `(관련 종목/코인/별칭 ${sorted.length}종)`
      );
      sorted.slice(0, topN).forEach((row, i) => {
        console.log(`  ${i + 1}. [${row.type}] ${row.label}: ${row.count}건`);
      });
      if (sorted.length > topN) console.log(`  ... 외 ${sorted.length - topN}종`);
      return { label, totalTexts, totalHits, distinct: sorted.length, top: sorted.slice(0, topN) };
    },
  };
}

// =====================================================================
// 6. 진단용
// =====================================================================

function getDictionaryStats() {
  return {
    stock: { loaded: STOCK_MAP.loaded, names: STOCK_MAP.byRealName.size, codes: STOCK_MAP.byCode.size },
    coin: { loaded: COIN_MAP.loaded, entries: COIN_MAP.realEntries.length, ids: COIN_MAP.byId.size },
    alias: { loaded: ALIAS_MAP.loaded, replaceable: ALIAS_MAP.replaceable.length, raw: ALIAS_MAP.raw.length },
    groupStem: {
      total: STOCK_MAP.groupStems.size,
      registered: GROUP_STEM_TERMS.length,
      identitySurfaceForms: GROUP_IDENTITY_SURFACE_FORMS.size,
    },
    engine: { substringKeys: REGISTRY.substringGroups.size, wordKeys: REGISTRY.wordGroups.size },
  };
}

module.exports = {
  maskText,
  getUnresolvedTokenReport,
  resetUnresolvedTokenStats,
  scanResidualRealNames,
  createResidualTracker,
  getDictionaryStats,
  fixParticle,
};
