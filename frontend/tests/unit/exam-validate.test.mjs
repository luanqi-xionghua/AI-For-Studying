import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ExamError, fingerprintOf, parseModelJson, validateBatch, validatePlan, validateQuestion, validateStoredQuestion,
} from '../../src/exam/validate.ts'

const NOW = 1_764_000_000_000

function slotOf(slot, type, difficulty = 'medium', topic = '数列极限') {
  return { slot, type, difficulty, topic, batch: 0 }
}

function rawSingle(overrides = {}) {
  return {
    slot: 0,
    type: 'single',
    difficulty: 'medium',
    stem: '已知函数 f(x)=x^{2}，求 f(0) 的值。',
    options: ['A', 'B', 'C', 'D'].map(key => ({ key, text: `选项 ${key} 的表述` })),
    answer: ['B'],
    rubric: [],
    explanation: '把 x=0 代入即可得到 0，注意定义域。',
    knowledge: ['数列极限'],
    source: { pages: [30], evidenceIds: ['S1a2b3c-1'] },
    ...overrides,
  }
}

function rawEssay(overrides = {}) {
  return {
    slot: 16,
    type: 'essay',
    difficulty: 'medium',
    stem: '说明洛必达法则的适用条件，并给出一个完整的计算过程。',
    options: [],
    answer: '步骤一：写出条件。步骤二：求导。步骤三：得到最终答案：1。',
    rubric: [
      { point: '写出条件', score: 3 },
      { point: '求导正确', score: 4 },
      { point: '结论正确', score: 3 },
    ],
    explanation: '',
    knowledge: ['洛必达法则'],
    answerStyle: 'stem',
    source: { pages: [58], evidenceIds: ['S1a2b3c-1'] },
    ...overrides,
  }
}

function context(overrides = {}) {
  return {
    examId: 'exam-1',
    docId: 'doc-1',
    kind: 'pdf',
    pages: 412,
    subject: 'stem',
    evidence: new Map([
      ['S1a2b3c-1', { page: 33, line: 0, text: '原文摘录一' }],
      ['S1a2b3c-2', { page: 34, line: 0, text: '原文摘录二' }],
    ]),
    grounded: true,
    primaryCounts: {},
    topicCap: 3,
    fingerprints: [],
    displayNo: {},
    now: NOW,
    ...overrides,
  }
}

test('validate: 输出前有旁白也能取到 questions', () => {
  const text = '我先看目录 {"tool":"pdf_info"}\n{"questions":[{"slot":0}]}'
  assert.deepEqual(parseModelJson(text, 'questions'), { questions: [{ slot: 0 }] })
})

test('validate: 剥掉 <think> 与 json 代码块', () => {
  const text = '<think>先想想</think>\n```json\n{"questions":[{"slot":1}]}\n```\n'
  assert.deepEqual(parseModelJson(text, 'questions'), { questions: [{ slot: 1 }] })
})

test('validate: 尾逗号可修复', () => {
  const text = '{"questions":[{"slot":0},]}'
  assert.deepEqual(parseModelJson(text, 'questions'), { questions: [{ slot: 0 }] })
})

test('validate: 缺少 rootKey 时给出成品文案', () => {
  assert.throws(() => parseModelJson('{"foo":1}', 'questions'), /模型返回的 JSON 缺少「questions」。/)
})

test('validate: 页码由证据推出，不信模型自报', () => {
  const raw = rawSingle({ source: { pages: [32], evidenceIds: ['S1a2b3c-1'] } })
  const question = validateQuestion(raw, slotOf(0, 'single'), context())
  assert.deepEqual(question.source.pages, [33])
  assert.deepEqual(question.source.evidenceIds, ['S1a2b3c-1'])
  assert.equal(question.source.quotes.length, 1)
})

test('validate: 单选必须恰好一个正确选项', () => {
  const raw = rawSingle({ answer: ['A', 'B'] })
  assert.throws(() => validateQuestion(raw, slotOf(0, 'single'), context()), (error) => {
    assert.ok(error instanceof ExamError)
    assert.equal(error.message, 'slot 0：单选题必须恰好有 1 个正确选项。')
    return true
  })
})

test('validate: 多选 1 个失败、4 个通过', () => {
  const slot = slotOf(10, 'multiple')
  const one = rawSingle({ slot: 10, type: 'multiple', answer: ['A'], knowledge: ['函数连续性'] })
  assert.throws(() => validateQuestion(one, slot, context()), /多选题的正确选项应为 2–3 个。/)
  const four = rawSingle({ slot: 10, type: 'multiple', answer: ['D', 'B', 'A', 'C'], knowledge: ['函数连续性'] })
  assert.deepEqual(validateQuestion(four, slot, context()).answer, ['A', 'B', 'C', 'D'])
})

test('validate: 三个选项失败；a. / B、等键名被修正为 A–D', () => {
  const slot = slotOf(0, 'single')
  const three = rawSingle({ options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }, { key: 'C', text: '丙' }] })
  assert.throws(() => validateQuestion(three, slot, context()), /选项必须是 A–D 四个且互不相同。/)

  const messy = rawSingle({
    options: [{ key: 'a.', text: '甲' }, { key: 'B、', text: '乙' }, { key: 'c)', text: '丙' }, { key: '(D)', text: '丁' }],
  })
  assert.deepEqual(validateQuestion(messy, slot, context()).options.map(item => item.key), ['A', 'B', 'C', 'D'])
})

test('validate: 大题评分要点条数与合计', () => {
  const slot = slotOf(16, 'essay')
  const sum = rawEssay({ rubric: [{ point: '一', score: 3 }, { point: '二', score: 3 }, { point: '三', score: 2 }] })
  assert.throws(() => validateQuestion(sum, slot, context()), (error) => {
    assert.equal(error.message, 'slot 16：评分要点合计 8 分，应正好 10 分。')
    return true
  })
  const few = rawEssay({ rubric: [{ point: '一', score: 5 }, { point: '二', score: 5 }] })
  assert.throws(() => validateQuestion(few, slot, context()), /评分要点应为 3–5 条。/)
})

test('validate: 不在证据表里的 sourceId 被丢弃，全丢光则失败', () => {
  const slot = slotOf(0, 'single')
  const mixed = rawSingle({ source: { pages: [32], evidenceIds: ['S1a2b3c-1', 'Sffffff-9'] } })
  assert.deepEqual(validateQuestion(mixed, slot, context()).source.evidenceIds, ['S1a2b3c-1'])
  const none = rawSingle({ source: { pages: [32], evidenceIds: ['Sffffff-9'] } })
  assert.throws(() => validateQuestion(none, slot, context()), /slot 0：来源 sourceId 不在本次读到的内容里。/)
})

test('validate: 降级模式不校验来源', () => {
  const raw = rawSingle({ source: { pages: [32], evidenceIds: ['Sffffff-9'] } })
  const question = validateQuestion(raw, slotOf(0, 'single'), context({ grounded: false }))
  assert.equal(question.grounded, false)
  assert.deepEqual(question.source.evidenceIds, [])
  assert.deepEqual(question.source.pages, [])
})

test('validate: 题型不符失败、难度不符改成槽位难度', () => {
  const slot = slotOf(0, 'single', 'medium')
  assert.throws(() => validateQuestion(rawSingle({ type: 'essay' }), slot, context()), /slot 0：题型应为 单选题。/)
  const question = validateQuestion(rawSingle({ difficulty: 'hard' }), slot, context())
  assert.equal(question.difficulty, 'medium')
})

test('validate: 题干重复（本卷已通过的题）', () => {
  const previous = ['第一道题的题干内容', '第二道题的题干内容', '第三道题的题干内容']
  const ctx = context({ fingerprints: previous.map(fingerprintOf), displayNo: {} })
  const raw = rawSingle({ slot: 8, stem: '第三道题的题干内容', knowledge: ['函数连续性'] })
  const result = validateBatch({ questions: [raw] }, [slotOf(8, 'single', 'medium', '函数连续性')], ctx)
  assert.equal(result.ok, false)
  assert.deepEqual(result.errors, ['slot 8：与第 3 题重复。'])
})

test('validate: 主知识点已满 3 题失败，知识点少时上限放宽', () => {
  const slot = slotOf(0, 'single')
  const ctx = context({ primaryCounts: { 数列极限: 3 }, topicCap: 3 })
  assert.throws(() => validateQuestion(rawSingle(), slot, ctx), /slot 0：知识点「数列极限」已经出了 3 题，请换一个知识点。/)
  assert.ok(validateQuestion(rawSingle(), slot, context({ primaryCounts: { 数列极限: 6 }, topicCap: 7 })))
})

test('validate: 本批题数不足时整批失败', () => {
  const slots = [slotOf(0, 'single'), slotOf(1, 'single')]
  const result = validateBatch({ questions: [rawSingle()] }, slots, context())
  assert.equal(result.ok, false)
  assert.deepEqual(result.errors, ['本批应恰好 2 道题，slot 为 0、1，实际收到 1。'])
})

test('validate: 题干 700 字截到 600', () => {
  const stem = `前缀${'长'.repeat(700)}`
  const question = validateQuestion(rawSingle({ stem }), slotOf(0, 'single'), context())
  assert.equal(question.stem.length, 600)
})

test('validate: 规划的题量不合法与知识点为空', () => {
  const raw = {
    subject: 'stem',
    reason: '公式为主',
    topics: [{ name: '数列极限', pages: [5, 5, 6, 0, 999] }],
    mix: { single: 10, multiple: 4, essay: 5 },
    note: '原文说明',
  }
  const plan = validatePlan(raw, 100)
  assert.equal(plan.mix, null)
  assert.match(plan.note, /出题要求里的题量不合法，已按模板出题。/)
  assert.deepEqual(plan.topics[0].pages, [5, 6])
  assert.throws(() => validatePlan({ subject: 'stem', topics: [] }, 100), /没能从这本书里整理出知识点。/)
  assert.equal(validatePlan({ subject: 'xxx', topics: [{ name: '甲' }] }, 100).subject, 'mixed')
})

test('validate: 控制字符被去掉、换行保留', () => {
  const stem = '第一行\u0001内容\n第二行内容'
  const question = validateQuestion(rawSingle({ stem }), slotOf(0, 'single'), context())
  assert.equal(question.stem.includes('\u0001'), false)
  assert.equal(question.stem.includes('\n'), true)
})

test('validate: 读回存储的题做结构检查', () => {
  const raw = { ...rawSingle(), version: 1, examId: 'exam-1', batch: 0, createdAt: NOW }
  const stored = validateStoredQuestion(raw, 'exam-1', 0)
  assert.ok(stored)
  assert.deepEqual(stored.source.pages, [30])
  assert.equal(validateStoredQuestion(raw, 'exam-1', 1), null)
  assert.equal(validateStoredQuestion(raw, 'other', 0), null)
  assert.equal(validateStoredQuestion(null, 'exam-1', 0), null)
})
