/**
 * 记忆引擎：收学习事件、防抖落库、按规则调模型总结、处理失败与退避。
 * 真实依赖全部从参数注入（存储、模型、定时器、时钟），单测可以直接驱动。
 */
import { reactive } from 'vue'
import {
  LIMITS, type DocumentMemory, type GlobalMemory, type MemoryIndex, type MemoryPurpose, type MemoryScope, type MemorySettings, type OnboardingAnswers,
} from './types.ts'
import { emptyDocumentMemory, emptyGlobalMemory } from './normalize.ts'
import { onLearningEvent, type LearningEvent } from './events.ts'
import {
  applyEvent, applyGlobalTurn, applyManualEdit, applyOnboarding, hasMemoryContent, markFailure,
  mergeDocumentSummary, mergeGlobalSummary, removeEvidence, removeListItem, toDocMeta, toIndexEntry,
  unlockField, type MemoryPatch,
} from './merge.ts'
import {
  buildDocumentInput, buildGlobalInput, buildInjection, parseSummaryJson, validateDocumentSummary,
  validateGlobalSummary, DOCUMENT_SUMMARY_SYSTEM, GLOBAL_SUMMARY_SYSTEM,
} from './prompts.ts'
import {
  BREAKER_FAILURES, BREAKER_PAUSE_MS, STARTUP_DELAY_MS, decide, spendBudget, todayKey,
  type DocMeta, type SchedulerInput,
} from './scheduler.ts'
import type { MemoryStore } from './store.ts'
import type { MemoryConfigView, MemoryModelCall } from './summarize.ts'

export type LibraryDoc = { id: string; name: string; page: number; pageCount: number; progress: number; lastOpenedAt: number }
export type MemoryEngineDeps = {
  store: MemoryStore
  callModel: MemoryModelCall
  configView: () => MemoryConfigView
  notify: (text: string) => void
  foregroundBusy: () => boolean
  now: () => number
  setTimer: (run: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  reportFailure: (id: string, label: string, error: unknown, retry: () => Promise<void>) => void
  clearFailure: (id: string) => void
}
export type RunResult = { ok: true } | { ok: false; code: string; message: string }
export type MemoryEngineState = {
  ready: boolean
  error: string
  rebuilding: boolean
  index: MemoryIndex
  settings: MemorySettings
  global: GlobalMemory | null
  running: { kind: 'doc' | 'global'; docId: string; title: string; startedAt: number; manual: boolean } | null
  config: MemoryConfigView
  /** 每次任一文档记忆落库后 +1，详情面板据此重新读取当前这本书。 */
  docsVersion: number
}
export type MemoryEngine = {
  state: MemoryEngineState
  start(): Promise<void>
  stop(): Promise<void>
  syncDocuments(docs: LibraryDoc[]): void
  refreshConfig(): void
  loadDocument(docId: string): Promise<{ memory: DocumentMemory | null; newer: boolean }>
  loadGlobal(): Promise<GlobalMemory>
  initDocument(docId: string, title: string, answers: OnboardingAnswers): Promise<DocumentMemory>
  editDocument(docId: string, patch: MemoryPatch, baseRevision: number): Promise<{ memory: DocumentMemory; merged: boolean }>
  editGlobal(patch: MemoryPatch, baseRevision: number): Promise<{ memory: GlobalMemory; merged: boolean }>
  removeItem(target: 'global' | { docId: string }, field: string, text: string): Promise<void>
  removeEvidenceItem(target: 'global' | { docId: string }, evidenceId: string): Promise<void>
  unlock(target: 'global' | { docId: string }, field: 'summary' | 'level'): Promise<void>
  clearDocument(docId: string): Promise<void>
  clearGlobal(): Promise<void>
  summarizeDocumentNow(docId: string): Promise<RunResult>
  summarizeGlobalNow(): Promise<RunResult>
  cancelRun(): void
  setAutoUpdate(value: boolean): Promise<void>
  resumeAutoUpdate(): Promise<void>
  injectionFor(scope: MemoryScope, purpose?: MemoryPurpose): Promise<{ text: string; tag: ReturnType<typeof buildInjection>['tag'] }>
  flush(): Promise<void>
  freeze(): void
  unfreeze(): void
}

const SAVE_DEBOUNCE_MS = 1500
const PRUNE_INTERVAL_MS = 600_000
const DOC_CACHE_MAX = 50
const SCHEDULER_BOOKS = 20
const emptyIndex = (): MemoryIndex => ({ version: 1, updatedAt: 0, docs: [], globalStale: false, docUpdatesSinceGlobal: 0, lastRun: null })
const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error)
const isBusy = (error: unknown): boolean => /AI 请求过多|请求过多|too many requests/i.test(messageOf(error))

type RunTarget = { kind: 'doc'; docId: string } | { kind: 'global' }

export function createMemoryEngine(deps: MemoryEngineDeps): MemoryEngine {
  const state = reactive<MemoryEngineState>({
    ready: false, error: '', rebuilding: false,
    index: emptyIndex(), settings: { version: 1, autoUpdate: true, noticeShown: false, budget: { day: '', runs: 0 }, pausedUntil: 0, consecutiveFailures: 0, updatedAt: 0 },
    global: null, running: null, config: deps.configView(), docsVersion: 0,
  })
  const docs = new Map<string, DocumentMemory>()
  const usedAt = new Map<string, number>()
  const dirty = new Set<string>()
  const library = new Map<string, LibraryDoc>()
  const early: LearningEvent[] = []
  let started = false
  let frozen = false
  let unsubscribe: () => void = () => {}
  let readyResolve: (() => void) | undefined
  const readyPromise = new Promise<void>(resolve => { readyResolve = resolve })
  let timer: unknown
  let saveTimer: unknown
  let indexDirty = false
  let activeController: AbortController | undefined
  let lastAutoRunAt = 0
  let busyRetries = 0
  let lastPruneAt = 0
  let saving: Promise<void> = Promise.resolve()
  /** 事件按到达顺序串行处理：同一批里的多条问答不能各自读库再互相覆盖。 */
  let handling: Promise<void> = Promise.resolve()
  const enqueueHandle = (event: LearningEvent): Promise<void> => {
    handling = handling.then(() => handle(event)).catch(() => {})
    return handling
  }

  function touch(docId: string) { usedAt.set(docId, deps.now()) }
  function cacheDoc(memory: DocumentMemory) {
    if (!docs.has(memory.docId) && docs.size >= DOC_CACHE_MAX) {
      let victim = ''
      let oldest = Number.POSITIVE_INFINITY
      for (const [docId, value] of docs) {
        if (dirty.has(docId) || state.running?.docId === docId) continue
        const stamp = usedAt.get(docId) ?? 0
        if (stamp < oldest) { oldest = stamp; victim = docId }
      }
      if (victim) { docs.delete(victim); usedAt.delete(victim) }
    }
    docs.set(memory.docId, memory)
    touch(memory.docId)
  }

  function upsertIndexEntry(memory: DocumentMemory) {
    const entry = toIndexEntry(memory)
    const entries = state.index.docs.slice()
    const index = entries.findIndex(item => item.docId === entry.docId)
    if (index >= 0) entries[index] = entry
    else entries.push(entry)
    state.index = { ...state.index, updatedAt: memory.updatedAt, docs: entries }
    indexDirty = true
    state.docsVersion++
  }

  function scheduleSave(immediate: boolean) {
    if (saveTimer !== undefined) { deps.clearTimer(saveTimer); saveTimer = undefined }
    if (immediate) { void persist(); return }
    saveTimer = deps.setTimer(() => { saveTimer = undefined; void persist() }, SAVE_DEBOUNCE_MS)
  }

  function persist(): Promise<void> {
    saving = saving.then(async () => {
      if (frozen) return
      for (const key of [...dirty]) {
        if (frozen) return
        try {
          if (key === 'global') {
            if (!state.global) { dirty.delete(key); continue }
            await deps.store.saveGlobal(state.global)
          } else {
            const memory = docs.get(key)
            if (!memory) { dirty.delete(key); continue }
            await deps.store.saveDoc(memory)
          }
          dirty.delete(key)
          deps.clearFailure('memory:' + key)
        } catch (error) {
          deps.reportFailure('memory:' + key, '学习记忆', error, persist)
        }
      }
      if (indexDirty) {
        try { await deps.store.saveIndex(state.index); indexDirty = false } catch (error) { deps.reportFailure('memory:index', '学习记忆', error, persist) }
      }
    }).catch(() => {})
    return saving
  }

  async function commitDoc(memory: DocumentMemory, immediate: boolean): Promise<void> {
    cacheDoc(memory)
    upsertIndexEntry(memory)
    dirty.add(memory.docId)
    scheduleSave(immediate)
  }

  async function commitGlobal(memory: GlobalMemory, immediate: boolean): Promise<void> {
    state.global = memory
    dirty.add('global')
    indexDirty = true
    scheduleSave(immediate)
  }

  async function getGlobal(): Promise<GlobalMemory> {
    if (state.global) return state.global
    try { state.global = await deps.store.loadGlobal() } catch (error) {
      state.error = messageOf(error)
      state.global = emptyGlobalMemory(deps.now())
    }
    return state.global
  }

  async function ensure(docId: string, create = false, title = ''): Promise<DocumentMemory | null> {
    const cached = docs.get(docId)
    if (cached) { touch(docId); return cached }
    let loaded: { memory: DocumentMemory | null; newer: boolean }
    try { loaded = await deps.store.loadDoc(docId) } catch (error) {
      state.error = messageOf(error)
      return null
    }
    if (loaded.memory) { cacheDoc(loaded.memory); return loaded.memory }
    if (!create || loaded.newer) return null
    const info = library.get(docId)
    const memory = emptyDocumentMemory(docId, title || info?.name || '', deps.now())
    if (info) {
      memory.reading = {
        ...memory.reading,
        page: Math.max(1, info.page || 1),
        pageCount: Math.max(1, info.pageCount || 1),
        progress: Math.min(1, Math.max(0, info.progress || 0)),
        maxProgress: Math.min(1, Math.max(0, info.progress || 0)),
        lastOpenedAt: info.lastOpenedAt || 0,
      }
    }
    cacheDoc(memory)
    return memory
  }

  async function handle(event: LearningEvent): Promise<void> {
    if (frozen || !state.ready) return
    switch (event.type) {
      case 'document-removed':
        await removeDocument(event.docId, event.title)
        break
      case 'onboarding': {
        const current = await ensure(event.docId, false)
        const next = applyOnboarding(current, event, deps.now())
        if (next.changed) await commitDoc(next.memory, true)
        break
      }
      case 'assistant-turn': {
        const current = await ensure(event.docId, true, event.title)
        if (current) await commitDoc(applyEvent(current, event, deps.now()), false)
        break
      }
      case 'chat-turn': {
        if (event.scope.kind === 'doc') {
          const current = await ensure(event.scope.docId, true, event.scope.title)
          if (current) await commitDoc(applyEvent(current, event, deps.now()), false)
        } else if (event.scope.kind === 'global') {
          await commitGlobal(applyGlobalTurn(await getGlobal(), event, deps.now()), false)
        }
        break
      }
      case 'opened':
      case 'reading': {
        const current = await ensure(event.docId, false)
        if (current) await commitDoc(applyEvent(current, event, deps.now()), false)
        break
      }
    }
    arm()
  }

  function arm(ms = 1000) {
    if (timer !== undefined) deps.clearTimer(timer)
    timer = deps.setTimer(() => { void tick() }, ms)
  }

  async function schedulerInput(): Promise<SchedulerInput> {
    const now = deps.now()
    const entries = state.index.docs
      .filter(entry => entry.pending > 0 || entry.failed)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, SCHEDULER_BOOKS)
    const metas: DocMeta[] = []
    for (const entry of entries) {
      const memory = await ensure(entry.docId, false)
      if (memory) metas.push(toDocMeta(memory))
    }
    let globalMeta: SchedulerInput['global'] = {
      turns: 0, oldestPendingAt: 0, lastEventAt: 0, summarizedAt: 0, failures: 0, failedAt: 0, nextRetryAt: 0,
      stale: state.index.globalStale, docUpdates: state.index.docUpdatesSinceGlobal,
    }
    if (state.global || state.index.globalStale) {
      const global = await getGlobal()
      globalMeta = {
        turns: global.pending.length,
        oldestPendingAt: global.pending[0]?.at || 0,
        lastEventAt: global.pending[global.pending.length - 1]?.at || 0,
        summarizedAt: global.summarizedAt,
        failures: global.status.failures,
        failedAt: global.status.failedAt,
        nextRetryAt: global.status.nextRetryAt,
        stale: state.index.globalStale,
        docUpdates: state.index.docUpdatesSinceGlobal,
      }
    }
    return {
      now, autoUpdate: state.settings.autoUpdate, configured: deps.configView().configured,
      running: Boolean(state.running), foregroundBusy: deps.foregroundBusy(), busyRetries,
      pausedUntil: state.settings.pausedUntil,
      budgetRuns: state.settings.budget.day === todayKey(now) ? state.settings.budget.runs : 0,
      lastAutoRunAt, docs: metas, global: globalMeta,
    }
  }

  async function tick(): Promise<void> {
    timer = undefined
    if (frozen || !state.ready) return
    const decision = decide(await schedulerInput())
    if (decision.action === 'wait') {
      busyRetries = decision.reason === 'busy' ? busyRetries + 1 : 0
      arm(decision.ms)
      return
    }
    busyRetries = 0
    await run(decision.target, false)
    if (!frozen) arm()
  }

  async function announceOnce(): Promise<void> {
    if (state.settings.noticeShown) return
    state.settings = { ...state.settings, noticeShown: true, updatedAt: deps.now() }
    try { await deps.store.saveSettings(state.settings) } catch { /* 设置写不进去也不挡总结 */ }
    deps.notify('已开始在后台整理学习记忆（使用「记忆管理」预设）。可以在「记忆管理」页关闭自动更新。')
  }

  async function succeed(target: RunTarget, title: string): Promise<void> {
    const now = deps.now()
    state.settings = { ...state.settings, consecutiveFailures: 0, updatedAt: now }
    state.index = { ...state.index, lastRun: { at: now, kind: target.kind, docId: target.kind === 'doc' ? target.docId : '', title, ok: true, error: '' } }
    indexDirty = true
    try { await deps.store.saveSettings(state.settings) } catch (error) { deps.reportFailure('memory:settings', '学习记忆', error, persist) }
    await persist()
  }

  async function fail(target: RunTarget, error: unknown, title: string): Promise<void> {
    const now = deps.now()
    const message = messageOf(error)
    if (target.kind === 'doc') {
      const latest = docs.get(target.docId) ?? await ensure(target.docId, false)
      if (latest) await commitDoc(markFailure(latest, message, now), true)
    } else {
      await commitGlobal(markFailure(await getGlobal(), message, now), true)
    }
    state.settings = { ...state.settings, consecutiveFailures: state.settings.consecutiveFailures + 1, updatedAt: now }
    if (state.settings.consecutiveFailures >= BREAKER_FAILURES) state.settings = { ...state.settings, pausedUntil: now + BREAKER_PAUSE_MS }
    try { await deps.store.saveSettings(state.settings) } catch (saveError) { deps.reportFailure('memory:settings', '学习记忆', saveError, persist) }
    state.index = { ...state.index, lastRun: { at: now, kind: target.kind, docId: target.kind === 'doc' ? target.docId : '', title, ok: false, error: message } }
    indexDirty = true
    await persist()
  }

  async function run(target: RunTarget, manual: boolean): Promise<RunResult> {
    if (state.running) return { ok: false, code: 'running', message: '已有记忆更新正在进行。' }
    state.config = deps.configView()
    if (!state.config.configured) return { ok: false, code: 'no-preset', message: state.config.message || '未配置记忆管理预设。' }
    const now = deps.now()
    let input: { text: string; consumedIds: string[]; sources?: GlobalMemory['sources'] }
    let title = '全局记忆'
    if (target.kind === 'doc') {
      const memory = await ensure(target.docId, false)
      if (!memory) return { ok: false, code: 'no-material', message: '这本书还没有可总结的学习记录。' }
      if (manual && !memory.pending.length && !memory.onboarding && !memory.summarizedAt) {
        return { ok: false, code: 'no-material', message: '这本书还没有可总结的学习记录。' }
      }
      input = buildDocumentInput(memory, now)
      title = memory.title
    } else {
      const global = await getGlobal()
      const entries = state.index.docs
        .filter(entry => entry.summarizedAt > 0 || entry.hasOnboarding)
        .sort((a, b) => b.summarizedAt - a.summarizedAt)
        .slice(0, 20)
      const docsToSummarize: DocumentMemory[] = []
      for (const entry of entries) {
        const memory = await ensure(entry.docId, false)
        if (memory) docsToSummarize.push(memory)
      }
      if (manual && !global.pending.length && !hasMemoryContent(global) && !docsToSummarize.length) {
        return { ok: false, code: 'no-material', message: '还没有可总结的内容：先在对话模式或阅读助手里提问，或为文档建立记忆。' }
      }
      input = buildGlobalInput(global, docsToSummarize, now)
    }
    if (!manual) {
      await announceOnce()
      state.settings = { ...spendBudget(state.settings, now), updatedAt: now }
      try { await deps.store.saveSettings(state.settings) } catch (error) { deps.reportFailure('memory:settings', '学习记忆', error, persist) }
      lastAutoRunAt = now
    }
    const controller = new AbortController()
    activeController = controller
    state.running = { kind: target.kind, docId: target.kind === 'doc' ? target.docId : '', title, startedAt: now, manual }
    try {
      const text = await deps.callModel({
        kind: target.kind,
        system: target.kind === 'doc' ? DOCUMENT_SUMMARY_SYSTEM : GLOBAL_SUMMARY_SYSTEM,
        input: input.text,
        signal: controller.signal,
      })
      const raw = parseSummaryJson(text)
      if (target.kind === 'doc') {
        const latest = docs.get(target.docId)
        if (!latest) return { ok: false, code: 'gone', message: '这本书的记忆已被清空。' }
        const merged = mergeDocumentSummary(latest, validateDocumentSummary(raw), { consumedIds: input.consumedIds, now: deps.now() })
        await commitDoc(merged, true)
        state.index = { ...state.index, globalStale: true, docUpdatesSinceGlobal: state.index.docUpdatesSinceGlobal + 1 }
        indexDirty = true
      } else {
        const merged = mergeGlobalSummary(await getGlobal(), validateGlobalSummary(raw), { consumedIds: input.consumedIds, sources: input.sources ?? [], now: deps.now() })
        await commitGlobal(merged, true)
        state.index = { ...state.index, globalStale: false, docUpdatesSinceGlobal: 0 }
        indexDirty = true
      }
      await succeed(target, title)
      return { ok: true }
    } catch (error) {
      if (controller.signal.aborted && !(error instanceof Error && error.name === 'MemoryError')) return { ok: false, code: 'aborted', message: '已停止。' }
      if (isBusy(error)) return { ok: false, code: 'busy', message: messageOf(error) }
      await fail(target, error, title)
      const code = (error as { code?: string } | null)?.code
      return { ok: false, code: typeof code === 'string' ? code : 'error', message: messageOf(error) }
    } finally {
      activeController = undefined
      state.running = null
    }
  }

  async function rebuildIndex(list: LibraryDoc[]): Promise<void> {
    const entries: MemoryIndex['docs'] = []
    const batch: LibraryDoc[] = []
    const flushBatch = async () => {
      for (const item of batch.splice(0)) {
        const loaded = await deps.store.loadDoc(item.id).catch(() => ({ memory: null, newer: false }))
        if (loaded.memory) { cacheDoc(loaded.memory); entries.push(toIndexEntry(loaded.memory)) }
      }
    }
    for (const item of list) {
      batch.push(item)
      if (batch.length >= 20) { await flushBatch(); await new Promise<void>(resolve => setTimeout(resolve, 0)) }
    }
    await flushBatch()
    state.index = { ...state.index, updatedAt: deps.now(), docs: entries }
    state.rebuilding = false
    indexDirty = true
    await persist()
  }

  async function updateGlobalRemoved(docId: string, title: string): Promise<void> {
    const global = await getGlobal()
    const sources = global.sources.filter(source => source.docId !== docId)
    if (sources.length === global.sources.length) return
    const name = (title || global.sources.find(source => source.docId === docId)?.title || '').slice(0, LIMITS.indexTitle)
    const removed = name ? [...global.removed.filter(value => value !== name), name].slice(-LIMITS.removed) : global.removed
    state.global = { ...global, sources, removed, updatedAt: deps.now() }
    dirty.add('global')
    scheduleSave(false)
    state.index = { ...state.index, globalStale: true }
    indexDirty = true
  }

  async function forgetDocument(docId: string, title: string, updateGlobal: boolean): Promise<void> {
    docs.delete(docId)
    usedAt.delete(docId)
    dirty.delete(docId)
    try { await deps.store.deleteDoc(docId); deps.clearFailure('memory:remove:' + docId) } catch (error) {
      deps.reportFailure('memory:remove:' + docId, '学习记忆清理', error, () => forgetDocument(docId, title, updateGlobal))
      return
    }
    state.index = { ...state.index, docs: state.index.docs.filter(entry => entry.docId !== docId) }
    indexDirty = true
    state.docsVersion++
    if (updateGlobal) await updateGlobalRemoved(docId, title)
  }

  async function removeDocument(docId: string, title: string): Promise<void> {
    if (state.running?.kind === 'doc' && state.running.docId === docId) activeController?.abort()
    const memory = docs.get(docId)
    await forgetDocument(docId, title || memory?.title || '', true)
    await persist()
  }

  async function prune(list: LibraryDoc[]): Promise<void> {
    const ids = new Set(list.map(item => item.id))
    let changed = false
    for (const entry of [...state.index.docs]) {
      if (ids.has(entry.docId)) continue
      // 修剪通常发生在启动后第一次同步；只有真的发现孤儿时才顺带读一次全局记忆。
      await forgetDocument(entry.docId, entry.title, true)
      changed = true
    }
    if (changed) await persist()
  }

  function syncDocuments(list: LibraryDoc[]): void {
    library.clear()
    for (const item of list) library.set(item.id, item)
    if (state.rebuilding) { void rebuildIndex(list); return }
    const byId = new Map(list.map(item => [item.id, item]))
    let renamed = false
    const entries = state.index.docs.map(entry => {
      const item = byId.get(entry.docId)
      if (!item || !item.name || item.name === entry.title) return entry
      renamed = true
      return { ...entry, title: item.name.slice(0, LIMITS.indexTitle) }
    })
    if (renamed) {
      state.index = { ...state.index, docs: entries }
      indexDirty = true
      void persist()
    }
    const now = deps.now()
    if (lastPruneAt === 0 || now - lastPruneAt >= PRUNE_INTERVAL_MS) {
      lastPruneAt = now
      void prune(list)
    }
  }

  async function start(): Promise<void> {
    if (started) return readyPromise
    started = true
    unsubscribe = onLearningEvent(event => {
      if (state.ready) void enqueueHandle(event)
      else early.push(event)
    })
    try {
      state.settings = await deps.store.loadSettings()
      const index = await deps.store.loadIndex()
      // 索引损坏（返回 null）→ 等 syncDocuments 带来文档列表后重建。
      if (index) state.index = index
      else state.rebuilding = true
    } catch (error) {
      state.error = messageOf(error)
      state.rebuilding = false
    }
    state.ready = true
    readyResolve?.()
    for (const event of early.splice(0)) await enqueueHandle(event)
    arm(STARTUP_DELAY_MS)
    return readyPromise
  }

  async function stop(): Promise<void> {
    unsubscribe()
    unsubscribe = () => {}
    if (timer !== undefined) { deps.clearTimer(timer); timer = undefined }
    if (saveTimer !== undefined) { deps.clearTimer(saveTimer); saveTimer = undefined }
    activeController?.abort()
    await flush()
  }

  async function flush(): Promise<void> {
    if (saveTimer !== undefined) { deps.clearTimer(saveTimer); saveTimer = undefined }
    await persist()
    await deps.store.flush()
  }

  function freeze(): void {
    frozen = true
    if (timer !== undefined) { deps.clearTimer(timer); timer = undefined }
    if (saveTimer !== undefined) { deps.clearTimer(saveTimer); saveTimer = undefined }
    dirty.clear()
    activeController?.abort()
  }

  function unfreeze(): void {
    frozen = false
    if (dirty.size) void persist()
    arm(1000)
  }

  async function ensureStartedReady(): Promise<void> {
    if (!started) void start()
    await readyPromise
  }

  async function injectionFor(scope: MemoryScope, purpose: MemoryPurpose = 'chat'): Promise<{ text: string; tag: ReturnType<typeof buildInjection>['tag'] }> {
    try {
      await ensureStartedReady()
      const memory = scope.kind === 'global' ? await getGlobal() : scope.kind === 'doc' ? await ensure(scope.docId, false) : null
      return buildInjection(scope, memory, deps.now(), purpose)
    } catch {
      if (scope.kind === 'doc') return { text: '', tag: { kind: 'doc', docId: scope.docId, title: scope.title, injected: false, chars: 0 } }
      return { text: '', tag: scope.kind === 'global' ? { kind: 'global', injected: false, chars: 0 } : { kind: 'none', injected: false, chars: 0 } }
    }
  }

  async function setAutoUpdate(value: boolean): Promise<void> {
    state.settings = { ...state.settings, autoUpdate: value, updatedAt: deps.now() }
    try { await deps.store.saveSettings(state.settings) } catch (error) { deps.reportFailure('memory:settings', '学习记忆', error, persist) }
    if (!value && state.running && !state.running.manual) activeController?.abort()
    arm(1000)
  }

  async function resumeAutoUpdate(): Promise<void> {
    state.settings = { ...state.settings, pausedUntil: 0, consecutiveFailures: 0, updatedAt: deps.now() }
    try { await deps.store.saveSettings(state.settings) } catch (error) { deps.reportFailure('memory:settings', '学习记忆', error, persist) }
    arm(1000)
  }

  async function editDocument(docId: string, patch: MemoryPatch, baseRevision: number): Promise<{ memory: DocumentMemory; merged: boolean }> {
    const latest = await ensure(docId, false)
    if (!latest) throw new Error('这本书还没有学习记忆。')
    const merged = latest.revision !== baseRevision
    const next = applyManualEdit(latest, patch, deps.now())
    await commitDoc(next, true)
    return { memory: next, merged }
  }

  async function editGlobal(patch: MemoryPatch, baseRevision: number): Promise<{ memory: GlobalMemory; merged: boolean }> {
    const latest = await getGlobal()
    const merged = latest.revision !== baseRevision
    const next = applyManualEdit(latest, patch, deps.now())
    await commitGlobal(next, true)
    return { memory: next, merged }
  }

  async function targetMemory(target: 'global' | { docId: string }): Promise<DocumentMemory | GlobalMemory | null> {
    return target === 'global' ? getGlobal() : ensure(target.docId, false)
  }

  async function commitTarget(target: 'global' | { docId: string }, memory: DocumentMemory | GlobalMemory): Promise<void> {
    if (target === 'global') await commitGlobal(memory as GlobalMemory, true)
    else await commitDoc(memory as DocumentMemory, true)
  }

  async function removeItem(target: 'global' | { docId: string }, field: string, text: string): Promise<void> {
    const memory = await targetMemory(target)
    if (!memory) return
    await commitTarget(target, removeListItem(memory, field, text, deps.now()))
  }

  async function removeEvidenceItem(target: 'global' | { docId: string }, evidenceId: string): Promise<void> {
    const memory = await targetMemory(target)
    if (!memory) return
    await commitTarget(target, removeEvidence(memory, evidenceId, deps.now()))
  }

  async function unlock(target: 'global' | { docId: string }, field: 'summary' | 'level'): Promise<void> {
    const memory = await targetMemory(target)
    if (!memory) return
    await commitTarget(target, unlockField(memory, field, deps.now()))
  }

  async function clearDocument(docId: string): Promise<void> {
    const memory = docs.get(docId)
    await forgetDocument(docId, memory?.title || library.get(docId)?.name || '', true)
    await persist()
  }

  async function clearGlobal(): Promise<void> {
    state.global = emptyGlobalMemory(deps.now())
    dirty.delete('global')
    try { await deps.store.deleteGlobal(); deps.clearFailure('memory:global') } catch (error) {
      deps.reportFailure('memory:global', '学习记忆清理', error, clearGlobal)
      return
    }
    state.index = { ...state.index, globalStale: false, docUpdatesSinceGlobal: 0 }
    indexDirty = true
    await persist()
  }

  async function initDocument(docId: string, title: string, answers: OnboardingAnswers): Promise<DocumentMemory> {
    const current = await ensure(docId, false)
    const event: Extract<LearningEvent, { type: 'onboarding' }> = { type: 'onboarding', docId, title, answers, importId: 'manual' + deps.now(), at: deps.now() }
    const next = applyOnboarding(current, event, deps.now())
    await commitDoc(next.memory, true)
    return next.memory
  }

  return {
    state,
    start, stop, syncDocuments, refreshConfig: () => { state.config = deps.configView() },
    loadDocument: async docId => {
      const cached = docs.get(docId)
      if (cached) { touch(docId); return { memory: cached, newer: false } }
      const loaded = await deps.store.loadDoc(docId)
      if (loaded.memory) cacheDoc(loaded.memory)
      return loaded
    },
    loadGlobal: getGlobal,
    initDocument, editDocument, editGlobal, removeItem, removeEvidenceItem, unlock,
    clearDocument, clearGlobal,
    summarizeDocumentNow: docId => run({ kind: 'doc', docId }, true),
    summarizeGlobalNow: () => run({ kind: 'global' }, true),
    cancelRun: () => { activeController?.abort() },
    setAutoUpdate, resumeAutoUpdate, injectionFor, flush, freeze, unfreeze,
  }
}
