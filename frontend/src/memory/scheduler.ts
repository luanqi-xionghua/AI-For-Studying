/** 自动记忆更新的触发规则：纯函数，输入当前状态，输出「现在跑谁」或「再等多久」。 */
import type { MemorySettings } from './types.ts'

export const TURNS_PER_SUMMARY = 3
export const SUMMARY_DEBOUNCE_MS = 45_000
export const DOC_COOLDOWN_MS = 600_000
export const GLOBAL_COOLDOWN_MS = 900_000
export const REQUEST_GAP_MS = 60_000
export const LEFTOVER_AGE_MS = 1_800_000
export const TICK_MS = 300_000
export const STARTUP_DELAY_MS = 20_000
export const AUTO_DAILY_CAP = 40
export const REQUEST_TIMEOUT_MS = 90_000
export const BUSY_RETRY_MS = 30_000
export const BUSY_RETRY_MAX = 10
/** 同一对象第 1、2 次失败后的重试等待；第 3 次起不再自动重试。 */
export const RETRY_BACKOFF_MS = [300_000, 1_800_000] as const
export const BREAKER_FAILURES = 3
export const BREAKER_PAUSE_MS = 1_800_000
export const OUTPUT_CHAR_CAP = 12_000
export const STALE_FAILURE_MS = 86_400_000

export type DocMeta = {
  docId: string
  turns: number
  oldestPendingAt: number
  lastEventAt: number
  summarizedAt: number
  failures: number
  failedAt: number
  nextRetryAt: number
}
export type GlobalMeta = Omit<DocMeta, 'docId'> & { stale: boolean; docUpdates: number }
export type SchedulerInput = {
  now: number
  autoUpdate: boolean
  configured: boolean
  running: boolean
  foregroundBusy: boolean
  busyRetries: number
  pausedUntil: number
  budgetRuns: number
  lastAutoRunAt: number
  docs: DocMeta[]
  global: GlobalMeta
}
export type Decision =
  | { action: 'run'; target: { kind: 'doc'; docId: string } | { kind: 'global' } }
  | { action: 'wait'; ms: number; reason: 'off' | 'unconfigured' | 'running' | 'paused' | 'budget' | 'gap' | 'busy' | 'debounce' | 'cooldown' | 'backoff' | 'idle' }

/** 本地自然日的 'YYYY-MM-DD'，用于每日上限的计数键。 */
export function todayKey(now: number): string {
  const date = new Date(now)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 换日则清零，再 runs + 1。 */
export function spendBudget(settings: MemorySettings, now: number): MemorySettings {
  const day = todayKey(now)
  const runs = settings.budget.day === day ? settings.budget.runs + 1 : 1
  return { ...settings, budget: { day, runs } }
}

/** 失败后的自动重试时间：第 1、2 次按退避表；第 3 次起返回 0（不再自动重试）。 */
export function nextRetryAt(failures: number, failedAt: number): number {
  if (failures <= 0 || failures > RETRY_BACKOFF_MS.length) return 0
  return failedAt + RETRY_BACKOFF_MS[failures - 1]
}

const wait = (reason: Extract<Decision, { action: 'wait' }>['reason'], ms: number): Decision => ({ action: 'wait', ms, reason })
const clampWait = (ms: number) => Math.min(TICK_MS, Math.max(1000, Math.round(ms)))

function cooldownLeft(now: number, summarizedAt: number, cooldown: number): number {
  return summarizedAt === 0 ? 0 : summarizedAt + cooldown - now
}

function retryLeft(doc: DocMeta, now: number): number {
  if (doc.failures === 0) return 0
  if (doc.failures <= RETRY_BACKOFF_MS.length) return Math.max(0, doc.nextRetryAt - now)
  return Math.max(0, doc.failedAt + STALE_FAILURE_MS - now)
}

function docReady(doc: DocMeta, now: number): boolean {
  if (doc.turns < 1) return false
  if (retryLeft(doc, now) > 0) return false
  if (cooldownLeft(now, doc.summarizedAt, DOC_COOLDOWN_MS) > 0) return false
  const enoughTurns = doc.turns >= TURNS_PER_SUMMARY && now - doc.lastEventAt >= SUMMARY_DEBOUNCE_MS
  const leftover = now - doc.oldestPendingAt >= LEFTOVER_AGE_MS
  return enoughTurns || leftover
}

function globalReady(global: GlobalMeta, now: number): boolean {
  const retry = global.failures > 0
    ? (global.failures <= RETRY_BACKOFF_MS.length ? global.nextRetryAt - now : global.failedAt + STALE_FAILURE_MS - now)
    : 0
  if (retry > 0) return false
  const cooldown = cooldownLeft(now, global.summarizedAt, GLOBAL_COOLDOWN_MS)
  const staleDue = global.stale && global.docUpdates >= 1 && (global.summarizedAt === 0 || cooldown <= 0)
  const turnsDue = global.turns >= TURNS_PER_SUMMARY && now - global.lastEventAt >= SUMMARY_DEBOUNCE_MS && cooldown <= 0
  const leftoverDue = global.turns >= 1 && now - global.oldestPendingAt >= LEFTOVER_AGE_MS && cooldown <= 0
  return staleDue || turnsDue || leftoverDue
}

/** 判定顺序见 6.3；永远返回一个决定，不抛异常。 */
export function decide(input: SchedulerInput): Decision {
  const { now } = input
  if (!input.autoUpdate) return wait('off', TICK_MS)
  if (!input.configured) return wait('unconfigured', TICK_MS)
  if (input.running) return wait('running', TICK_MS)
  if (now < input.pausedUntil) return wait('paused', Math.min(input.pausedUntil - now, TICK_MS))
  if (input.budgetRuns >= AUTO_DAILY_CAP) return wait('budget', TICK_MS)
  const gap = REQUEST_GAP_MS - (now - input.lastAutoRunAt)
  if (gap > 0) return wait('gap', gap)

  const runnableDocs = input.docs.filter(doc => docReady(doc, now)).sort((a, b) => a.oldestPendingAt - b.oldestPendingAt)
  if (runnableDocs.length) {
    if (input.foregroundBusy && input.busyRetries < BUSY_RETRY_MAX) return wait('busy', BUSY_RETRY_MS)
    return { action: 'run', target: { kind: 'doc', docId: runnableDocs[0].docId } }
  }
  if (globalReady(input.global, now)) {
    if (input.foregroundBusy && input.busyRetries < BUSY_RETRY_MAX) return wait('busy', BUSY_RETRY_MS)
    return { action: 'run', target: { kind: 'global' } }
  }

  // 都不可跑：找出「挡住它」的最短等待时间，作为下一次检查的间隔。
  let shortest = Number.POSITIVE_INFINITY
  let reason: Extract<Decision, { action: 'wait' }>['reason'] = 'idle'
  for (const doc of input.docs) {
    if (doc.turns < 1) continue
    const backoff = retryLeft(doc, now)
    if (backoff > 0) { if (backoff < shortest) { shortest = backoff; reason = 'backoff' } continue }
    const cooldown = cooldownLeft(now, doc.summarizedAt, DOC_COOLDOWN_MS)
    if (cooldown > 0) { if (cooldown < shortest) { shortest = cooldown; reason = 'cooldown' } continue }
    if (doc.turns >= TURNS_PER_SUMMARY) {
      const debounce = SUMMARY_DEBOUNCE_MS - (now - doc.lastEventAt)
      if (debounce > 0 && debounce < shortest) { shortest = debounce; reason = 'debounce' }
    } else {
      const leftover = LEFTOVER_AGE_MS - (now - doc.oldestPendingAt)
      if (leftover > 0 && leftover < shortest) { shortest = leftover; reason = 'debounce' }
    }
  }
  const global = input.global
  if (global.turns >= 1 || (global.stale && global.docUpdates >= 1)) {
    const backoff = global.failures > 0
      ? (global.failures <= RETRY_BACKOFF_MS.length ? global.nextRetryAt - now : global.failedAt + STALE_FAILURE_MS - now)
      : 0
    const cooldown = cooldownLeft(now, global.summarizedAt, GLOBAL_COOLDOWN_MS)
    if (backoff > 0) { if (backoff < shortest) { shortest = backoff; reason = 'backoff' } }
    else if (cooldown > 0) { if (cooldown < shortest) { shortest = cooldown; reason = 'cooldown' } }
  }
  if (!Number.isFinite(shortest)) return wait('idle', TICK_MS)
  return wait(reason === 'idle' ? 'idle' : reason, clampWait(shortest))
}
