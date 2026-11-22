/**
 * 试卷存储：每个键一条串行链、索引的「读 → 改 → 写」整段在链里、单值 900 KiB 守卫。
 *
 * 存储后端只承诺 get / set / delete 三个设置键操作（没有建表、没有列出键），
 * 所以索引是唯一的清单来源；损坏时不能靠列键重建，只能提示并从空索引开始。
 */

import type {
  ExamAnswers, ExamIndex, ExamIndexEntry, ExamMeta, ExamQuestion, ExamResult, ExamSlot,
  ExamStatus, ExamStore, ExamType, LoadedExam,
} from './types.ts'
import { EXAM_KEYS, EXAM_LIMITS } from './types.ts'
import { validateStoredQuestion, cleanLine, cleanBody } from './validate.ts'

export type ExamStorage = {
  getSetting(key: string): Promise<string | null>
  setSetting(key: string, value: string): Promise<void>
  deleteSetting(key: string): Promise<void>
}

export type ExamStoreOptions = {
  reportFailure?: (id: string, label: string, error: unknown, retry: () => Promise<void>) => void
  now?: () => number
}

const encoder = new TextEncoder()
const utf8Bytes = (value: string): number => encoder.encode(value).length
const integer = (value: unknown, min: number, max: number, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
const time = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0)
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)
const TYPE_VALUES: ExamType[] = ['single', 'multiple', 'essay']
const STATUS_VALUES: ExamStatus[] = ['draft', 'taking', 'done']

export function emptyIndex(): ExamIndex {
  return { version: 1, updatedAt: 0, activeId: '', list: [] }
}

export function emptyAnswers(id: string): ExamAnswers {
  return {
    version: 1,
    examId: id,
    startedAt: 0,
    elapsedMs: 0,
    updatedAt: 0,
    items: {},
    submittedAt: 0,
    result: null,
    memory: { want: true, sentAt: 0, skipped: '' },
    finalizedAt: 0,
    exported: null,
  }
}

// ------------------------------------------------------------------ 归一化

function normalizeEntry(raw: unknown): ExamIndexEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const input = raw as Record<string, unknown>
  const id = cleanLine(input.id, 100)
  if (!id) return null
  const count = integer(input.count, 0, EXAM_LIMITS.questions)
  const status = STATUS_VALUES.includes(input.status as ExamStatus) ? input.status as ExamStatus : 'draft'
  const template = ['A', 'B', 'C', 'custom'].includes(String(input.template)) ? input.template as ExamIndexEntry['template'] : 'A'
  const docKind = ['pdf', 'markdown', 'word'].includes(String(input.docKind)) ? input.docKind as ExamIndexEntry['docKind'] : 'pdf'
  return {
    id,
    docId: cleanLine(input.docId, 100),
    title: cleanLine(input.title, 60),
    docKind,
    createdAt: time(input.createdAt),
    updatedAt: time(input.updatedAt),
    status,
    count,
    max: integer(input.max, 0, EXAM_LIMITS.questions * EXAM_LIMITS.points, count * EXAM_LIMITS.points),
    answered: integer(input.answered, 0, count),
    score: typeof input.score === 'number' && Number.isFinite(input.score) ? Math.round(input.score) : null,
    template,
    grounded: bool(input.grounded, true),
  }
}

export function normalizeExamIndex(raw: unknown): { index: ExamIndex; broken: boolean; newer: boolean } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { index: emptyIndex(), broken: true, newer: false }
  }
  const input = raw as Record<string, unknown>
  if (typeof input.version === 'number' && input.version > 1) {
    return { index: emptyIndex(), broken: false, newer: true }
  }
  const seen = new Set<string>()
  const list: ExamIndexEntry[] = []
  for (const item of Array.isArray(input.list) ? input.list : []) {
    const entry = normalizeEntry(item)
    if (!entry || seen.has(entry.id)) continue
    seen.add(entry.id)
    list.push(entry)
  }
  list.sort((a, b) => b.updatedAt - a.updatedAt)
  return {
    index: {
      version: 1,
      updatedAt: time(input.updatedAt),
      activeId: cleanLine(input.activeId, 100),
      list: list.slice(0, EXAM_LIMITS.exams),
    },
    broken: false,
    newer: false,
  }
}

function normalizeSlots(raw: unknown): ExamSlot[] | null {
  if (!Array.isArray(raw) || raw.length !== EXAM_LIMITS.questions) return null
  const slots: ExamSlot[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null
    const record = item as Record<string, unknown>
    const slot = integer(record.slot, 0, EXAM_LIMITS.questions - 1, -1)
    if (slot < 0) return null
    if (!TYPE_VALUES.includes(record.type as ExamType)) return null
    if (!['easy', 'medium', 'hard'].includes(String(record.difficulty))) return null
    slots.push({
      slot,
      type: record.type as ExamType,
      difficulty: record.difficulty as ExamSlot['difficulty'],
      topic: cleanLine(record.topic, EXAM_LIMITS.knowledgeChars),
      batch: integer(record.batch, 0, 3),
    })
  }
  slots.sort((a, b) => a.slot - b.slot)
  return slots.every((slot, index) => slot.slot === index) ? slots : null
}

function normalizeMetaBatches(raw: unknown): ExamMeta['batches'] {
  const input = Array.isArray(raw) ? raw : []
  return [0, 1, 2, 3].map(index => {
    const item = input.find(entry => entry && typeof entry === 'object' && (entry as Record<string, unknown>).index === index)
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const status = ['pending', 'running', 'ok', 'failed', 'stopped'].includes(String(record.status))
      ? record.status as ExamMeta['batches'][number]['status'] : 'pending'
    return {
      index,
      status,
      attempts: integer(record.attempts, 0, 99),
      error: cleanLine(record.error, 120),
      finishedAt: time(record.finishedAt),
    }
  })
}

export function normalizeExamMeta(raw: unknown, id: string): ExamMeta | null | 'newer' {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const input = raw as Record<string, unknown>
  if (typeof input.version === 'number' && input.version > 1) return 'newer'
  if (String(input.id ?? '') !== id) return null
  const slots = normalizeSlots(input.slots)
  if (!slots) return null

  const mixInput = input.mix && typeof input.mix === 'object' ? input.mix as Record<string, unknown> : {}
  const mix = {
    single: integer(mixInput.single, 0, EXAM_LIMITS.questions),
    multiple: integer(mixInput.multiple, 0, EXAM_LIMITS.questions),
    essay: integer(mixInput.essay, 0, EXAM_LIMITS.questions),
  }
  if (mix.single + mix.multiple + mix.essay !== EXAM_LIMITS.questions) {
    mix.single = slots.filter(slot => slot.type === 'single').length
    mix.multiple = slots.filter(slot => slot.type === 'multiple').length
    mix.essay = slots.filter(slot => slot.type === 'essay').length
  }

  const topics = (Array.isArray(input.topics) ? input.topics : [])
    .map(item => {
      const record = item && typeof item === 'object' ? item as Record<string, unknown> : {}
      const name = cleanLine(record.name, EXAM_LIMITS.knowledgeChars)
      const pages = (Array.isArray(record.pages) ? record.pages : [])
        .filter(page => typeof page === 'number' && Number.isInteger(page) && page >= 1)
        .slice(0, 3) as number[]
      return { name, pages }
    })
    .filter(topic => topic.name)
    .slice(0, EXAM_LIMITS.topicsMax)

  const modelInput = input.model && typeof input.model === 'object' ? input.model as Record<string, unknown> : {}
  const generationInput = input.generation && typeof input.generation === 'object' ? input.generation as Record<string, unknown> : {}
  return {
    version: 1,
    id,
    docId: cleanLine(input.docId, 100),
    docTitle: cleanLine(input.docTitle, 200),
    docKind: ['pdf', 'markdown', 'word'].includes(String(input.docKind)) ? input.docKind as ExamMeta['docKind'] : 'pdf',
    pages: integer(input.pages, 1, 100_000, 1),
    createdAt: time(input.createdAt),
    updatedAt: time(input.updatedAt),
    requirement: cleanLine(input.requirement, EXAM_LIMITS.requirement),
    subject: ['stem', 'humanities', 'mixed'].includes(String(input.subject)) ? input.subject as ExamMeta['subject'] : 'mixed',
    subjectReason: cleanLine(input.subjectReason, 60),
    template: ['A', 'B', 'C', 'custom'].includes(String(input.template)) ? input.template as ExamMeta['template'] : 'A',
    templateSource: ['auto', 'user', 'requirement'].includes(String(input.templateSource)) ? input.templateSource as ExamMeta['templateSource'] : 'auto',
    mix,
    topics,
    topicNote: cleanLine(input.topicNote, 60),
    planNote: cleanLine(input.planNote, 60),
    slots,
    batches: normalizeMetaBatches(input.batches),
    grounded: bool(input.grounded, true),
    degradedReason: cleanLine(input.degradedReason, 120),
    model: {
      presetId: cleanLine(modelInput.presetId, 100),
      presetName: cleanLine(modelInput.presetName, 60),
      provider: cleanLine(modelInput.provider, 40),
      model: cleanLine(modelInput.model, 80),
      effort: cleanLine(modelInput.effort, 20),
    },
    generation: {
      startedAt: time(generationInput.startedAt),
      finishedAt: time(generationInput.finishedAt),
      calls: integer(generationInput.calls, 0, 999),
      input: integer(generationInput.input, 0, 100_000_000),
      output: integer(generationInput.output, 0, 100_000_000),
      estimated: bool(generationInput.estimated, false),
    },
  }
}

function normalizeResult(raw: unknown): ExamResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const input = raw as Record<string, unknown>
  const byTypeInput = input.byType && typeof input.byType === 'object' ? input.byType as Record<string, unknown> : {}
  const byType = { single: { score: 0, max: 0, count: 0 }, multiple: { score: 0, max: 0, count: 0 }, essay: { score: 0, max: 0, count: 0 } }
  for (const type of TYPE_VALUES) {
    const part = byTypeInput[type] && typeof byTypeInput[type] === 'object' ? byTypeInput[type] as Record<string, unknown> : {}
    byType[type] = {
      score: integer(part.score, 0, 100_000),
      max: integer(part.max, 0, 100_000),
      count: integer(part.count, 0, EXAM_LIMITS.questions),
    }
  }
  return {
    total: integer(input.total, 0, 100_000),
    max: integer(input.max, 0, 100_000),
    count: integer(input.count, 0, EXAM_LIMITS.questions),
    byType,
    weak: (Array.isArray(input.weak) ? input.weak : [])
      .map(item => {
        const record = item && typeof item === 'object' ? item as Record<string, unknown> : {}
        return { tag: cleanLine(record.tag, EXAM_LIMITS.knowledgeChars), lost: integer(record.lost, 0, 100_000), count: integer(record.count, 0, EXAM_LIMITS.questions) }
      })
      .filter(item => item.tag)
      .slice(0, 5),
    unanswered: integer(input.unanswered, 0, EXAM_LIMITS.questions),
    unscored: integer(input.unscored, 0, EXAM_LIMITS.questions),
    elapsedMs: integer(input.elapsedMs, 0, 100_000_000),
  }
}

export function normalizeExamAnswers(raw: unknown, id: string): { answers: ExamAnswers; broken: boolean; newer: boolean } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { answers: emptyAnswers(id), broken: true, newer: false }
  }
  const input = raw as Record<string, unknown>
  if (typeof input.version === 'number' && input.version > 1) {
    return { answers: emptyAnswers(id), broken: false, newer: true }
  }
  if (String(input.examId ?? '') !== id) {
    return { answers: emptyAnswers(id), broken: true, newer: false }
  }

  const items: ExamAnswers['items'] = {}
  const rawItems = input.items && typeof input.items === 'object' ? input.items as Record<string, unknown> : {}
  for (const key of Object.keys(rawItems)) {
    if (!/^(?:[0-9]|1[0-9])$/.test(key)) continue
    const record = rawItems[key] && typeof rawItems[key] === 'object' ? rawItems[key] as Record<string, unknown> : {}
    const choice = [...new Set((Array.isArray(record.choice) ? record.choice : [])
      .map(item => String(item ?? '').trim().toUpperCase())
      .filter(item => /^[A-D]$/.test(item)))].sort()
    const self = record.selfScore
    items[key] = {
      choice,
      revealed: bool(record.revealed, false),
      revealedAt: time(record.revealedAt),
      selfScore: typeof self === 'number' && Number.isInteger(self) && self >= 0 && self <= EXAM_LIMITS.points ? self : null,
      ...(typeof record.text === 'string' && record.text ? { text: cleanBody(record.text, EXAM_LIMITS.essayText) } : {}),
    }
  }

  const memoryInput = input.memory && typeof input.memory === 'object' ? input.memory as Record<string, unknown> : {}
  const exportedInput = input.exported && typeof input.exported === 'object' ? input.exported as Record<string, unknown> : null
  return {
    answers: {
      version: 1,
      examId: id,
      startedAt: time(input.startedAt),
      elapsedMs: integer(input.elapsedMs, 0, 100_000_000),
      updatedAt: time(input.updatedAt),
      items,
      submittedAt: time(input.submittedAt),
      result: normalizeResult(input.result),
      memory: {
        want: bool(memoryInput.want, true),
        sentAt: time(memoryInput.sentAt),
        skipped: (['', 'unchecked', 'doc-removed'].includes(String(memoryInput.skipped)) ? memoryInput.skipped : '') as ExamAnswers['memory']['skipped'],
      },
      finalizedAt: time(input.finalizedAt),
      exported: exportedInput
        ? { name: cleanLine(exportedInput.name, 200), docId: cleanLine(exportedInput.docId, 100), at: time(exportedInput.at) }
        : null,
    },
    broken: false,
    newer: false,
  }
}

/** 读回存储里的单题（结构检查与 7.4 的同一套规则，但不重新校验证据）。 */
export function normalizeExamQuestion(raw: unknown, examId: string, slot: number): ExamQuestion | null {
  return validateStoredQuestion(raw, examId, slot)
}

// ------------------------------------------------------------------ 存储

export function createExamStore(storage: ExamStorage, options: ExamStoreOptions = {}): ExamStore {
  const now = options.now || Date.now
  const chains = new Map<string, Promise<unknown>>()
  let frozen = false

  function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = chains.get(key) || Promise.resolve()
    const next = previous.catch(() => {}).then(async () => {
      if (frozen) return undefined as T
      return task()
    })
    chains.set(key, next)
    void next.finally(() => { if (chains.get(key) === next) chains.delete(key) }).catch(() => {})
    return next
  }

  function guard(value: string): void {
    if (utf8Bytes(value) > EXAM_LIMITS.settingBytes) throw new Error('模拟测试的数据超过本机保存上限。')
  }

  async function writeRaw(key: string, value: string, failureId: string): Promise<void> {
    guard(value)
    try {
      await storage.setSetting(key, value)
    } catch (error) {
      options.reportFailure?.(failureId, '模拟测试', error, () => storage.setSetting(key, value))
      throw error
    }
  }

  function writeJson(key: string, value: unknown, failureId: string): Promise<void> {
    return writeRaw(key, JSON.stringify(value), failureId)
  }

  async function readIndex(): Promise<{ index: ExamIndex; broken: boolean; newer: boolean }> {
    let raw: string | null
    try {
      raw = await storage.getSetting(EXAM_KEYS.index)
    } catch {
      return { index: emptyIndex(), broken: false, newer: false }
    }
    if (raw == null) return { index: emptyIndex(), broken: false, newer: false }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      await saveBrokenIndex(raw)
      return { index: emptyIndex(), broken: true, newer: false }
    }
    const result = normalizeExamIndex(parsed)
    if (result.broken) await saveBrokenIndex(raw)
    return result
  }

  async function saveBrokenIndex(raw: string): Promise<void> {
    const value = raw.slice(0, EXAM_LIMITS.settingBytes)
    if (utf8Bytes(value) > EXAM_LIMITS.settingBytes) return
    try {
      await enqueue(EXAM_KEYS.brokenIndex, () => storage.setSetting(EXAM_KEYS.brokenIndex, value))
    } catch { /* 另存损坏原文只是兜底，失败不影响主流程 */ }
  }

  async function mutateIndex<T>(
    mutate: (index: ExamIndex) => ExamIndex | Promise<ExamIndex>,
    after?: (index: ExamIndex) => T | Promise<T>,
  ): Promise<T> {
    return enqueue(EXAM_KEYS.index, async () => {
      const { index } = await readIndex()
      const next = await mutate(index)
      const stamped: ExamIndex = { ...next, version: 1, updatedAt: now() }
      if (stamped.list.length > EXAM_LIMITS.exams) stamped.list = stamped.list.slice(0, EXAM_LIMITS.exams)
      await writeJson(EXAM_KEYS.index, stamped, 'exam:index')
      return after ? after(stamped) : (undefined as T)
    })
  }

  async function deleteExamKeys(id: string): Promise<void> {
    const keys = [EXAM_KEYS.meta(id), EXAM_KEYS.answers(id)]
    for (let slot = 0; slot < EXAM_LIMITS.questions; slot++) keys.push(EXAM_KEYS.question(id, slot))
    for (const key of keys) {
      await enqueue(key, async () => { await storage.deleteSetting(key) }).catch(() => {})
    }
  }

  async function loadExam(id: string): Promise<LoadedExam> {
    const meta = await store.loadMeta(id)
    const answers = await store.loadAnswers(id)
    if (meta === 'newer') {
      return { id, meta: null, newer: true, answers: answers.answers, answersBroken: answers.broken, questions: [], missingSlots: [] }
    }
    const questions: ExamQuestion[] = []
    const missingSlots: number[] = []
    if (!meta) {
      return { id, meta: null, newer: false, answers: answers.answers, answersBroken: answers.broken, questions, missingSlots }
    }
    const okBatches = new Set(meta.batches.filter(batch => batch.status === 'ok').map(batch => batch.index))
    const slots = meta.slots
    for (let start = 0; start < slots.length; start += 4) {
      const group = slots.slice(start, start + 4)
      const loaded = await Promise.all(group.map(async slot => ({ slot, question: await store.loadQuestion(id, slot.slot) })))
      for (const item of loaded) {
        const expected = okBatches.has(item.slot.batch)
        if (item.question && expected) questions.push(item.question)
        else if (expected) missingSlots.push(item.slot.slot)
        else if (item.question) await store.deleteQuestion(id, item.slot.slot)
      }
    }
    questions.sort((a, b) => a.slot - b.slot)
    missingSlots.sort((a, b) => a - b)
    return { id, meta, newer: false, answers: answers.answers, answersBroken: answers.broken, questions, missingSlots }
  }

  async function evictForRoom(keepId: string, busyId = ''): Promise<string[]> {
    let victims: ExamIndexEntry[] = []
    await mutateIndex(index => {
      const candidates = index.list.filter(entry => entry.id !== keepId && entry.id !== busyId)
      const rank = (entry: ExamIndexEntry) => (entry.status === 'done' ? 0 : entry.status === 'draft' ? 1 : 2)
      candidates.sort((a, b) => rank(a) - rank(b) || a.updatedAt - b.updatedAt)
      victims = candidates.slice(0, Math.max(0, index.list.length - (EXAM_LIMITS.exams - 1)))
      const drop = new Set(victims.map(entry => entry.id))
      return { ...index, list: index.list.filter(entry => !drop.has(entry.id)) }
    })
    for (const entry of victims) await deleteExamKeys(entry.id)
    return victims.map(entry => entry.id)
  }

  const store: ExamStore = {
    loadIndex: readIndex,
    async saveIndex(index) {
      await enqueue(EXAM_KEYS.index, () => writeJson(EXAM_KEYS.index, { ...index, version: 1, updatedAt: now() }, 'exam:index'))
    },
    mutateIndex,
    async saveEntry(entry, activeId) {
      await mutateIndex(index => {
        const list = index.list.filter(item => item.id !== entry.id)
        list.push(entry)
        list.sort((a, b) => b.updatedAt - a.updatedAt)
        return { version: 1, updatedAt: now(), activeId: activeId ?? index.activeId, list: list.slice(0, EXAM_LIMITS.exams) }
      })
    },
    async loadMeta(id) {
      let raw: string | null
      try {
        raw = await storage.getSetting(EXAM_KEYS.meta(id))
      } catch {
        return null
      }
      if (raw == null) return null
      try {
        return normalizeExamMeta(JSON.parse(raw), id)
      } catch {
        return null
      }
    },
    async saveMeta(meta) {
      await enqueue(EXAM_KEYS.meta(meta.id), () => writeJson(EXAM_KEYS.meta(meta.id), meta, `exam:${meta.id}:meta`))
    },
    async deleteMeta(id) {
      await enqueue(EXAM_KEYS.meta(id), () => storage.deleteSetting(EXAM_KEYS.meta(id)))
    },
    async loadAnswers(id) {
      let raw: string | null
      try {
        raw = await storage.getSetting(EXAM_KEYS.answers(id))
      } catch {
        return { answers: emptyAnswers(id), broken: true, newer: false }
      }
      if (raw == null) return { answers: emptyAnswers(id), broken: false, newer: false }
      try {
        return normalizeExamAnswers(JSON.parse(raw), id)
      } catch {
        return { answers: emptyAnswers(id), broken: true, newer: false }
      }
    },
    async saveAnswers(answers) {
      await enqueue(EXAM_KEYS.answers(answers.examId), () => writeJson(EXAM_KEYS.answers(answers.examId), answers, `exam:${answers.examId}:a`))
    },
    async deleteAnswers(id) {
      await enqueue(EXAM_KEYS.answers(id), () => storage.deleteSetting(EXAM_KEYS.answers(id)))
    },
    async loadQuestion(examId, slot) {
      const key = EXAM_KEYS.question(examId, slot)
      let raw: string | null
      try {
        raw = await storage.getSetting(key)
      } catch {
        return null
      }
      if (raw == null) return null
      try {
        return normalizeExamQuestion(JSON.parse(raw), examId, slot)
      } catch {
        return null
      }
    },
    async saveQuestion(question) {
      const key = EXAM_KEYS.question(question.examId, question.slot)
      await enqueue(key, () => writeJson(key, question, `exam:${question.examId}:q.${question.slot}`))
    },
    async deleteQuestion(examId, slot) {
      const key = EXAM_KEYS.question(examId, slot)
      await enqueue(key, () => storage.deleteSetting(key))
    },
    loadExam,
    async evict(id) {
      await mutateIndex(index => ({ ...index, list: index.list.filter(entry => entry.id !== id) }))
      await deleteExamKeys(id)
    },
    evictForRoom,
    async saveBrokenIndex(raw) { await saveBrokenIndex(raw) },
    async flush() {
      while (chains.size) await Promise.allSettled([...chains.values()])
    },
    freeze() { frozen = true },
    unfreeze() { frozen = false },
    frozen() { return frozen },
  }
  return store
}
