import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEvidence, normalizePending, emptyDocumentMemory, emptyGlobalMemory } from '../../src/memory/normalize.ts'
import { applyGlobalQuiz, applyQuizResult } from '../../src/memory/merge.ts'
import {
  buildDocumentInput, buildGlobalInput, quizResultText, DOCUMENT_SUMMARY_SYSTEM, GLOBAL_SUMMARY_SYSTEM, PURPOSE_USAGE,
} from '../../src/memory/prompts.ts'

const NOW = 1_764_000_000_000
const EVENT = {
  type: 'quiz-result',
  docId: 'doc-1',
  title: '高等数学（上）',
  examId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  total: 142,
  max: 200,
  byType: {
    single: { score: 80, max: 100 },
    multiple: { score: 25, max: 40 },
    essay: { score: 37, max: 60 },
  },
  weak: [{ tag: '泰勒公式', lost: 15 }, { tag: '无穷小比较', lost: 10 }],
  selfAssessed: true,
  note: '未作答 2 题',
  at: NOW,
}

test('memory quiz: normalizePending / normalizeEvidence 保留 quiz 记录', () => {
  const pending = normalizePending([
    { id: 'p1', kind: 'quiz-result', at: NOW, question: '模拟测试结果', answer: '失分较多的知识点：泰勒公式（-15）', turnId: 'exam:x' },
    { id: 'p2', kind: 'unknown', question: 'x' },
  ])
  assert.equal(pending.length, 1)
  assert.equal(pending[0].kind, 'quiz-result')
  const evidence = normalizeEvidence([
    { id: 'qz-1', kind: 'quiz', at: NOW, text: '模拟测试自评 142/200', ref: '模拟测试' },
    { id: 'e2', kind: 'nope', at: NOW, text: 'x' },
  ])
  assert.equal(evidence.length, 1)
  assert.equal(evidence[0].kind, 'quiz')
})

test('memory quiz: quizResultText 的三段文案与上限', () => {
  const text = quizResultText(EVENT)
  assert.equal(text.question, '模拟测试结果（用户自评）：《高等数学（上）》自评 142/200；单选 80/100，多选 25/40，大题自评 37/60')
  assert.equal(text.answer, '失分较多的知识点：泰勒公式（-15）、无穷小比较（-10）；未作答 2 题')
  assert.equal(text.evidence, '模拟测试自评 142/200，薄弱：泰勒公式、无穷小比较')
  const noWeak = quizResultText({ ...EVENT, weak: [], note: '' })
  assert.equal(noWeak.answer, '没有明显的薄弱点')
  assert.ok(noWeak.question.length <= 500)
  assert.ok(noWeak.answer.length <= 300)
  assert.ok(noWeak.evidence.length <= 160)
})

test('memory quiz: applyQuizResult 只写一次，turnId 相同则替换', () => {
  const memory = emptyDocumentMemory('doc-1', '高等数学（上）', NOW)
  const first = applyQuizResult(memory, EVENT, NOW)
  assert.equal(first.changed, true)
  assert.equal(first.memory.pending.length, 1)
  assert.equal(first.memory.pending[0].kind, 'quiz-result')
  assert.equal(first.memory.pending[0].turnId, `exam:${EVENT.examId}`)
  assert.equal(first.memory.evidence.length, 1)
  assert.equal(first.memory.evidence[0].kind, 'quiz')
  assert.equal(first.memory.evidence[0].id, 'qz-aaaaaaaabbbbccccdddde')
  assert.equal(first.memory.reading.questions, memory.reading.questions)
  assert.equal(first.memory.reading.activeDays, memory.reading.activeDays + 1)

  const again = applyQuizResult(first.memory, { ...EVENT, total: 150 }, NOW + 1000)
  assert.equal(again.changed, true)
  assert.equal(again.memory.pending.length, 1)
  assert.match(again.memory.pending[0].question, /150\/200/)

  const consumed = { ...again.memory, pending: [] }
  const stale = applyQuizResult(consumed, EVENT, NOW + 2000)
  assert.equal(stale.changed, false)
  assert.equal(stale.memory, consumed)
})

test('memory quiz: applyGlobalQuiz 三分支与全局证据 ref', () => {
  const global = emptyGlobalMemory(NOW)
  const first = applyGlobalQuiz(global, EVENT, NOW)
  assert.equal(first.changed, true)
  assert.equal(first.memory.pending.length, 1)
  assert.equal(first.memory.evidence[0].kind, 'quiz')
  assert.match(first.memory.evidence[0].ref, /^模拟测试 · 《高等数学（上）》/)
  const second = applyGlobalQuiz(first.memory, EVENT, NOW + 10)
  assert.equal(second.memory.pending.length, 1)
  const consumed = { ...second.memory, pending: [] }
  assert.equal(applyGlobalQuiz(consumed, EVENT, NOW + 20).changed, false)
})

test('memory quiz: 总结输入里的 from 与系统提示词规则', () => {
  const memory = applyQuizResult(emptyDocumentMemory('doc-1', '高等数学（上）', NOW), EVENT, NOW).memory
  const input = buildDocumentInput(memory, NOW)
  const parsed = JSON.parse(input.text)
  assert.equal(parsed.new_turns[0].from, '模拟测试结果（用户自评）')
  assert.equal(parsed.new_turns[0].question, '模拟测试结果（用户自评）：《高等数学（上）》自评 142/200；单选 80/100，多选 25/40，大题自评 37/60')
  const global = applyGlobalQuiz(emptyGlobalMemory(NOW), EVENT, NOW).memory
  const globalInput = JSON.parse(buildGlobalInput(global, [], NOW).text)
  assert.equal(globalInput.new_turns[0].from, '模拟测试结果（用户自评）')
  assert.ok(DOCUMENT_SUMMARY_SYSTEM.includes('模拟测试结果（用户自评）'))
  assert.ok(DOCUMENT_SUMMARY_SYSTEM.includes('必须标明是自评'))
  assert.ok(GLOBAL_SUMMARY_SYSTEM.includes('必须标明是自评'))
  assert.equal(
    PURPOSE_USAGE.exam,
    '使用要求：按记忆里的薄弱点、易错点和学习目标调整考查重点与难度，可以多出几道针对薄弱点的题；不要把「最近关注」里的问题原样当成题干，不要在题目里提及记忆或用户的个人信息；记忆与文档内容冲突时，以文档为准。',
  )
})
