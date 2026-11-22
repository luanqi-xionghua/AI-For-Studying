/**
 * 配比、难度与槽位：全部是确定性算法，不读设置、不调模型。
 *
 * 槽位顺序（slot 0–19）就是题号顺序：先按题型排（单选 → 多选 → 大题），
 * 再按 `slot % 4` 分到 4 批，所以每批都混合三种题型，一批失败不会丢掉整类题型。
 */

import type { ExamDifficulty, ExamMix, ExamSlot, ExamSubject, ExamTemplate } from './types.ts'
import { DIFFICULTY_LABELS, EXAM_LIMITS, TEMPLATES } from './types.ts'

export type ResolvedMix = { template: ExamTemplate; templateSource: 'auto' | 'user' | 'requirement'; mix: ExamMix }

const DIFFICULTY_CYCLE: ExamDifficulty[] = ['medium', 'easy', 'medium', 'hard']

export function validMix(mix: unknown): mix is ExamMix {
  if (!mix || typeof mix !== 'object') return false
  const value = mix as Record<string, unknown>
  const counts = [value.single, value.multiple, value.essay]
  if (!counts.every(count => typeof count === 'number' && Number.isInteger(count) && count >= 0 && count <= EXAM_LIMITS.questions)) return false
  return (counts[0] as number) + (counts[1] as number) + (counts[2] as number) === EXAM_LIMITS.questions
}

export function templateForSubject(subject: ExamSubject): 'A' | 'B' | 'C' {
  if (subject === 'stem') return 'A'
  if (subject === 'humanities') return 'B'
  return 'C'
}

/**
 * 优先级：出题要求里写明的题量 > 用户在准备区点选的 A/B/C > 规划判定的学科。
 */
export function resolveMix(
  setup: 'auto' | 'A' | 'B' | 'C',
  plan: { subject: ExamSubject; mix: ExamMix | null } | null,
): ResolvedMix {
  if (plan && validMix(plan.mix)) {
    return { template: 'custom', templateSource: 'requirement', mix: { ...plan.mix } }
  }
  if (setup !== 'auto') {
    return { template: setup, templateSource: 'user', mix: { ...TEMPLATES[setup].mix } }
  }
  const template = templateForSubject(plan?.subject ?? 'mixed')
  return { template, templateSource: 'auto', mix: { ...TEMPLATES[template].mix } }
}

/** 知识点不足 7 个时，单个知识点允许出的题数。 */
export function topicCap(topicCount: number): number {
  const count = Math.max(1, Math.floor(topicCount) || 1)
  return count >= EXAM_LIMITS.topicsMin ? EXAM_LIMITS.perTopic : Math.ceil(EXAM_LIMITS.questions / count)
}

function normalizeMix(mix: ExamMix): ExamMix {
  return validMix(mix) ? mix : { ...TEMPLATES.C.mix }
}

/**
 * 生成 20 个槽位。
 * 难度用 `(i + floor(i / 4)) % 4` 走 D 表，任何配比下都是 易 5 / 中 10 / 难 5。
 * 知识点按「批 → 槽位」顺序编号 k，取 `topics[k % n]`：同一批覆盖相邻的几个知识点，检索范围集中。
 */
export function buildSlots(mix: ExamMix, topics: string[]): { slots: ExamSlot[]; topicNote: string } {
  const safe = normalizeMix(mix)
  const types: ExamSlot['type'][] = []
  for (let i = 0; i < safe.single; i++) types.push('single')
  for (let i = 0; i < safe.multiple; i++) types.push('multiple')
  for (let i = 0; i < safe.essay; i++) types.push('essay')

  const names = topics.map(name => String(name ?? '').trim()).filter(Boolean)
  const ordered = types.map((_, i) => i).sort((a, b) => (a % 4) - (b % 4) || a - b)
  const topicOf = new Map<number, string>()
  if (names.length) ordered.forEach((slot, k) => topicOf.set(slot, names[k % names.length]))

  const slots: ExamSlot[] = types.map((type, slot) => ({
    slot,
    type,
    difficulty: DIFFICULTY_CYCLE[(slot + Math.floor(slot / 4)) % 4],
    topic: topicOf.get(slot) ?? '',
    batch: slot % 4,
  }))

  const n = names.length
  const topicNote = n > 0 && n < EXAM_LIMITS.topicsMin
    ? `这本书可出题的知识点较少（${n} 个），部分知识点会出到 ${topicCap(n)} 题。`
    : ''
  return { slots, topicNote }
}

/** 只给已生成的槽位按槽位序号连续编号；某批失败时后面的题号前移。 */
export function displayNumbers(slots: ExamSlot[], present: Iterable<number>): Record<number, number> {
  const set = new Set([...present])
  const numbers: Record<number, number> = {}
  let next = 1
  for (const slot of [...slots].sort((a, b) => a.slot - b.slot)) {
    if (set.has(slot.slot)) numbers[slot.slot] = next++
  }
  return numbers
}

/** 配比预览：`单选 10 · 多选 4 · 大题 6 · 难度 易 5 / 中 10 / 难 5`。 */
export function mixPreview(input: ExamTemplate | ExamMix | null): string {
  let mix: ExamMix | null = null
  if (input === 'A' || input === 'B' || input === 'C') mix = TEMPLATES[input].mix
  else if (input && typeof input === 'object') mix = input
  if (!mix) return ''
  const difficulty = `难度 ${DIFFICULTY_LABELS.easy} 5 / ${DIFFICULTY_LABELS.medium} 10 / ${DIFFICULTY_LABELS.hard} 5`
  return `单选 ${mix.single} · 多选 ${mix.multiple} · 大题 ${mix.essay} · ${difficulty}`
}
