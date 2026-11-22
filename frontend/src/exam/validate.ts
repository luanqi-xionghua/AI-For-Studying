/**
 * 模型输出的容错解析与逐题 / 整批校验。
 *
 * 纯函数、零外部依赖：不读设置、不碰存储、不调模型。所有错误都带「slot N：」前缀，
 * 既给页面看，也原样拼进重试提示（第 7.6 节）。
 */

import type {
  DocKind, ExamDifficulty, ExamMeta, ExamOption, ExamQuestion, ExamRubricItem, ExamSlot,
  ExamSubject, ExamType, ExamMix, PlanData,
} from './types.ts'
import { EXAM_LIMITS, TYPE_NAMES } from './types.ts'

export class ExamError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ExamError'
    this.code = code
  }
}

const TEXT = (value: unknown): string => (typeof value === 'string' ? value : '')

/** 去掉除 \t \n 以外的控制字符（V25），顺带统一换行。 */
export function cleanControl(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
}

/** 单行字段：控制字符去掉、空白折叠、截断。 */
export function cleanLine(value: unknown, max: number): string {
  return cleanControl(TEXT(value)).replace(/\s+/g, ' ').trim().slice(0, max)
}

/** 正文：保留换行，去首尾空白后截断。 */
export function cleanBody(value: unknown, max: number): string {
  return cleanControl(TEXT(value)).trim().slice(0, max)
}

export function textLength(value: string): number {
  return value.replace(/\s+/g, '').length
}

// ------------------------------------------------------------------ 解析

function sliceBalanced(source: string, start: number): string | null {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < source.length; i++) {
    const ch = source[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  return null
}

function lastCodeBlock(body: string): string | null {
  const pattern = /```(?:json)?\s*([\s\S]*?)```/gi
  let found: string | null = null
  let match: RegExpExecArray | null
  while ((match = pattern.exec(body))) found = match[1]
  return found
}

/**
 * 从「模型可能夹带旁白」的输出里取出 JSON 对象。
 * 先剥 `<think>` 与代码块，再从**最后一个以 rootKey 开头的对象**处配平切片；
 * 失败才退回首尾花括号；再失败去尾逗号重试。
 */
export function parseModelJson(input: string, rootKey: 'questions' | 'subject' | string): Record<string, unknown> {
  let body = cleanControl(String(input ?? '')).replace(/^\uFEFF/, '').trim()
  body = body.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  body = (lastCodeBlock(body) ?? body).trim()

  const marker = new RegExp(`\\{\\s*"${rootKey}"`, 'g')
  let at = -1
  let found: RegExpExecArray | null
  while ((found = marker.exec(body))) at = found.index
  let candidate = at >= 0 ? sliceBalanced(body, at) : null
  if (candidate == null) {
    const start = body.indexOf('{')
    const end = body.lastIndexOf('}')
    candidate = start >= 0 && end > start ? body.slice(start, end + 1) : null
  }
  if (candidate == null) throw new ExamError('format', '模型返回的不是有效的 JSON。')

  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch {
    try {
      parsed = JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1'))
    } catch {
      throw new ExamError('format', '模型返回的不是有效的 JSON。')
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !(rootKey in (parsed as Record<string, unknown>))) {
    throw new ExamError('format', `模型返回的 JSON 缺少「${rootKey}」。`)
  }
  return parsed as Record<string, unknown>
}

// ------------------------------------------------------------------ 规划

const SUBJECTS: ExamSubject[] = ['stem', 'humanities', 'mixed']

function validMixShape(value: unknown): value is ExamMix {
  if (!value || typeof value !== 'object') return false
  const mix = value as Record<string, unknown>
  const parts = [mix.single, mix.multiple, mix.essay]
  if (!parts.every(part => typeof part === 'number' && Number.isInteger(part) && part >= 0 && part <= EXAM_LIMITS.questions)) return false
  return (parts[0] as number) + (parts[1] as number) + (parts[2] as number) === EXAM_LIMITS.questions
}

const MIX_NOTE = '出题要求里的题量不合法，已按模板出题。'

/** 第 7.2 节：能修的修、不能修的丢；知识点为空时整次规划失败。 */
export function validatePlan(raw: unknown, pages: number): PlanData {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const subject = SUBJECTS.includes(input.subject as ExamSubject) ? input.subject as ExamSubject : 'mixed'
  const reason = cleanLine(input.reason, 60)

  const seen = new Set<string>()
  const topics: { name: string; pages: number[] }[] = []
  const rawTopics = Array.isArray(input.topics) ? input.topics : []
  for (const item of rawTopics) {
    if (topics.length >= EXAM_LIMITS.topicsMax) break
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const name = cleanLine((item as Record<string, unknown>).name, EXAM_LIMITS.knowledgeChars)
    if (!name) continue
    const key = name.toLowerCase().replace(/\s+/g, '')
    if (seen.has(key)) continue
    seen.add(key)
    const rawPages = Array.isArray((item as Record<string, unknown>).pages) ? (item as Record<string, unknown>).pages as unknown[] : []
    const list = [...new Set(rawPages
      .filter(page => typeof page === 'number' && Number.isInteger(page) && page >= 1 && page <= Math.max(1, pages)))]
      .slice(0, 3) as number[]
    topics.push({ name, pages: list })
  }
  if (!topics.length) throw new ExamError('no-topics', '没能从这本书里整理出知识点。')

  let note = cleanLine(input.note, 60)
  let mix: ExamMix | null = null
  if (input.mix !== null && input.mix !== undefined) {
    if (validMixShape(input.mix)) mix = { single: input.mix.single, multiple: input.mix.multiple, essay: input.mix.essay }
    else note = `${MIX_NOTE}${note ? ` ${note}` : ''}`.slice(0, 60)
  }
  return { subject, reason, topics, mix, note }
}

// ------------------------------------------------------------------ 题干指纹

/** 去 LaTeX 命令、空白、标点，转小写（V22 用）。 */
export function normalizeStem(stem: string): string {
  return cleanControl(stem)
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .toLowerCase()
}

export function fingerprintOf(stem: string): string {
  return normalizeStem(stem).slice(0, 400)
}

export function headOf(stem: string): string {
  return normalizeStem(stem).slice(0, 30)
}

// ------------------------------------------------------------------ 单题

export type StoredEvidence = { page: number; line: number; text: string }

export type ValidateContext = {
  examId: string
  docId: string
  kind: DocKind
  pages: number
  subject: ExamSubject
  evidence: Map<string, StoredEvidence>
  grounded: boolean
  primaryCounts: Record<string, number>
  topicCap: number
  fingerprints: string[]
  displayNo: Record<number, number>
  now: number
}

const KEYS = ['A', 'B', 'C', 'D'] as const

function optionLetter(value: unknown): string {
  const match = /^[（(\[]?\s*([A-Da-d])\s*[)）\].、,，:：]?/.exec(TEXT(value).trim())
  return match ? match[1].toUpperCase() : ''
}

function parseOptions(value: unknown): ExamOption[] | null {
  const list = Array.isArray(value) ? value : []
  if (list.length !== 4) return null
  const items = list.map(item => {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    return { letter: optionLetter(record.key), text: cleanLine(record.text, EXAM_LIMITS.option) }
  })
  if (items.some(item => !item.text)) return null
  const letters = items.map(item => item.letter)
  const complete = letters.every(letter => letter) && new Set(letters).size === 4 && letters.every(letter => (KEYS as readonly string[]).includes(letter))
  const ordered = complete
    ? [...items].sort((a, b) => KEYS.indexOf(a.letter as typeof KEYS[number]) - KEYS.indexOf(b.letter as typeof KEYS[number]))
    : items
  const options = ordered.map((item, index) => ({
    key: (complete ? item.letter : KEYS[index]) as ExamOption['key'],
    text: item.text,
  }))
  const texts = new Set(options.map(option => option.text.toLowerCase()))
  if (texts.size !== 4) return null
  return options
}

function parseAnswerKeys(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.map(TEXT).join('') : TEXT(value)
  const letters = raw.toUpperCase().match(/[A-D]/g) || []
  return [...new Set(letters)].sort()
}

function parseKnowledge(value: unknown): string[] {
  const list = Array.isArray(value) ? value : []
  const seen = new Set<string>()
  const knowledge: string[] = []
  for (const item of list) {
    if (knowledge.length >= EXAM_LIMITS.knowledge) break
    const name = cleanLine(item, EXAM_LIMITS.knowledgeChars)
    if (!name) continue
    const key = name.toLowerCase().replace(/\s+/g, '')
    if (seen.has(key)) continue
    seen.add(key)
    knowledge.push(name)
  }
  return knowledge
}

function fail(slot: number, message: string): never {
  throw new ExamError('invalid', `slot ${slot}：${message}`)
}

function validateRubric(value: unknown, slot: number): ExamRubricItem[] {
  const list = Array.isArray(value) ? value : []
  if (list.length < EXAM_LIMITS.rubricMin || list.length > EXAM_LIMITS.rubricMax) {
    fail(slot, '评分要点应为 3–5 条。')
  }
  const rubric: ExamRubricItem[] = []
  for (const item of list) {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const point = cleanLine(record.point, EXAM_LIMITS.rubricPoint)
    const score = record.score
    if (!point || typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 10) {
      fail(slot, '评分要点应为 3–5 条。')
    }
    rubric.push({ point, score: score as number })
  }
  const sum = rubric.reduce((total, item) => total + item.score, 0)
  if (sum !== EXAM_LIMITS.points) fail(slot, `评分要点合计 ${sum} 分，应正好 10 分。`)
  return rubric
}

function evidenceIds(value: unknown, known: Map<string, StoredEvidence>): string[] {
  const list = Array.isArray(value) ? value : []
  const ids: string[] = []
  for (const item of list) {
    const id = TEXT(item).trim()
    if (!/^S[0-9a-f]{6}-\d+$/.test(id) || !known.has(id) || ids.includes(id)) continue
    ids.push(id)
    if (ids.length >= EXAM_LIMITS.evidencePerQuestion) break
  }
  return ids
}

function validateSource(input: Record<string, unknown>, slot: ExamSlot, ctx: ValidateContext): ExamQuestion['source'] {
  const kind: 'pdf' | 'markdown' = ctx.kind === 'markdown' ? 'markdown' : 'pdf'
  if (!ctx.grounded) {
    return { docId: ctx.docId, kind, pages: [], lines: [], evidenceIds: [], quotes: [] }
  }
  const ids = evidenceIds(input.evidenceIds, ctx.evidence)
  if (!ids.length) fail(slot.slot, '来源 sourceId 不在本次读到的内容里。')
  const evidence = ids.map(id => ctx.evidence.get(id)).filter((item): item is StoredEvidence => Boolean(item))
  const pages = [...new Set(evidence.map(item => item.page).filter(page => page >= 1 && page <= Math.max(1, ctx.pages)))]
    .sort((a, b) => a - b).slice(0, EXAM_LIMITS.evidencePerQuestion)
  const lines = kind === 'markdown'
    ? [...new Set(evidence.map(item => item.line).filter(line => line >= 1))].sort((a, b) => a - b).slice(0, EXAM_LIMITS.evidencePerQuestion)
    : []
  const quotes = evidence.slice(0, EXAM_LIMITS.quotes).map((item, index) => ({
    id: ids[index], page: item.page, line: item.line, text: cleanLine(item.text, EXAM_LIMITS.quoteChars),
  }))
  return { docId: ctx.docId, kind, pages, lines, evidenceIds: ids, quotes }
}

/**
 * 第 7.4 节：能修的修、不能修的判失败（整批重试）。
 * V02 / V22 要看整批，放在 `validateBatch` 里。
 */
export function validateQuestion(raw: unknown, slot: ExamSlot, ctx: ValidateContext): ExamQuestion {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const s = slot.slot

  if (input.type !== slot.type) fail(s, `题型应为 ${TYPE_NAMES[slot.type]}。`)

  const stem = cleanBody(input.stem, EXAM_LIMITS.stem)
  if (textLength(stem) < 8) fail(s, '题干为空或过短。')

  let options: ExamOption[] = []
  let answer: string[] | string = ''
  let rubric: ExamRubricItem[] = []
  let explanation = ''
  let answerStyle: ExamQuestion['answerStyle'] = ''

  if (slot.type === 'essay') {
    answer = cleanBody(input.answer, EXAM_LIMITS.answer)
    if (textLength(answer) < 20) fail(s, '大题缺少参考答案。')
    rubric = validateRubric(input.rubric, s)
    explanation = cleanBody(input.explanation, EXAM_LIMITS.explanation)
    if (input.answerStyle === 'stem' || input.answerStyle === 'humanities') answerStyle = input.answerStyle
    else answerStyle = ctx.subject === 'humanities' ? 'humanities' : 'stem'
  } else {
    const parsed = parseOptions(input.options)
    if (!parsed) fail(s, '选项必须是 A–D 四个且互不相同。')
    options = parsed
    const keys = parseAnswerKeys(input.answer)
    if (slot.type === 'single') {
      if (keys.length !== 1) fail(s, '单选题必须恰好有 1 个正确选项。')
      answer = keys
    } else {
      if (keys.length < 2 || keys.length > 4) fail(s, '多选题的正确选项应为 2–3 个。')
      answer = keys
    }
    explanation = cleanBody(input.explanation, EXAM_LIMITS.explanation)
    if (textLength(explanation) < 10) fail(s, '缺少解析。')
  }

  let knowledge = parseKnowledge(input.knowledge)
  if (!knowledge.length) knowledge = slot.topic ? [slot.topic] : []
  if (!knowledge.length) knowledge = ['综合']
  const primary = knowledge[0]
  const used = ctx.primaryCounts[primary] || 0
  if (used >= ctx.topicCap) fail(s, `知识点「${primary}」已经出了 ${ctx.topicCap} 题，请换一个知识点。`)

  const source = validateSource({
    evidenceIds: (input.source && typeof input.source === 'object' ? (input.source as Record<string, unknown>).evidenceIds : []) ?? [],
  }, slot, ctx)

  return {
    version: 1,
    examId: ctx.examId,
    id: `q${String(s).padStart(2, '0')}`,
    slot: s,
    batch: slot.batch,
    type: slot.type,
    difficulty: slot.difficulty as ExamDifficulty,
    stem,
    options,
    answer,
    rubric,
    explanation,
    knowledge,
    answerStyle,
    source,
    grounded: ctx.grounded,
    createdAt: ctx.now,
  }
}

// ------------------------------------------------------------------ 整批

export type BatchValidation = { ok: true; questions: ExamQuestion[] } | { ok: false; errors: string[] }

/**
 * 第 7.5 节：先按 slot 归位（V01/V02），再逐题校验；V16 按整批累计，
 * V22 与本卷已通过的题干比对。**全批通过才落库**（提示词要求整批丢弃）。
 */
export function validateBatch(raw: unknown, batchSlots: ExamSlot[], ctx: ValidateContext): BatchValidation {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  if (!Array.isArray(input.questions)) return { ok: false, errors: ['模型返回的 JSON 缺少 questions。'] }

  const slots = [...batchSlots].sort((a, b) => a.slot - b.slot)
  const wanted = new Set(slots.map(slot => slot.slot))
  const assigned = new Map<number, Record<string, unknown>>()
  let received = 0

  const list = input.questions as unknown[]
  for (let index = 0; index < list.length; index++) {
    const item = list[index]
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    received++
    const rawSlot = typeof record.slot === 'number' && Number.isInteger(record.slot) ? record.slot : NaN
    let slot = wanted.has(rawSlot) && !assigned.has(rawSlot) ? rawSlot : NaN
    if (Number.isNaN(slot)) {
      const fallback = slots[index]?.slot
      slot = typeof fallback === 'number' && !assigned.has(fallback) ? fallback : NaN
    }
    if (Number.isNaN(slot)) continue
    assigned.set(slot, record)
  }

  if (received !== slots.length || assigned.size !== slots.length) {
    const expect = slots.map(slot => slot.slot).join('、')
    return { ok: false, errors: [`本批应恰好 ${slots.length} 道题，slot 为 ${expect}，实际收到 ${received}。`] }
  }

  const errors: string[] = []
  const questions: ExamQuestion[] = []
  const counts = { ...ctx.primaryCounts }
  const seen = ctx.fingerprints.map((fingerprint, index) => ({ fingerprint, head: fingerprint.slice(0, 30), no: index + 1 }))

  for (const slot of slots) {
    try {
      const question = validateQuestion(assigned.get(slot.slot), slot, { ...ctx, primaryCounts: counts })
      const fingerprint = fingerprintOf(question.stem)
      const head = headOf(question.stem)
      const duplicate = seen.find(item => item.fingerprint === fingerprint || item.head === head)
      if (duplicate) fail(slot.slot, `与第 ${duplicate.no} 题重复。`)
      counts[question.knowledge[0]] = (counts[question.knowledge[0]] || 0) + 1
      seen.push({ fingerprint, head, no: ctx.displayNo[slot.slot] ?? slot.slot + 1 })
      questions.push(question)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!errors.includes(message)) errors.push(message)
    }
  }

  if (errors.length) return { ok: false, errors: errors.slice(0, 6) }
  return { ok: true, questions }
}

// ------------------------------------------------------------------ 读回已存的题

/** 读回存储里的题：只做结构与范围检查，不重新校验证据（证据已随题保存）。 */
export function validateStoredQuestion(raw: unknown, examId: string, slot: number): ExamQuestion | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const input = raw as Record<string, unknown>
  if (input.version !== 1 || input.examId !== examId || input.slot !== slot) return null
  const type = input.type
  if (type !== 'single' && type !== 'multiple' && type !== 'essay') return null
  const difficulty = input.difficulty
  if (difficulty !== 'easy' && difficulty !== 'medium' && difficulty !== 'hard') return null

  const stem = cleanBody(input.stem, EXAM_LIMITS.stem)
  if (!stem) return null

  let options: ExamOption[] = []
  let answer: string[] | string = ''
  let rubric: ExamRubricItem[] = []
  if (type === 'essay') {
    answer = cleanBody(input.answer, EXAM_LIMITS.answer)
    if (!answer) return null
    rubric = (Array.isArray(input.rubric) ? input.rubric : [])
      .map(item => {
        const record = item && typeof item === 'object' ? item as Record<string, unknown> : {}
        return { point: cleanLine(record.point, EXAM_LIMITS.rubricPoint), score: Number(record.score) }
      })
      .filter(item => item.point && Number.isInteger(item.score) && item.score >= 0 && item.score <= 10)
  } else {
    const parsed = parseOptions(input.options)
    if (!parsed) return null
    options = parsed
    const keys = parseAnswerKeys(input.answer)
    if (!keys.length) return null
    answer = keys
  }

  const knowledge = parseKnowledge(input.knowledge)
  const source = input.source && typeof input.source === 'object' ? input.source as Record<string, unknown> : {}
  const numbers = (value: unknown) => (Array.isArray(value) ? value : [])
    .filter(item => typeof item === 'number' && Number.isInteger(item) && item >= 1)
    .slice(0, EXAM_LIMITS.evidencePerQuestion) as number[]
  const evidenceIds = (Array.isArray(source.evidenceIds) ? source.evidenceIds : [])
    .filter(item => typeof item === 'string' && /^S[0-9a-f]{6}-\d+$/.test(item))
    .slice(0, EXAM_LIMITS.evidencePerQuestion) as string[]
  const quotes = (Array.isArray(source.quotes) ? source.quotes : [])
    .map(item => {
      const record = item && typeof item === 'object' ? item as Record<string, unknown> : {}
      return {
        id: TEXT(record.id),
        page: Number(record.page) || 0,
        line: Number(record.line) || 0,
        text: cleanLine(record.text, EXAM_LIMITS.quoteChars),
      }
    })
    .filter(item => item.text)
    .slice(0, EXAM_LIMITS.quotes)

  return {
    version: 1,
    examId,
    id: `q${String(slot).padStart(2, '0')}`,
    slot,
    batch: Number.isInteger(input.batch) ? input.batch as number : 0,
    type,
    difficulty,
    stem,
    options,
    answer,
    rubric,
    explanation: cleanBody(input.explanation, EXAM_LIMITS.explanation),
    knowledge: knowledge.length ? knowledge : ['综合'],
    answerStyle: input.answerStyle === 'stem' || input.answerStyle === 'humanities' ? input.answerStyle : '',
    source: {
      docId: TEXT(source.docId),
      kind: source.kind === 'markdown' ? 'markdown' : 'pdf',
      pages: numbers(source.pages),
      lines: numbers(source.lines),
      evidenceIds,
      quotes,
    },
    grounded: input.grounded !== false,
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt as number : 0,
  }
}

/** 从已存的题里恢复知识点的「主知识点」计数（V16 跨批复用）。 */
export function primaryCountsOf(questions: ExamQuestion[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const question of questions) {
    const tag = question.knowledge[0]
    if (tag) counts[tag] = (counts[tag] || 0) + 1
  }
  return counts
}

/** 已存题里出现过的知识点（「已出满 3 题」提示用）。 */
export function saturatedTopics(meta: ExamMeta, questions: ExamQuestion[], cap: number): string[] {
  const counts = primaryCountsOf(questions)
  const names = new Set(meta.topics.map(topic => topic.name))
  return [...names].filter(name => (counts[name] || 0) >= cap)
}
