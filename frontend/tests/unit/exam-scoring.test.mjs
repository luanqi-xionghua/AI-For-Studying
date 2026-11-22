import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  completedCount, formatElapsed, liveScore, pendingSummary, scoreExam, scoreQuestion, weakPoints, blankItem,
  exportPendingMessage,
} from '../../src/exam/scoring.ts'
import { answeredAnswers, emptyAnswers, questions as sampleQuestions } from './fixtures/exam-sample.mjs'

function question(slot, type, answer, tag = '知识点') {
  return {
    version: 1, examId: 'exam-1', id: `q${slot}`, slot, batch: 0, type,
    difficulty: 'medium', stem: `第 ${slot} 题`, options: [], answer,
    rubric: [], explanation: '', knowledge: [tag], answerStyle: '',
    source: { docId: 'doc-1', kind: 'pdf', pages: [], lines: [], evidenceIds: [], quotes: [] },
    grounded: true, createdAt: 0,
  }
}

function answersOf(map) {
  const base = emptyAnswers()
  for (const [slot, patch] of Object.entries(map)) base.items[String(slot)] = { ...blankItem(), ...patch }
  return base
}

test('scoring: 单选交卷后才判对错', () => {
  const q = question(0, 'single', ['B'])
  assert.deepEqual(scoreQuestion(q, { ...blankItem(), choice: ['B'] }, false), { judged: false, score: 10 })
  assert.deepEqual(scoreQuestion(q, { ...blankItem(), choice: ['A'] }, false), { judged: false, score: 0 })
  assert.deepEqual(scoreQuestion(q, blankItem(), false), { judged: false, score: 0 })
})

test('scoring: 多选全对 10 / 漏选 5 / 错选 0 / 未选 0，交卷或展开才判', () => {
  const q = question(10, 'multiple', ['A', 'C'])
  assert.deepEqual(scoreQuestion(q, { ...blankItem(), choice: ['A', 'C'] }, false), { judged: false, score: 10 })
  assert.deepEqual(scoreQuestion(q, { ...blankItem(), choice: ['A'] }, false), { judged: false, score: 5 })
  assert.deepEqual(scoreQuestion(q, { ...blankItem(), choice: ['A', 'B'] }, false), { judged: false, score: 0 })
  assert.deepEqual(scoreQuestion(q, blankItem(), false), { judged: false, score: 0 })
  assert.equal(scoreQuestion(q, { ...blankItem(), choice: ['A'], revealed: true }, false).judged, false)
  assert.equal(scoreQuestion(q, blankItem(), true).judged, true)
})

test('scoring: 大题自评，未自评按 0 且计入 unscored', () => {
  const q = question(14, 'essay', '答案')
  assert.deepEqual(scoreQuestion(q, { ...blankItem(), selfScore: 7 }, false), { judged: true, score: 7 })
  assert.deepEqual(scoreQuestion(q, blankItem(), true), { judged: false, score: 0 })
  const result = scoreExam([q], answersOf({}))
  assert.equal(result.unscored, 1)
})

test('scoring: 夹具 3 道单选答对 + 1 道大题 7 分 → liveScore 37', () => {
  const answers = { ...answeredAnswers(), submittedAt: 1 }
  assert.equal(liveScore(sampleQuestions, answers), 37)
  assert.equal(completedCount(sampleQuestions, answers), 4)
})

test('scoring: 15 题的卷满分 150，按题型合计正确', () => {
  const list = sampleQuestions.slice(0, 15)
  const result = scoreExam(list, answeredAnswers())
  assert.equal(result.max, 150)
  assert.equal(result.count, 15)
  assert.equal(result.byType.single.count, 10)
  assert.equal(result.byType.multiple.count, 4)
  assert.equal(result.byType.essay.count, 1)
  assert.equal(result.byType.single.max + result.byType.multiple.max + result.byType.essay.max, 150)
  assert.equal(result.byType.single.score + result.byType.multiple.score + result.byType.essay.score, result.total)
})

test('scoring: 薄弱点只取失分 ≥5 的前 5 个', () => {
  const list = [
    question(0, 'single', ['A'], '甲'),
    question(1, 'single', ['A'], '甲'),
    question(2, 'multiple', ['A', 'C'], '乙'),
    question(3, 'single', ['A'], '丙'),
    question(4, 'multiple', ['A', 'C'], '丁'),
    question(5, 'multiple', ['A', 'C'], '戊'),
    question(6, 'multiple', ['A', 'C'], '己'),
  ]
  const answers = answersOf({
    0: { choice: ['B'] },
    1: { choice: ['B'] },
    2: { choice: ['A'] },
    3: { choice: ['A'] },
    4: { choice: ['D'] },
    5: { choice: ['B'] },
    6: { choice: ['A', 'B'] },
  })
  assert.deepEqual(weakPoints(list, answers).map(item => [item.tag, item.lost, item.count]), [
    ['甲', 20, 2], ['丁', 10, 1], ['戊', 10, 1], ['己', 10, 1], ['乙', 5, 1],
  ])
})

test('scoring: 用时文案', () => {
  assert.equal(formatElapsed(30_000), '不到 1 分钟')
  assert.equal(formatElapsed(48 * 60_000), '48 分钟')
  assert.equal(formatElapsed(72 * 60_000), '1 小时 12 分钟')
})

test('scoring: 交卷确认文案三种与全答完', () => {
  const list = [
    question(0, 'single', ['A']),
    question(1, 'single', ['A']),
    question(2, 'multiple', ['A', 'C']),
    question(3, 'essay', '答案'),
  ]
  assert.equal(pendingSummary(list, answersOf({})).message, '还有 3 题没作答、1 道大题没自评，提交后按 0 分计。')
  assert.equal(
    pendingSummary(list, answersOf({ 0: { choice: ['A'] }, 1: { choice: ['B'] }, 2: { choice: ['A'] } })).message,
    '还有 1 道大题没自评，提交后按 0 分计。',
  )
  assert.equal(
    pendingSummary(list, answersOf({ 0: { choice: ['A'] }, 1: { choice: ['B'] }, 2: { choice: ['A'] }, 3: { selfScore: 6 } })).message,
    '全部题目都已作答，交卷后会生成成绩。',
  )
  const oneLeft = pendingSummary(list, answersOf({ 0: { choice: ['A'] }, 1: { choice: ['B'] }, 3: { selfScore: 6 } }))
  assert.equal(oneLeft.message, '还有 1 题没作答，提交后按 0 分计。')
  assert.deepEqual(oneLeft, { unanswered: 1, unscored: 0, message: '还有 1 题没作答，提交后按 0 分计。' })
})

test('scoring: 「仍然导出？」只写存在的那一类；两类都有时与 9.3 一字不差', () => {
  assert.equal(exportPendingMessage({ unanswered: 3, unscored: 1 }), '还有 3 题未作答、1 道大题未自评。仍然导出的话，这些题会标为「未作答」。')
  assert.equal(exportPendingMessage({ unanswered: 2, unscored: 0 }), '还有 2 题未作答。仍然导出的话，这些题会标为「未作答」。')
  assert.equal(exportPendingMessage({ unanswered: 0, unscored: 4 }), '还有 4 道大题未自评。仍然导出的话，这些题会标为「未自评」。')
  assert.equal(exportPendingMessage({ unanswered: 0, unscored: 0 }), '')
  assert.doesNotMatch(exportPendingMessage({ unanswered: 2, unscored: 0 }), /0 道大题/)
  assert.doesNotMatch(exportPendingMessage({ unanswered: 0, unscored: 4 }), /0 题未作答/)
})
