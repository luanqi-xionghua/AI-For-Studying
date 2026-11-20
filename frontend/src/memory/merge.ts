/** 记忆合并规则：事件并入、总结合并、手动编辑。全部是纯函数，输入旧记忆，返回新记忆（不改入参）。 */
import {
  LIMITS, PROFILE_LIST_FIELDS,
  type DocumentMemory, type GlobalMemory, type GlobalSource, type MemoryEvidence,
  type MemoryEvent, type MemoryIndexEntry, type MemoryManual, type MemoryProfile,
  type OnboardingAnswers, type ProfileListField,
} from './types.ts'
import { cleanLine, cleanList, cleanText, cleanTime, emptyDocumentMemory, normalizeKey, normalizeOnboarding } from './normalize.ts'
import { DOC_LEVEL_LABELS, FIELD_LEVEL_LABELS, onboardingSummary } from './prompts.ts'
import { nextRetryAt, type DocMeta } from './scheduler.ts'
import type { LearningEvent } from './events.ts'

const randomId = (): string => Math.random().toString(36).slice(2, 14) || 'id'
const FIELD_LABELS: Record<string, string> = {
  summary: '综述', level: '水平', goals: '目标', interests: '兴趣', strengths: '强项',
  weaknesses: '薄弱点', misconceptions: '易错点', preferences: '偏好', questions: '最近问题主题', themes: '跨书主题', onboarding: '导入自评',
}
const ARRAY_FIELDS = [...PROFILE_LIST_FIELDS, 'questions', 'themes'] as const
type ArrayField = typeof ARRAY_FIELDS[number]
const fieldCap = (field: string): number => {
  if (field === 'questions') return LIMITS.questions
  if (field === 'themes') return LIMITS.themes
  return (LIMITS as unknown as Record<string, number>)[field] ?? LIMITS.item
}
const fieldItemCap = (field: string): number => field === 'themes' ? LIMITS.themeItem : field === 'questions' ? LIMITS.questionItem : LIMITS.item

const dayOf = (at: number): string => {
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function bumpActiveDay(memory: { reading: DocumentMemory['reading'] }, at: number) {
  const day = dayOf(at)
  if (!day || day === memory.reading.lastDay) return { ...memory.reading }
  return { ...memory.reading, activeDays: memory.reading.activeDays + 1, lastDay: day }
}

const pushCapped = <T,>(list: T[], item: T, cap: number): T[] => [...list, item].slice(-cap)

function evidenceFor(event: { at: number; question: string }, kind: MemoryEvidence['kind'], ref: string): MemoryEvidence {
  return { id: randomId(), kind, at: cleanTime(event.at), text: cleanText(event.question, LIMITS.evidenceText), ref }
}

/** 事件并入：问答进待总结队列 + 证据；阅读行为只更新快照。 */
export function applyEvent(
  memory: DocumentMemory,
  event: Extract<LearningEvent, { type: 'assistant-turn' | 'chat-turn' | 'opened' | 'reading' }>,
  now: number,
): DocumentMemory {
  if (event.type === 'assistant-turn' || event.type === 'chat-turn') {
    const entry: MemoryEvent = {
      id: randomId(),
      kind: event.type,
      at: cleanTime(event.at) || now,
      question: cleanText(event.question, LIMITS.pendingQuestion),
      answer: cleanText(event.answer, LIMITS.pendingAnswer),
    }
    if ('conversationId' in event && event.conversationId) entry.conversationId = cleanLine(event.conversationId, 64)
    const reading = bumpActiveDay(memory, entry.at)
    return {
      ...memory,
      pending: pushCapped(memory.pending, entry, LIMITS.pending),
      evidence: pushCapped(memory.evidence, evidenceFor({ at: entry.at, question: entry.question }, event.type === 'chat-turn' ? 'chat' : 'assistant', event.type === 'chat-turn' ? '对话模式' : '阅读助手'), LIMITS.evidence),
      reading: { ...reading, questions: reading.questions + 1 },
      updatedAt: now,
      revision: memory.revision + 1,
    }
  }
  const at = cleanTime(event.at) || now
  if (event.type === 'opened') {
    return {
      ...memory,
      reading: {
        ...bumpActiveDay(memory, at),
        sessions: memory.reading.sessions + 1,
        firstOpenedAt: memory.reading.firstOpenedAt || at,
        lastOpenedAt: at,
      },
      updatedAt: now,
      revision: memory.revision + 1,
    }
  }
  // reading：更新页码、进度与历史最高进度；首次越过 25 / 50 / 75 / 100% 时留一条证据。
  const previous = memory.reading
  const progress = Math.min(1, Math.max(0, event.progress))
  const maxProgress = Math.max(previous.maxProgress, progress)
  let evidence = memory.evidence
  for (const percent of [25, 50, 75, 100]) {
    const mark = percent / 100
    if (previous.maxProgress < mark && maxProgress >= mark) {
      evidence = pushCapped(evidence, {
        id: randomId(), kind: 'reading', at, text: `读到全书的 ${percent}%`, ref: '阅读进度',
      }, LIMITS.evidence)
    }
  }
  return {
    ...memory,
    reading: {
      ...bumpActiveDay(memory, at),
      page: Math.max(1, cleanTime(event.page)),
      pageCount: Math.max(1, cleanTime(event.pageCount)),
      progress,
      maxProgress,
    },
    evidence,
    updatedAt: now,
    revision: memory.revision + 1,
  }
}

/** 全局范围的对话问答：进全局待总结队列 + 全局证据。 */
export function applyGlobalTurn(global: GlobalMemory, event: Extract<LearningEvent, { type: 'chat-turn' }>, now: number): GlobalMemory {
  const entry: MemoryEvent = {
    id: randomId(),
    kind: 'chat-turn',
    at: cleanTime(event.at) || now,
    question: cleanText(event.question, LIMITS.pendingQuestion),
    answer: cleanText(event.answer, LIMITS.pendingAnswer),
  }
  if (event.conversationId) entry.conversationId = cleanLine(event.conversationId, 64)
  return {
    ...global,
    pending: pushCapped(global.pending, entry, LIMITS.pending),
    evidence: pushCapped(global.evidence, evidenceFor({ at: entry.at, question: entry.question }, 'chat', '对话模式 · 全局记忆'), LIMITS.evidence),
    updatedAt: now,
    revision: global.revision + 1,
  }
}

/** 导入自评：新建记忆 / 只补自评 / 不覆盖已有自评（幂等）。 */
export function applyOnboarding(
  memory: DocumentMemory | null,
  event: Extract<LearningEvent, { type: 'onboarding' }>,
  now: number,
): { memory: DocumentMemory; changed: boolean } {
  const answers = normalizeOnboarding(event.answers)
  if (!answers) return { memory: memory ?? emptyDocumentMemory(event.docId, event.title, now), changed: false }
  const generated = onboardingSummary(answers)
  if (!memory) {
    const base = emptyDocumentMemory(event.docId, event.title, now)
    const evidence: MemoryEvidence = { id: 'ob-' + event.importId.slice(0, 8), kind: 'onboarding', at: now, text: generated.evidence, ref: '导入' }
    return {
      memory: {
        ...base,
        onboarding: answers,
        summary: generated.summary,
        profile: { ...base.profile, level: generated.level },
        evidence: [evidence],
        dirty: true,
        dirtyAt: now,
        revision: 1,
      },
      changed: true,
    }
  }
  const evidenceId = 'ob-' + event.importId.slice(0, 8)
  if (memory.evidence.some(item => item.id === evidenceId)) return { memory, changed: false }
  if (!memory.onboarding) {
    const evidence: MemoryEvidence = { id: evidenceId, kind: 'onboarding', at: now, text: generated.evidence, ref: '导入' }
    return {
      memory: {
        ...memory,
        onboarding: answers,
        evidence: pushCapped(memory.evidence, evidence, LIMITS.evidence),
        dirty: true,
        dirtyAt: now,
        updatedAt: now,
        revision: memory.revision + 1,
      },
      changed: true,
    }
  }
  // 已有自评：不覆盖，只补一条证据，让下一次总结能看到新的自评。
  const note = cleanText(answers.note, LIMITS.note)
  const goal = cleanText(answers.goal, LIMITS.goal)
  const preference = cleanText(answers.preference, LIMITS.preference)
  const text = cleanText(`再次导入时的自评（未替换原自评）：文档内容「${DOC_LEVEL_LABELS[answers.docLevel]}」，相关专业「${FIELD_LEVEL_LABELS[answers.fieldLevel]}」。${goal ? `学习目标：${goal}。` : ''}${preference ? `偏好：${preference}。` : ''}${note ? `补充：${note}` : ''}`, LIMITS.evidenceText)
  const evidence: MemoryEvidence = { id: evidenceId, kind: 'onboarding', at: now, text, ref: '再次导入' }
  return {
    memory: {
      ...memory,
      evidence: pushCapped(memory.evidence, evidence, LIMITS.evidence),
      dirty: true,
      dirtyAt: now,
      updatedAt: now,
      revision: memory.revision + 1,
    },
    changed: true,
  }
}

/** 置顶在前；incoming 里规范化后不与已有重复、也不在 suppressed 里的才加入；截到 max 条。 */
export function mergeList(pinned: string[], incoming: string[], suppressed: string[], max: number): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  const add = (item: string, allowSuppressed: boolean) => {
    const text = cleanLine(item, LIMITS.item)
    const key = normalizeKey(text)
    if (!text || seen.has(key)) return
    if (!allowSuppressed && suppressed.includes(key)) return
    seen.add(key)
    result.push(text)
  }
  for (const item of pinned) { if (result.length >= max) break; add(item, true) }
  for (const item of incoming) { if (result.length >= max) break; add(item, false) }
  return result
}

function mergeProfileArrays(
  latest: DocumentMemory | GlobalMemory,
  result: MemoryProfile,
): MemoryProfile {
  const profile = { ...latest.profile }
  for (const field of PROFILE_LIST_FIELDS) {
    const incoming = result[field] || []
    const old = latest.profile[field]
    profile[field] = incoming.length || !old.length
      ? mergeList(latest.manual.pinned[field] ?? [], incoming, latest.manual.suppressed, fieldCap(field))
      : old
  }
  return profile
}

function fallbackQuestions(latest: DocumentMemory, consumedIds: string[]): string[] {
  const consumed = latest.pending.filter(item => consumedIds.includes(item.id)).reverse()
  const topics = consumed.map(item => cleanLine(item.question, 24)).filter(Boolean)
  return mergeList(latest.manual.pinned.questions ?? [], [...topics, ...latest.questions], latest.manual.suppressed, LIMITS.questions)
}

export function mergeDocumentSummary(
  latest: DocumentMemory,
  result: { summary: string; profile: MemoryProfile; questions: string[] },
  options: { consumedIds: string[]; now: number },
): DocumentMemory {
  const { consumedIds, now } = options
  const locked = latest.manual.locked
  const profile = mergeProfileArrays(latest, result.profile)
  const level = locked.level ? latest.profile.level : (result.profile.level || latest.profile.level)
  const questions = result.questions.length
    ? mergeList(latest.manual.pinned.questions ?? [], result.questions, latest.manual.suppressed, LIMITS.questions)
    : fallbackQuestions(latest, consumedIds)
  return {
    ...latest,
    summary: locked.summary ? latest.summary : (cleanText(result.summary, LIMITS.summary) || latest.summary),
    profile: { ...profile, level },
    questions,
    pending: latest.pending.filter(item => !consumedIds.includes(item.id)),
    dirty: false,
    dirtyAt: 0,
    summarizedAt: now,
    status: { state: 'idle', error: '', failedAt: 0, failures: 0, nextRetryAt: 0 },
    updatedAt: now,
    revision: latest.revision + 1,
  }
}

export function mergeGlobalSummary(
  latest: GlobalMemory,
  result: { summary: string; profile: MemoryProfile; themes: string[] },
  options: { consumedIds: string[]; sources: GlobalSource[]; now: number },
): GlobalMemory {
  const { consumedIds, sources, now } = options
  const locked = latest.manual.locked
  const profile = mergeProfileArrays(latest, result.profile)
  profile.misconceptions = []
  const level = locked.level ? latest.profile.level : (result.profile.level || latest.profile.level)
  const themes = mergeList(latest.manual.pinned.themes ?? [], result.themes, latest.manual.suppressed, LIMITS.themes)
  return {
    ...latest,
    summary: locked.summary ? latest.summary : (cleanText(result.summary, LIMITS.globalSummary) || latest.summary),
    profile: { ...profile, level },
    themes,
    sources: sources.map(source => ({
      docId: cleanLine(source.docId, 64),
      title: cleanText(source.title, LIMITS.indexTitle),
      summarizedAt: cleanTime(source.summarizedAt),
      note: cleanText(source.note, LIMITS.sourceNote),
    })),
    removed: [],
    pending: latest.pending.filter(item => !consumedIds.includes(item.id)),
    summarizedAt: now,
    status: { state: 'idle', error: '', failedAt: 0, failures: 0, nextRetryAt: 0 },
    updatedAt: now,
    revision: latest.revision + 1,
  }
}

export type MemoryPatch = Partial<{
  summary: string; level: string; goals: string[]; interests: string[]; strengths: string[];
  weaknesses: string[]; misconceptions: string[]; preferences: string[]; questions: string[];
  themes: string[]; onboarding: OnboardingAnswers
}>

const normalizePatchList = (field: ArrayField, value: unknown): string[] => cleanList(value, fieldCap(field), fieldItemCap(field))
function normalizeEditField(field: string, value: unknown): unknown {
  if (field === 'summary') return cleanText(value, 1500)
  if (field === 'level') return cleanLine(value, LIMITS.level)
  if (field === 'onboarding') return normalizeOnboarding(value)
  return normalizePatchList(field as ArrayField, value)
}

/** 只把用户真正改过的字段放进 patch（逐字段比较归一化后的值）。 */
export function diffEdit(baseline: MemoryPatch, form: MemoryPatch): MemoryPatch {
  const fields = ['summary', 'level', ...ARRAY_FIELDS, 'onboarding'] as const
  const patch: MemoryPatch = {}
  for (const field of fields) {
    const before = normalizeEditField(field, (baseline as Record<string, unknown>)[field])
    const after = normalizeEditField(field, (form as Record<string, unknown>)[field])
    if (JSON.stringify(before) === JSON.stringify(after)) continue
    if (after === null) continue
    ;(patch as Record<string, unknown>)[field] = after
  }
  return patch
}

const isProfileField = (field: string): field is ProfileListField => PROFILE_LIST_FIELDS.includes(field as ProfileListField)

/** 手动编辑：写文本并锁定；数组写入选定值、置顶、屏蔽被删掉的旧条目。 */
export function applyManualEdit<T extends DocumentMemory | GlobalMemory>(memory: T, patch: MemoryPatch, now: number): T {
  const next = { ...memory } as T
  const profile = { ...memory.profile }
  const manual: MemoryManual = {
    locked: { ...memory.manual.locked },
    pinned: Object.fromEntries(Object.entries(memory.manual.pinned).map(([key, value]) => [key, [...value]])),
    suppressed: [...memory.manual.suppressed],
  }
  const changed: string[] = []
  if (typeof patch.summary === 'string') {
    next.summary = cleanText(patch.summary, 'docId' in memory ? LIMITS.summary : LIMITS.globalSummary)
    manual.locked.summary = now
    changed.push('综述')
  }
  if (typeof patch.level === 'string') {
    profile.level = cleanLine(patch.level, LIMITS.level)
    manual.locked.level = now
    changed.push('水平')
  }
  for (const field of ARRAY_FIELDS) {
    const value = (patch as Record<string, unknown>)[field]
    if (!Array.isArray(value)) continue
    const list = normalizePatchList(field, value)
    const current: string[] | undefined = isProfileField(field)
      ? (memory.profile as unknown as Record<string, string[]>)[field]
      : field === 'questions' && 'questions' in memory ? (memory as DocumentMemory).questions
        : field === 'themes' && 'themes' in memory ? (memory as GlobalMemory).themes
          : undefined
    if (!current) continue
    for (const item of current) if (!list.some(entry => normalizeKey(entry) === normalizeKey(item))) manual.suppressed.push(normalizeKey(item))
    manual.suppressed = [...new Set(manual.suppressed)].filter(key => !list.some(entry => normalizeKey(entry) === key)).slice(-LIMITS.suppressed)
    manual.pinned[field] = [...list]
    if (isProfileField(field)) (profile as unknown as Record<string, string[]>)[field] = list
    else if (field === 'questions') (next as DocumentMemory).questions = list
    else (next as GlobalMemory).themes = list
    changed.push(FIELD_LABELS[field] ?? field)
  }
  if (patch.onboarding) {
    const answers = normalizeOnboarding(patch.onboarding)
    if (answers) {
      ;(next as DocumentMemory).onboarding = { ...answers, source: (memory as DocumentMemory).onboarding?.source ?? 'manual' }
      changed.push('导入自评')
    }
  }
  next.profile = profile
  next.manual = manual
  next.status = { state: 'idle', error: '', failedAt: 0, failures: 0, nextRetryAt: 0 }
  if ('docId' in memory) {
    ;(next as DocumentMemory).dirty = true
    ;(next as DocumentMemory).dirtyAt = now
  }
  next.updatedAt = now
  next.revision = memory.revision + 1
  if (changed.length) {
    const text = cleanText(`手动编辑了：${changed.join('、')}`, LIMITS.evidenceText)
    next.evidence = pushCapped(memory.evidence, { id: randomId(), kind: 'manual', at: now, text, ref: '手动编辑' }, LIMITS.evidence)
  }
  return next
}

/** 删除数组里的一条：从数组与 pinned 去掉，规范化后加入 suppressed。 */
export function removeListItem<T extends DocumentMemory | GlobalMemory>(memory: T, field: string, text: string, now: number): T {
  const next = { ...memory } as T
  const target = normalizeKey(text)
  if (isProfileField(field)) {
    const list = ((memory.profile as unknown as Record<string, string[]>)[field] ?? []).filter(item => normalizeKey(item) !== target)
    next.profile = { ...memory.profile, [field]: list }
  } else if (field === 'questions' && 'questions' in memory) {
    (next as DocumentMemory).questions = (memory as DocumentMemory).questions.filter(item => normalizeKey(item) !== target)
  } else if (field === 'themes' && 'themes' in memory) {
    (next as GlobalMemory).themes = (memory as GlobalMemory).themes.filter(item => normalizeKey(item) !== target)
  }
  const pinned = { ...memory.manual.pinned }
  if (pinned[field]) pinned[field] = pinned[field].filter(item => normalizeKey(item) !== target)
  const suppressed = [...new Set([...memory.manual.suppressed, target])].filter(Boolean).slice(-LIMITS.suppressed)
  next.manual = { ...memory.manual, pinned, suppressed }
  next.updatedAt = now
  next.revision = memory.revision + 1
  return next
}

export function removeEvidence<T extends DocumentMemory | GlobalMemory>(memory: T, evidenceId: string, now: number): T {
  const next = {
    ...memory,
    evidence: memory.evidence.filter(item => item.id !== evidenceId),
    updatedAt: now,
    revision: memory.revision + 1,
  } as T
  return next
}

export function unlockField<T extends DocumentMemory | GlobalMemory>(memory: T, field: 'summary' | 'level', now: number): T {
  const locked = { ...memory.manual.locked }
  delete locked[field]
  return { ...memory, manual: { ...memory.manual, locked }, updatedAt: now, revision: memory.revision + 1 } as T
}

/** 失败次数 +1，并按退避表设置 nextRetryAt（第 3 次起为 0 = 不再自动重试）。 */
export function markFailure<T extends DocumentMemory | GlobalMemory>(memory: T, error: string, now: number): T {
  const failures = memory.status.failures + 1
  return {
    ...memory,
    status: {
      state: 'failed',
      error: cleanText(error, 200),
      failedAt: now,
      failures,
      nextRetryAt: nextRetryAt(failures, now),
    },
    updatedAt: now,
    revision: memory.revision + 1,
  } as T
}

export function toIndexEntry(memory: DocumentMemory): MemoryIndexEntry {
  return {
    docId: memory.docId,
    title: cleanText(memory.title, LIMITS.indexTitle),
    updatedAt: memory.updatedAt,
    summarizedAt: memory.summarizedAt,
    pending: memory.pending.length,
    dirty: memory.dirty,
    hasOnboarding: Boolean(memory.onboarding),
    failed: memory.status.state === 'failed',
  }
}

export function toDocMeta(memory: DocumentMemory): DocMeta {
  return {
    docId: memory.docId,
    turns: memory.pending.length,
    oldestPendingAt: memory.pending[0]?.at || 0,
    lastEventAt: memory.pending[memory.pending.length - 1]?.at || 0,
    summarizedAt: memory.summarizedAt,
    failures: memory.status.failures,
    failedAt: memory.status.failedAt,
    nextRetryAt: memory.status.nextRetryAt,
  }
}

export function hasMemoryContent(memory: DocumentMemory | GlobalMemory | null): boolean {
  if (!memory) return false
  const profile = memory.profile
  const arrays = [profile.goals, profile.interests, profile.strengths, profile.weaknesses, profile.preferences]
  if (memory.summary || profile.level || arrays.some(list => list.length)) return true
  if ('onboarding' in memory && memory.onboarding) return true
  if ('questions' in memory && memory.questions.length) return true
  if ('themes' in memory && memory.themes.length) return true
  return false
}
