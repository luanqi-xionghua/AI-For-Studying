/**
 * 资料检索的响应式状态机。
 *
 * 只依赖注入进来的 deps（client / rerank / storage / now），**不** import sdk、
 * settings 或 complete：那样单测可以在 Node 里直接跑，不必拉起桌面壳。
 */

import { computed, reactive } from 'vue'
import type {
  IntentKey, LibraryHit, MaterialHit, MaterialLink, MaterialProgress, MaterialSearchResult,
  MaterialStatus, MaterialSyncResult, MaterialsClient, SyncPhase,
} from './types.ts'
import {
  MATERIALS_LIMITS, MATERIALS_STORAGE_KEY, friendlyMaterialError, materialErrorCode,
} from './types.ts'

export type RerankInput = {
  query: string; courses: string[]; intents: IntentKey[]; items: MaterialHit[]
}
export type RerankOutcome = { order: string[]; reasons: Record<string, string>; model: string }

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type MaterialsDeps = {
  client: MaterialsClient
  rerank?: (input: RerankInput, signal: AbortSignal) => Promise<RerankOutcome>
  rewrite?: (input: { query: string }, signal: AbortSignal) => Promise<string>
  rerankAvailable: () => { ok: boolean; reason: '' | 'no-preset' | 'no-model' }
  storage: StorageLike | null
  now: () => number
}

export type MaterialsView = 'loading' | 'unsynced' | 'first-sync' | 'first-sync-failed'
  | 'idle' | 'searching' | 'results' | 'no-result' | 'search-error'

export type MaterialBanner = {
  tone: 'info' | 'warn' | 'error'
  kind: 'progress' | 'failed' | 'partial' | 'recovered' | 'stale'
  text: string
}

export type MaterialsApi = ReturnType<typeof createMaterialsState>

const DAY = 24 * 3600 * 1000

function blankStatus(): MaterialStatus {
  return {
    state: 'empty', total: 0, raw: 0, syncedAt: 0, attemptedAt: 0, stale: false,
    syncing: false, recovered: false, sources: [],
  }
}

function stamp(at: number): string {
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)} 月 ${pad(date.getDate())} 日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function daysSince(at: number, now: number): number {
  return Math.max(1, Math.floor((now - at) / DAY))
}

export function createMaterialsState(deps: MaterialsDeps) {
  const state = reactive({
    ready: false,
    status: null as MaterialStatus | null,
    statusError: '',
    sync: {
      running: false,
      cancelling: false,
      committing: false,
      phase: '' as SyncPhase | '',
      done: 0,
      total: 0,
      message: '',
      error: '',
      errorCode: '',
      result: null as MaterialSyncResult | null,
      bannerDismissed: false,
    },
    draft: '',
    search: {
      epoch: 0,
      submitted: '',
      rewritten: '',
      running: false,
      result: null as MaterialSearchResult | null,
      error: '',
      staleAfterSync: false,
    },
    rerank: {
      status: 'idle' as 'idle' | 'off' | 'unavailable' | 'running' | 'done' | 'failed',
      unavailableReason: '' as '' | 'no-preset' | 'no-model',
      order: null as string[] | null,
      reasons: {} as Record<string, string>,
      model: '',
    },
    prefs: { recent: [] as string[], aiRerank: true, preferMirror: false },
  })

  let poller: ReturnType<typeof setInterval> | null = null
  let rerankController: AbortController | null = null
  let rewriteController: AbortController | null = null
  const opened = new Map<string, number>()
  const rerankCache = new Map<string, RerankOutcome>()

  const statusView = computed(() => state.status ?? blankStatus())

  // ---------------------------------------------------------------- 偏好

  function loadPrefs() {
    try {
      const raw = deps.storage?.getItem(MATERIALS_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return
      if (Array.isArray(parsed.recent)) {
        state.prefs.recent = parsed.recent
          .filter((item: unknown) => typeof item === 'string' && item.trim())
          .slice(0, MATERIALS_LIMITS.recent)
          .map((item: string) => item.slice(0, MATERIALS_LIMITS.query))
      }
      if (typeof parsed.aiRerank === 'boolean') state.prefs.aiRerank = parsed.aiRerank
      if (typeof parsed.preferMirror === 'boolean') state.prefs.preferMirror = parsed.preferMirror
    } catch {
      // 坏数据整体回落到默认值
    }
  }

  function savePrefs() {
    try {
      deps.storage?.setItem(MATERIALS_STORAGE_KEY, JSON.stringify({
        version: 1,
        recent: state.prefs.recent,
        aiRerank: state.prefs.aiRerank,
        preferMirror: state.prefs.preferMirror,
      }))
    } catch {
      // 存不进去只影响「最近搜索」，不影响检索本身
    }
  }

  function remember(query: string) {
    const text = query.trim()
    if (!text) return
    state.prefs.recent = [text, ...state.prefs.recent.filter(item => item !== text)]
      .slice(0, MATERIALS_LIMITS.recent)
    savePrefs()
  }

  // ---------------------------------------------------------------- 派生视图

  const view = computed<MaterialsView>(() => {
    if (!state.ready) return 'loading'
    const search = state.search
    if (search.submitted && search.running && !search.result) return 'searching'
    if (search.submitted && search.error) return 'search-error'
    if (search.submitted && search.result
      && (search.result.results.length || search.result.library.length)) return 'results'
    if (search.submitted && search.result) return 'no-result'
    const status = statusView.value
    if (status.state === 'empty' && state.sync.running) return 'first-sync'
    if (status.state === 'empty' && state.sync.error) return 'first-sync-failed'
    if (status.state === 'empty') return 'unsynced'
    return 'idle'
  })

  const displayed = computed<MaterialHit[]>(() => {
    const result = state.search.result
    if (!result) return []
    const order = state.rerank.order
    if (!order || !order.length) return result.results
    const byId = new Map(result.results.map(item => [item.id, item]))
    const head: MaterialHit[] = []
    const seen = new Set<string>()
    for (const id of order) {
      const hit = byId.get(id)
      if (hit && !seen.has(id)) {
        head.push(hit)
        seen.add(id)
      }
    }
    return [...head, ...result.results.filter(item => !seen.has(item.id))]
  })

  const banner = computed<MaterialBanner | null>(() => {
    const status = statusView.value
    if (status.state === 'ready' && state.sync.running) {
      return { tone: 'info', kind: 'progress', text: state.sync.message || '正在同步资料索引…' }
    }
    if (status.state === 'ready' && state.sync.error && !state.sync.bannerDismissed) {
      const when = status.syncedAt ? stamp(status.syncedAt) : ''
      return {
        tone: 'error', kind: 'failed',
        text: when
          ? `这次更新没有完成：${state.sync.error} 仍在使用 ${when} 的索引。`
          : `这次更新没有完成：${state.sync.error}`,
      }
    }
    if (state.sync.result?.partial && !state.sync.bannerDismissed) {
      const failed = state.sync.result.sources.filter(item => !item.ok)
      const keys = failed.map(item => item.key)
      const github = keys.filter(key => key === 'openise' || key === 'sysu')
      const arxiv = keys.includes('arxiv') || keys.includes('arxiv-pkg')
      let text: string
      if (github.length === 2 && !arxiv) {
        text = '已更新破壁计划；GitHub 的 OpenISE、SYSU-Exam 这次没有连上，沿用上次的列表。'
      } else if (arxiv && !github.length) {
        text = '已更新 GitHub 资料；破壁计划这次没有连上，沿用上次的列表。'
      } else {
        text = `部分来源没有更新：${failed.map(item => item.label).join('、')}。`
      }
      return { tone: 'warn', kind: 'partial', text }
    }
    if (status.recovered) {
      return { tone: 'warn', kind: 'recovered', text: '本机资料索引损坏，已自动重置。请重新同步一次。' }
    }
    if (status.stale && !state.sync.running && status.syncedAt) {
      return {
        tone: 'info', kind: 'stale',
        text: `资料索引已 ${daysSince(status.syncedAt, deps.now())} 天没有更新，可能缺少新上传的资料。`,
      }
    }
    return null
  })

  // ---------------------------------------------------------------- 同步

  function stopPolling() {
    if (poller !== null) {
      clearInterval(poller)
      poller = null
    }
  }

  function startPolling() {
    if (poller !== null) return
    let failures = 0
    poller = setInterval(async () => {
      try {
        const status = await deps.client.status()
        failures = 0
        state.status = status
        if (!status.syncing) {
          stopPolling()
          state.sync.running = false
          state.sync.committing = false
          if (state.search.staleAfterSync) {
            state.search.staleAfterSync = false
            void submit(state.search.submitted)
          }
        }
      } catch (error) {
        // 偶尔一次取不到状态先忍着；连续 3 次（约 6 秒）才放弃。放弃时把“正在同步”一并收掉
        // （1.2.8）：以前只停轮询、running 留在 true，页面永远显示同步中，同步与清空都点不了。
        if (++failures < 3) return
        stopPolling()
        state.sync.running = false
        state.sync.committing = false
        state.statusError = friendlyMaterialError(error)
      }
    }, 2000)
  }

  async function refreshStatus() {
    try {
      state.status = await deps.client.status()
      state.statusError = ''
    } catch (error) {
      state.statusError = friendlyMaterialError(error)
    }
    if (state.status?.syncing) {
      state.sync.running = true
      if (!state.sync.message) state.sync.message = '正在同步资料索引…'
      startPolling()
    }
    return state.status
  }

  async function init() {
    if (state.ready) {
      await refreshStatus()
      return
    }
    loadPrefs()
    refreshRerankAvailability()
    await refreshStatus()
    state.ready = true
  }

  async function startSync() {
    if (state.sync.running) return
    state.sync.running = true
    state.sync.cancelling = false
    state.sync.committing = false
    state.sync.error = ''
    state.sync.errorCode = ''
    state.sync.phase = 'start'
    state.sync.done = 0
    state.sync.total = 4
    state.sync.message = '正在连接资料来源…'
    state.sync.bannerDismissed = false
    try {
      const result = await deps.client.sync((event: MaterialProgress) => {
        state.sync.phase = event.phase
        state.sync.done = event.done
        state.sync.total = Math.max(event.total, event.done)
        state.sync.message = event.message
        if (event.phase === 'store' || event.phase === 'index') state.sync.committing = true
      })
      state.sync.result = result
      state.sync.error = ''
      await refreshStatus()
      if (state.search.submitted) void submit(state.search.submitted)
    } catch (error) {
      state.sync.error = friendlyMaterialError(error)
      state.sync.errorCode = materialErrorCode(error)
    } finally {
      state.sync.running = false
      state.sync.cancelling = false
      state.sync.committing = false
    }
  }

  async function cancelSync() {
    if (!state.sync.running || state.sync.cancelling) return
    state.sync.cancelling = true
    try {
      const result = await deps.client.cancel()
      if (result.reason === 'committing') {
        state.sync.cancelling = false
        state.sync.committing = true
        state.sync.message = '正在写入，马上完成'
      }
    } catch {
      state.sync.cancelling = false
    }
  }

  // ---------------------------------------------------------------- 检索

  function abortRerank() {
    if (rerankController) {
      rerankController.abort()
      rerankController = null
    }
  }

  function rerankKey(result: MaterialSearchResult, items: MaterialHit[]): string {
    return `${result.normalized}|${items.map(item => item.id).join(',')}`
  }

  function rememberRerank(key: string, outcome: RerankOutcome) {
    rerankCache.delete(key)
    rerankCache.set(key, outcome)
    while (rerankCache.size > MATERIALS_LIMITS.rerankCache) {
      const oldest = rerankCache.keys().next().value
      if (oldest === undefined) break
      rerankCache.delete(oldest)
    }
  }

  function applyRerank(outcome: RerankOutcome) {
    state.rerank.order = outcome.order
    state.rerank.reasons = outcome.reasons || {}
    state.rerank.model = outcome.model || ''
    state.rerank.status = 'done'
  }

  async function maybeRerank(epoch: number) {
    const result = state.search.result
    if (!state.prefs.aiRerank) {
      state.rerank.status = 'off'
      state.rerank.order = null
      return
    }
    const availability = deps.rerankAvailable()
    if (!availability.ok) {
      state.rerank.status = 'unavailable'
      state.rerank.unavailableReason = availability.reason
      state.rerank.order = null
      return
    }
    state.rerank.unavailableReason = ''
    if (!deps.rerank || !result || result.results.length < 3) {
      state.rerank.status = 'idle'
      return
    }
    const items = result.results.slice(0, MATERIALS_LIMITS.rerankCandidates)
    const key = rerankKey(result, items)
    const cached = rerankCache.get(key)
    if (cached) {
      applyRerank(cached)
      return
    }
    abortRerank()
    const controller = new AbortController()
    rerankController = controller
    state.rerank.status = 'running'
    state.rerank.order = null
    state.rerank.reasons = {}
    try {
      const outcome = await deps.rerank({
        query: result.query,
        courses: result.courses.map(item => item.text),
        intents: result.intents,
        items,
      }, controller.signal)
      if (epoch !== state.search.epoch || controller.signal.aborted) return
      rememberRerank(key, outcome)
      applyRerank(outcome)
    } catch {
      if (epoch === state.search.epoch && !controller.signal.aborted) state.rerank.status = 'failed'
    } finally {
      if (rerankController === controller) rerankController = null
    }
  }

  async function submit(value?: string) {
    const raw = value ?? state.draft
    const query = String(raw ?? '').trim().slice(0, MATERIALS_LIMITS.query)
    if (!query) return
    const epoch = ++state.search.epoch
    abortRerank()
    abortRewrite()
    state.search.submitted = query
    state.search.rewritten = ''
    state.search.running = true
    state.search.error = ''
    state.rerank.order = null
    state.rerank.reasons = {}
    state.rerank.status = 'idle'
    if (state.sync.running) state.search.staleAfterSync = true
    try {
      // 先让模型把口语改写成「规范课程名 + 资料类型」；失败就用原话，不影响检索
      const effective = await rewriteForSearch(query, epoch)
      if (epoch !== state.search.epoch) return
      let result = await deps.client.search(effective, MATERIALS_LIMITS.results)
      if (epoch !== state.search.epoch) return
      // 改写后没找到，再用原话找一次；原话有结果就以原话为准
      if (effective !== query && !result.found) {
        const fallback = await deps.client.search(query, MATERIALS_LIMITS.results)
        if (epoch !== state.search.epoch) return
        if (fallback.found) result = fallback
      }
      state.search.result = result
      state.search.rewritten = result.query && result.query !== query ? result.query : ''
      remember(query)
      void maybeRerank(epoch)
    } catch (error) {
      if (epoch !== state.search.epoch) return
      state.search.error = friendlyMaterialError(error)
    } finally {
      if (epoch === state.search.epoch) state.search.running = false
    }
  }

  function abortRewrite() {
    if (rewriteController) {
      rewriteController.abort()
      rewriteController = null
    }
  }

  async function rewriteForSearch(query: string, epoch: number): Promise<string> {
    if (!deps.rewrite || !state.prefs.aiRerank) return query
    if (!deps.rerankAvailable().ok) return query
    if (query.length < 2) return query
    const controller = new AbortController()
    rewriteController = controller
    try {
      const rewritten = await deps.rewrite({ query }, controller.signal)
      if (epoch !== state.search.epoch || controller.signal.aborted) return query
      const clean = String(rewritten ?? '').trim().slice(0, MATERIALS_LIMITS.query)
      return clean && clean !== query ? clean : query
    } catch {
      return query
    } finally {
      if (rewriteController === controller) rewriteController = null
    }
  }

  function clearQuery() {
    state.draft = ''
    state.search.epoch++
    abortRerank()
    abortRewrite()
    state.search.submitted = ''
    state.search.rewritten = ''
    state.search.result = null
    state.search.error = ''
    state.search.running = false
    state.search.staleAfterSync = false
    state.rerank.status = 'idle'
    state.rerank.order = null
    state.rerank.reasons = {}
  }

  // ---------------------------------------------------------------- 动作

  async function open(link: MaterialLink): Promise<string> {
    const moment = deps.now()
    if (moment - (opened.get(link.id) ?? 0) < 800) return ''
    opened.set(link.id, moment)
    try {
      await deps.client.open(link.id)
      return ''
    } catch (error) {
      return friendlyMaterialError(error)
    }
  }

  async function clearIndex(): Promise<string> {
    if (state.sync.running) return '正在同步，请等这一次完成。'
    try {
      await deps.client.clear()
      await refreshStatus()
      clearQuery()
      return ''
    } catch (error) {
      return friendlyMaterialError(error)
    }
  }

  function setAiRerank(on: boolean) {
    state.prefs.aiRerank = on
    savePrefs()
    if (!on) {
      abortRerank()
      state.rerank.order = null
      state.rerank.reasons = {}
      state.rerank.status = 'off'
      return
    }
    if (state.search.result) void maybeRerank(state.search.epoch)
  }

  function setPreferMirror(on: boolean) {
    state.prefs.preferMirror = on
    savePrefs()
  }

  function forgetRecent() {
    state.prefs.recent = []
    savePrefs()
  }

  function refreshRerankAvailability() {
    const availability = deps.rerankAvailable()
    if (availability.ok) {
      if (state.rerank.status === 'unavailable') state.rerank.status = 'idle'
      state.rerank.unavailableReason = ''
      if (state.search.result && state.prefs.aiRerank) void maybeRerank(state.search.epoch)
      return
    }
    state.rerank.unavailableReason = availability.reason
    if (state.prefs.aiRerank) state.rerank.status = 'unavailable'
  }

  function dismissBanner() {
    state.sync.bannerDismissed = true
  }

  function dispose() {
    abortRerank()
    abortRewrite()
    stopPolling()
  }

  return {
    state,
    view,
    displayed,
    banner,
    statusView,
    libraryHits: computed<LibraryHit[]>(() => state.search.result?.library ?? []),
    init,
    refreshStatus,
    startSync,
    cancelSync,
    submit,
    clearQuery,
    open,
    clearIndex,
    setAiRerank,
    setPreferMirror,
    forgetRecent,
    refreshRerankAvailability,
    dismissBanner,
    dispose,
  }
}
