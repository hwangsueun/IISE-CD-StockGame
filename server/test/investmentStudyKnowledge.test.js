const test = require('node:test');
const assert = require('node:assert/strict');
const { KNOWLEDGE, selectStudyKnowledge } = require('../src/education/investmentStudyKnowledge');

test('study curriculum covers distinct concepts in 12 topics with linked, answerable quizzes', () => {
  assert.equal(KNOWLEDGE.length, 48);
  assert.equal(new Set(KNOWLEDGE.map((lesson) => lesson.id)).size, 48);
  assert.equal(new Set(KNOWLEDGE.map((lesson) => lesson.insight)).size, 48);
  const topics = new Map();
  for (const lesson of KNOWLEDGE) {
    topics.set(lesson.topic, (topics.get(lesson.topic) || 0) + 1);
    assert.ok(lesson.title.length > 0);
    assert.ok(lesson.insight.length <= 160, `${lesson.id}: concise enough for event card`);
    assert.equal(lesson.quiz.chip, lesson.topic);
    assert.equal(lesson.quiz.opts.length, 4);
    assert.equal(new Set(lesson.quiz.opts).size, 4);
    assert.ok(Number.isInteger(lesson.quiz.answer) && lesson.quiz.answer >= 0 && lesson.quiz.answer < 4);
    assert.equal(lesson.quiz.explain, lesson.insight);
  }
  assert.deepEqual([...topics.keys()], [
    '분산투자', '위험관리', '거래비용', '주문과 체결', '재무지표', '시장지수',
    '배당과 기업행동', '투자심리', '거래량과 유동성', '리밸런싱', '거시경제', '전략검증',
  ]);
  assert.ok([...topics.values()].every((count) => count === 4));
});

test('each lesson appears once before a repeat, across multiple full cycles', () => {
  // Fixed draws test both the first and last edge of the random range.
  for (const draw of [0, 0.37, 0.999999]) {
    const history = [];
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const seen = new Set();
      for (let i = 0; i < KNOWLEDGE.length; i += 1) {
        const lesson = selectStudyKnowledge(history, () => draw);
        assert.equal(seen.has(lesson.id), false, `${draw}: cycle ${cycle}: ${lesson.id}`);
        assert.ok(!history.slice(0, 12).some((old) => old.insightId === lesson.id));
        seen.add(lesson.id);
        history.unshift({ insightId: lesson.id, insight: lesson.insight });
      }
      assert.equal(seen.size, 48);
    }
  }
});

test('recent topics are skipped when another equally learned topic is available', () => {
  const first = KNOWLEDGE.find((lesson) => lesson.topic === '분산투자');
  const second = KNOWLEDGE.find((lesson) => lesson.topic === '위험관리');
  const selected = selectStudyKnowledge([{ detail: { insightId: first.id } }, { insightId: second.id }], () => 0);
  assert.notEqual(selected.topic, first.topic);
  assert.notEqual(selected.topic, second.topic);
});

test('legacy insight strings count as learned, while unrelated or malformed details are harmless', () => {
  const history = [
    { detail: { insight: '분산 투자는 개별 종목 리스크를 줄여준다.' } },
    { insight: '금리가 오르면 기업의 이자 부담이 커질 수 있다.' },
    { insight: '거래량이 실리지 않은 급등은 오래가지 못하는 경우가 많다.' },
    { insight: 'PER이 낮다고 무조건 저평가는 아니다. 업종 평균과 비교하라.' },
    { insightId: 'unknown-old-id' }, null, {},
  ];
  const snapshot = JSON.stringify(history);
  const seen = new Set();
  for (let i = 0; i < 44; i += 1) {
    const selected = selectStudyKnowledge(history, () => 0);
    assert.ok(!['diversify_single', 'macro_interest', 'volume_price', 'valuation_per'].includes(selected.id));
    assert.equal(seen.has(selected.id), false);
    seen.add(selected.id);
    history.unshift({ insightId: selected.id });
  }
  assert.equal(seen.size, 44);
  assert.equal(JSON.stringify(history.slice(44)), snapshot);
});

test('selection is per session and independent of global mutable progress', () => {
  const selected = selectStudyKnowledge([], () => 0);
  assert.equal(selectStudyKnowledge([], () => 0).id, selected.id);
  assert.notEqual(selectStudyKnowledge([{ insightId: selected.id }], () => 0).id, selected.id);
  assert.equal(selectStudyKnowledge([], () => 0).id, selected.id);
  assert.ok(selectStudyKnowledge([], () => 1));
  assert.ok(selectStudyKnowledge([], () => Number.NaN));
});
