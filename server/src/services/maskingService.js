// 회사명 가명 처리 (ARCHITECTURE.md §6 마스킹)
// 원칙: 마스킹은 ETL(seeds/import 단계)에서 완료하고, 서버는 masked_name만 응답에 쓴다.
// 이 서비스는 ETL이 놓친 본문 내 회사명 치환과 조사 보정 공용 유틸을 제공한다.

/**
 * 별칭 -> 정식명 정규화 테이블.
 * TODO(data): 마스킹 담당이 확정한 별칭 사전으로 교체 (예: 삼전 -> 삼성전자)
 */
const ALIAS_TO_CANONICAL = {};

/**
 * 정식명 -> 가상 회사명 치환 테이블.
 * TODO(data): 확정 가명 사전으로 교체 (예: 삼성전자 -> A전자)
 */
const CANONICAL_TO_MASKED = {};

/** 받침 유무에 따른 조사 보정 (을/를, 이/가, 은/는, 과/와) */
function fixParticle(word, particlePair) {
  const [withFinal, withoutFinal] = particlePair; // 예: ['을','를']
  const last = word.charCodeAt(word.length - 1);
  const hasFinal = (last - 0xac00) % 28 !== 0;
  return word + (hasFinal ? withFinal : withoutFinal);
}

/** 본문 문자열에서 회사명을 가명으로 치환 (조사 보정 포함) */
function maskText(text) {
  let out = text;
  for (const [alias, canonical] of Object.entries(ALIAS_TO_CANONICAL)) {
    out = out.split(alias).join(canonical);
  }
  for (const [canonical, masked] of Object.entries(CANONICAL_TO_MASKED)) {
    out = out.split(canonical).join(masked);
  }
  // TODO(data): 치환 후 조사 보정 규칙 적용 (fixParticle 활용)
  return out;
}

module.exports = { maskText, fixParticle, ALIAS_TO_CANONICAL, CANONICAL_TO_MASKED };
