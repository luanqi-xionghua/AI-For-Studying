/**
 * 判分：单选选中即判、多选交卷（或提前展开答案）时判、大题自评。
 *
 * 纯函数。`judged = false` 表示「还没法判」，不计入实时分数，也不影响完成数；
 * 交卷时所有题都按 `submitted = true` 计，未作答按 0 分。
 */

import type { ExamAnswerItem, ExamAnswers, ExamQuestion, ExamResult, ExamType } from './types.ts'
import { EXAM_LIMITS, TYPE_NAMES } from './types.ts'

export const blankItem = (): ExamAnswerItem => ({ choice: [], revealed: false, revealedAt: 0, selfScore: null })

export function answerItem(answers: ExamAnswers, slot: number): ExamAnswerItem {
  return answers?.items?.[String(slot)] ?? blankItem()
}

const scoreOf = (points: number) => (Number.isFinite(points) ? Math.max(0, Math.min(EXAM_LIMITS.points, Math.round(points))) : 0)

export function scoreQuestion(
  question: ExamQuestion,
  item: ExamAnswerItem,
  submitted: boolean,
): { judged: boolean; score: number } {
  const chosen = Array.isArray(item?.choice) ? item.choice : []
  if (question.type === 'single') {
    const correct = Array.isArray(question.answer) ? question.answer[0] : ''
    return { judged: chosen.length > 0, score: chosen[0] === correct ? EXAM_LIMITS.points : 0 }
  }
  if (question.type === 'multiple') {
    const correct = new Set(Array.isArray(question.answer) ? question.answer : [])
    const picked = new Set(chosen)
    let score = 0
    if (picked.size === 0) score = 0
    else if ([...picked].some(key => !correct.has(key))) score = 0
    else score = picked.size === correct.size ? EXAM_LIMITS.points : 5
    return { judged: Boolean(submitted || item?.revealed), score }
  }
  const self = item?.selfScore
  const judged = typeof self === 'number' && Number.isFinite(self)
  return { judged, score: judged ? scoreOf(self as number) : 0 }
}

/** 顶部「已得 X / 满分」：只算已经能判的题。 */
export function liveScore(questions: ExamQuestion[], answers: ExamAnswers): number {
  return questions.reduce((total, question) => {
    const { judged, score } = scoreQuestion(question, answerItem(answers, question.slot), false)
    return judged ? total + score : total
  }, 0)
}

/** 顶部「已完成 m / n」：客观题已选 + 大题已自评。 */
export function completedCount(questions: ExamQuestion[], answers: ExamAnswers): number {
  return questions.filter(question => {
    const item = answerItem(answers, question.slot)
    if (question.type === 'essay') return typeof item.selfScore === 'number'
    return Array.isArray(item.choice) && item.choice.length > 0
  }).length
}

/** 每题的失分记到主知识点（`knowledge[0]`）上，取失分 ≥ 5 的前 5 个。 */
export function weakPoints(
  questions: ExamQuestion[],
  answers: ExamAnswers,
  submitted = true,
): { tag: string; lost: number; count: number }[] {
  const order = new Map<string, number>()
  const aggregate = new Map<string, { lost: number; count: number }>()
  questions.forEach((question, index) => {
    const tag = question.knowledge?.[0] || '综合'
    if (!order.has(tag)) order.set(tag, index)
    const { score } = scoreQuestion(question, answerItem(answers, question.slot), submitted)
    const lost = EXAM_LIMITS.points - score
    const entry = aggregate.get(tag) || { lost: 0, count: 0 }
    entry.lost += lost
    entry.count += 1
    aggregate.set(tag, entry)
  })
  return [...aggregate.entries()]
    .filter(([, entry]) => entry.lost >= 5)
    .map(([tag, entry]) => ({ tag, lost: entry.lost, count: entry.count }))
    .sort((a, b) => b.lost - a.lost || b.count - a.count || (order.get(a.tag) ?? 0) - (order.get(b.tag) ?? 0))
    .slice(0, 5)
}

/** 交卷时的一次性结算（第 8.6 节）。 */
export function scoreExam(questions: ExamQuestion[], answers: ExamAnswers): ExamResult {
  const byType: Record<ExamType, { score: number; max: number; count: number }> = {
    single: { score: 0, max: 0, count: 0 },
    multiple: { score: 0, max: 0, count: 0 },
    essay: { score: 0, max: 0, count: 0 },
  }
  let total = 0
  let unanswered = 0
  let unscored = 0
  for (const question of questions) {
    const item = answerItem(answers, question.slot)
    const { score } = scoreQuestion(question, item, true)
    total += score
    byType[question.type].score += score
    byType[question.type].max += EXAM_LIMITS.points
    byType[question.type].count += 1
    if (question.type === 'essay') {
      if (typeof item.selfScore !== 'number') unscored += 1
    } else if (!Array.isArray(item.choice) || item.choice.length === 0) {
      unanswered += 1
    }
  }
  return {
    total,
    max: questions.length * EXAM_LIMITS.points,
    count: questions.length,
    byType,
    weak: weakPoints(questions, answers, true),
    unanswered,
    unscored,
    elapsedMs: Math.max(0, Math.round(answers?.elapsedMs || 0)),
  }
}

/** 交卷 / 导出前的清点：客观题未选、大题未自评。 */
export function pendingCounts(
  questions: ExamQuestion[],
  answers: ExamAnswers,
): { unanswered: number; unscored: number } {
  let unanswered = 0
  let unscored = 0
  for (const question of questions) {
    const item = answerItem(answers, question.slot)
    if (question.type === 'essay') {
      if (typeof item.selfScore !== 'number') unscored += 1
    } else if (!Array.isArray(item.choice) || item.choice.length === 0) {
      unanswered += 1
    }
  }
  return { unanswered, unscored }
}

/** 9.3「确认交卷？」的 message（四种情况一字不差）。 */
export function pendingSummary(
  questions: ExamQuestion[],
  answers: ExamAnswers,
): { unanswered: number; unscored: number; message: string } {
  const { unanswered, unscored } = pendingCounts(questions, answers)
  if (unanswered && unscored) {
    return { unanswered, unscored, message: `还有 ${unanswered} 题没作答、${unscored} 道大题没自评，提交后按 0 分计。` }
  }
  if (unanswered) return { unanswered, unscored, message: `还有 ${unanswered} 题没作答，提交后按 0 分计。` }
  if (unscored) return { unanswered, unscored, message: `还有 ${unscored} 道大题没自评，提交后按 0 分计。` }
  return { unanswered, unscored, message: '全部题目都已作答，交卷后会生成成绩。' }
}

/** 「用时」的口径：不到 1 分钟 / N 分钟 / H 小时 M 分钟。 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms || 0))
  if (total < 60_000) return '不到 1 分钟'
  const minutes = Math.floor(total / 60_000)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分钟`
}

/** 结果页按题型的一行：`单选题` / `多选题` / `大题（自评）`。 */
export function typeRowLabel(type: ExamType): string {
  return type === 'essay' ? `${TYPE_NAMES.essay}（自评）` : TYPE_NAMES[type]
}
