/** 记忆数据的归一化：任何输入都不抛异常，损坏时返回空结构或 null。 */
import {
  LIMITS, MEMORY_VERSION, PROFILE_LIST_FIELDS,
  type DocumentMemory, type GlobalMemory, type GlobalSource, type MemoryEvidence,
  type MemoryEvent, type MemoryIndex, type MemoryIndexEntry, type MemoryManual,
  type MemoryProfile, type MemorySettings, type MemoryStatus, type OnboardingAnswers,
  type ReadingSnapshot, type SelfLevel, type ProfileListField,
} from './types.ts'

type Dict = Record<string, unknown>
const isDict = (value: unknown): value is Dict => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isLevel = (value: unknown): value is SelfLevel => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 4
const count = (value: unknown, max = 1_000_000): number => {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0
  return Math.max(0, Math.min(max, number))
}
const randomId = (length = 12): string => Math.random().toString(36).slice(2, 2 + length) || 'id'

export function parseJsonSafe(raw: string | null): unknown {
  if (raw == null || raw === '') return undefined
  try { return JSON.parse(raw) } catch { return undefined }
}

export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim()
  return text.slice(0, Math.max(0, max))
}

export function cleanLine(value: unknown, max: number): string {
  return cleanText(value, max).replace(/\s+/g, ' ')
}

export function normalizeKey(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function cleanList(value: unknown, maxItems: number, maxChars: number): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string' ? value.split(/[\n，,；;、]/) : []
  const list: string[] = []
  const seen = new Set<string>()
  for (const item of source) {
    if (typeof item !== 'string') continue
    const text = cleanLine(item, maxChars)
    const key = normalizeKey(text)
    if (!text || seen.has(key)) continue
    seen.add(key)
    list.push(text)
    if (list.length >= maxItems) break
  }
  return list
}

export function cleanTime(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

export function clamp01(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

const emptyProfile = (): MemoryProfile => ({
  goals: [], level: '', interests: [], strengths: [], weaknesses: [], misconceptions: [], preferences: [],
})
const idleStatus = (): MemoryStatus => ({ state: 'idle', error: '', failedAt: 0, failures: 0, nextRetryAt: 0 })
const emptyManual = (): MemoryManual => ({ locked: {}, pinned: {}, suppressed: [] })
const emptyReading = (): ReadingSnapshot => ({
  page: 1, pageCount: 1, progress: 0, maxProgress: 0, sessions: 0,
  firstOpenedAt: 0, lastOpenedAt: 0, activeDays: 0, lastDay: '', questions: 0,
})
const FIELD_LIMITS: Record<string, number> = {
  goals: LIMITS.goals, interests: LIMITS.interests, strengths: LIMITS.strengths,
  weaknesses: LIMITS.weaknesses, misconceptions: LIMITS.misconceptions, preferences: LIMITS.preferences,
  questions: LIMITS.questions, themes: LIMITS.themes,
}

export function normalizeOnboarding(raw: unknown): OnboardingAnswers | null {
  if (!isDict(raw)) return null
  if (!isLevel(raw.docLevel) || !isLevel(raw.fieldLevel)) return null
  return {
    docLevel: raw.docLevel,
    fieldLevel: raw.fieldLevel,
    goal: cleanText(raw.goal, LIMITS.goal),
    preference: cleanText(raw.preference, LIMITS.preference),
    note: cleanText(raw.note, LIMITS.note),
    answeredAt: cleanTime(raw.answeredAt),
    source: raw.source === 'manual' ? 'manual' : 'import',
  }
}

export function normalizeProfile(raw: unknown): MemoryProfile {
  const source = isDict(raw) ? raw : {}
  return {
    goals: cleanList(source.goals, LIMITS.goals, LIMITS.item),
    level: cleanLine(source.level, LIMITS.level),
    interests: cleanList(source.interests, LIMITS.interests, LIMITS.item),
    strengths: cleanList(source.strengths, LIMITS.strengths, LIMITS.item),
    weaknesses: cleanList(source.weaknesses, LIMITS.weaknesses, LIMITS.item),
    misconceptions: cleanList(source.misconceptions, LIMITS.misconceptions, LIMITS.item),
    preferences: cleanList(source.preferences, LIMITS.preferences, LIMITS.item),
  }
}

const EVIDENCE_KINDS = ['onboarding', 'assistant', 'chat', 'reading', 'manual'] as const
export function normalizeEvidence(raw: unknown): MemoryEvidence[] {
  if (!Array.isArray(raw)) return []
  const list: MemoryEvidence[] = []
  for (const item of raw) {
    if (!isDict(item)) continue
    const kind = EVIDENCE_KINDS.find(value => value === item.kind)
    if (!kind) continue
    const text = cleanText(item.text, LIMITS.evidenceText)
    if (!text) continue
    const evidence: MemoryEvidence = {
      id: cleanLine(item.id, 24) || randomId(),
      kind,
      at: cleanTime(item.at),
      text,
    }
    const ref = cleanText(item.ref, LIMITS.evidenceRef)
    if (ref) evidence.ref = ref
    list.push(evidence)
  }
  return list.slice(-LIMITS.evidence)
}

export function normalizePending(raw: unknown): MemoryEvent[] {
  if (!Array.isArray(raw)) return []
  const list: MemoryEvent[] = []
  for (const item of raw) {
    if (!isDict(item)) continue
    const kind = item.kind === 'chat-turn' ? 'chat-turn' : item.kind === 'assistant-turn' ? 'assistant-turn' : undefined
    if (!kind) continue
    const question = cleanText(item.question, LIMITS.pendingQuestion)
    if (!question) continue
    const event: MemoryEvent = {
      id: cleanLine(item.id, 24) || randomId(),
      kind,
      at: cleanTime(item.at),
      question,
      answer: cleanText(item.answer, LIMITS.pendingAnswer),
    }
    const conversationId = cleanLine(item.conversationId, 64)
    if (conversationId) event.conversationId = conversationId
    const turnId = cleanLine(item.turnId, 64)
    if (turnId) event.turnId = turnId
    list.push(event)
  }
  return list.slice(-LIMITS.pending)
}

export function normalizeManual(raw: unknown): MemoryManual {
  if (!isDict(raw)) return emptyManual()
  const locked: MemoryManual['locked'] = {}
  if (isDict(raw.locked)) {
    for (const field of ['summary', 'level'] as const) {
      const value = raw.locked[field]
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) locked[field] = Math.floor(value)
    }
  }
  const pinned: Record<string, string[]> = {}
  if (isDict(raw.pinned)) {
    for (const [field, cap] of Object.entries(FIELD_LIMITS)) {
      const value = raw.pinned[field]
      if (!Array.isArray(value)) continue
      const list = cleanList(value, cap, LIMITS.item)
      if (list.length) pinned[field] = list
    }
  }
  const suppressed = isDict(raw.suppressed) || !Array.isArray(raw.suppressed)
    ? []
    : (raw.suppressed as unknown[])
        .filter((item): item is string => typeof item === 'string')
        .map(item => normalizeKey(item))
        .filter(Boolean)
        .slice(-LIMITS.suppressed)
  return { locked, pinned, suppressed }
}

export function normalizeStatus(raw: unknown): MemoryStatus {
  if (!isDict(raw)) return idleStatus()
  return {
    state: raw.state === 'failed' ? 'failed' : 'idle',
    error: cleanText(raw.error, 200),
    failedAt: cleanTime(raw.failedAt),
    failures: count(raw.failures),
    nextRetryAt: cleanTime(raw.nextRetryAt),
  }
}

export function normalizeReading(raw: unknown): ReadingSnapshot {
  if (!isDict(raw)) return emptyReading()
  const progress = clamp01(raw.progress)
  return {
    page: Math.max(1, count(raw.page)),
    pageCount: Math.max(1, count(raw.pageCount)),
    progress,
    maxProgress: Math.max(progress, clamp01(raw.maxProgress)),
    sessions: count(raw.sessions),
    firstOpenedAt: cleanTime(raw.firstOpenedAt),
    lastOpenedAt: cleanTime(raw.lastOpenedAt),
    activeDays: count(raw.activeDays),
    lastDay: cleanLine(raw.lastDay, 10),
    questions: count(raw.questions),
  }
}

function shrinkDocument(memory: DocumentMemory): DocumentMemory {
  if (utf8Bytes(JSON.stringify(memory)) <= LIMITS.docBytes) return memory
  let next: DocumentMemory = { ...memory, pending: memory.pending.map(item => ({ ...item, answer: '' })) }
  if (utf8Bytes(JSON.stringify(next)) <= LIMITS.docBytes) return next
  next = { ...next, evidence: next.evidence.slice(-10) }
  if (utf8Bytes(JSON.stringify(next)) <= LIMITS.docBytes) return next
  next = { ...next, pending: next.pending.slice(-8) }
  return next
}

export function normalizeDocumentMemory(raw: unknown, docId: string): DocumentMemory | null {
  if (!isDict(raw)) return null
  if (typeof raw.version === 'number' && raw.version > MEMORY_VERSION) return null
  if (typeof raw.docId === 'string' && raw.docId && raw.docId !== docId) return null
  const updatedAt = cleanTime(raw.updatedAt)
  const memory: DocumentMemory = {
    version: MEMORY_VERSION,
    docId,
    title: cleanText(raw.title, LIMITS.title),
    createdAt: cleanTime(raw.createdAt) || updatedAt || 0,
    updatedAt,
    summarizedAt: cleanTime(raw.summarizedAt),
    onboarding: normalizeOnboarding(raw.onboarding),
    summary: cleanText(raw.summary, LIMITS.summary),
    profile: normalizeProfile(raw.profile),
    questions: cleanList(raw.questions, LIMITS.questions, LIMITS.questionItem),
    reading: normalizeReading(raw.reading),
    evidence: normalizeEvidence(raw.evidence),
    pending: normalizePending(raw.pending),
    dirty: raw.dirty === true,
    dirtyAt: cleanTime(raw.dirtyAt),
    manual: normalizeManual(raw.manual),
    status: normalizeStatus(raw.status),
    revision: count(raw.revision),
  }
  return shrinkDocument(memory)
}

function shrinkGlobal(memory: GlobalMemory): GlobalMemory {
  if (utf8Bytes(JSON.stringify(memory)) <= LIMITS.globalBytes) return memory
  let next: GlobalMemory = { ...memory, pending: memory.pending.map(item => ({ ...item, answer: '' })) }
  if (utf8Bytes(JSON.stringify(next)) <= LIMITS.globalBytes) return next
  next = { ...next, evidence: next.evidence.slice(-10) }
  if (utf8Bytes(JSON.stringify(next)) <= LIMITS.globalBytes) return next
  next = { ...next, pending: next.pending.slice(-8) }
  return next
}

export function normalizeGlobalMemory(raw: unknown): GlobalMemory {
  if (!isDict(raw) || (typeof raw.version === 'number' && raw.version > MEMORY_VERSION)) return emptyGlobalMemory(0)
  const profile = normalizeProfile(raw.profile)
  profile.misconceptions = []
  const sources: GlobalSource[] = []
  if (Array.isArray(raw.sources)) {
    for (const item of raw.sources) {
      if (!isDict(item)) continue
      const sourceId = cleanLine(item.docId, 64)
      if (!sourceId) continue
      sources.push({
        docId: sourceId,
        title: cleanText(item.title, LIMITS.indexTitle),
        summarizedAt: cleanTime(item.summarizedAt),
        note: cleanText(item.note, LIMITS.sourceNote),
      })
      if (sources.length >= LIMITS.sources) break
    }
  }
  const removed = Array.isArray(raw.removed)
    ? (raw.removed as unknown[]).filter((item): item is string => typeof item === 'string')
        .map(item => cleanLine(item, LIMITS.indexTitle)).filter(Boolean).slice(-LIMITS.removed)
    : []
  const global: GlobalMemory = {
    version: MEMORY_VERSION,
    createdAt: cleanTime(raw.createdAt),
    updatedAt: cleanTime(raw.updatedAt),
    summarizedAt: cleanTime(raw.summarizedAt),
    summary: cleanText(raw.summary, LIMITS.globalSummary),
    profile,
    themes: cleanList(raw.themes, LIMITS.themes, LIMITS.themeItem),
    sources,
    removed,
    pending: normalizePending(raw.pending),
    evidence: normalizeEvidence(raw.evidence),
    manual: normalizeManual(raw.manual),
    status: normalizeStatus(raw.status),
    revision: count(raw.revision),
  }
  return shrinkGlobal(global)
}

export function normalizeMemoryIndex(raw: unknown): MemoryIndex | null {
  if (!isDict(raw)) return null
  const byId = new Map<string, MemoryIndexEntry>()
  if (Array.isArray(raw.docs)) {
    for (const item of raw.docs) {
      if (!isDict(item)) continue
      const docId = cleanLine(item.docId, 64)
      if (!docId) continue
      const entry: MemoryIndexEntry = {
        docId,
        title: cleanText(item.title, LIMITS.indexTitle),
        updatedAt: cleanTime(item.updatedAt),
        summarizedAt: cleanTime(item.summarizedAt),
        pending: count(item.pending),
        dirty: item.dirty === true,
        hasOnboarding: item.hasOnboarding === true,
        failed: item.failed === true,
      }
      const existing = byId.get(docId)
      if (!existing || entry.updatedAt >= existing.updatedAt) byId.set(docId, entry)
    }
  }
  let docs = [...byId.values()]
  if (docs.length > LIMITS.indexDocs) docs = docs.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, LIMITS.indexDocs)
  let lastRun: MemoryIndex['lastRun'] = null
  if (isDict(raw.lastRun)) {
    lastRun = {
      at: cleanTime(raw.lastRun.at),
      kind: raw.lastRun.kind === 'global' ? 'global' : 'doc',
      docId: cleanLine(raw.lastRun.docId, 64),
      title: cleanText(raw.lastRun.title, LIMITS.indexTitle),
      ok: raw.lastRun.ok === true,
      error: cleanText(raw.lastRun.error, 200),
    }
  }
  const index: MemoryIndex = {
    version: MEMORY_VERSION,
    updatedAt: cleanTime(raw.updatedAt),
    docs,
    globalStale: raw.globalStale === true,
    docUpdatesSinceGlobal: count(raw.docUpdatesSinceGlobal),
    lastRun,
  }
  if (utf8Bytes(JSON.stringify(index)) > LIMITS.indexBytes) {
    index.docs = index.docs.map(entry => ({ ...entry, title: entry.title.slice(0, 20) }))
  }
  return index
}

export function normalizeMemorySettings(raw: unknown): MemorySettings {
  const source = isDict(raw) ? raw : {}
  const budget = isDict(source.budget) ? source.budget : {}
  return {
    version: MEMORY_VERSION,
    autoUpdate: source.autoUpdate !== false,
    noticeShown: source.noticeShown === true,
    budget: { day: cleanLine(budget.day, 10), runs: Math.min(100000, count(budget.runs)) },
    pausedUntil: cleanTime(source.pausedUntil),
    consecutiveFailures: count(source.consecutiveFailures),
    updatedAt: cleanTime(source.updatedAt),
  }
}

export function emptyDocumentMemory(docId: string, title: string, now: number): DocumentMemory {
  return {
    version: MEMORY_VERSION,
    docId,
    title: cleanText(title, LIMITS.title),
    createdAt: now,
    updatedAt: now,
    summarizedAt: 0,
    onboarding: null,
    summary: '',
    profile: emptyProfile(),
    questions: [],
    reading: emptyReading(),
    evidence: [],
    pending: [],
    dirty: false,
    dirtyAt: 0,
    manual: emptyManual(),
    status: idleStatus(),
    revision: 0,
  }
}

export function emptyGlobalMemory(now: number): GlobalMemory {
  return {
    version: MEMORY_VERSION,
    createdAt: now,
    updatedAt: now,
    summarizedAt: 0,
    summary: '',
    profile: emptyProfile(),
    themes: [],
    sources: [],
    removed: [],
    pending: [],
    evidence: [],
    manual: emptyManual(),
    status: idleStatus(),
    revision: 0,
  }
}
