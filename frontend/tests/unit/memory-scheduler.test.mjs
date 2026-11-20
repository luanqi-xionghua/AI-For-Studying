import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTO_DAILY_CAP, TURNS_PER_SUMMARY, SUMMARY_DEBOUNCE_MS, DOC_COOLDOWN_MS, GLOBAL_COOLDOWN_MS,
  REQUEST_GAP_MS, LEFTOVER_AGE_MS, TICK_MS, BUSY_RETRY_MS, BUSY_RETRY_MAX, decide, spendBudget, nextRetryAt, todayKey,
} from '../../src/memory/scheduler.ts'

const T = 1_700_000_000_000
const MINUTE = 60_000
const HOUR = 3_600_000

const doc = (overrides = {}) => ({
  docId: 'd1', turns: 0, oldestPendingAt: 0, lastEventAt: 0, summarizedAt: 0,
  failures: 0, failedAt: 0, nextRetryAt: 0, ...overrides,
})
const globalMeta = (overrides = {}) => ({
  turns: 0, oldestPendingAt: 0, lastEventAt: 0, summarizedAt: 0,
  failures: 0, failedAt: 0, nextRetryAt: 0, stale: false, docUpdates: 0, ...overrides,
})
const input = (overrides = {}) => ({
  now: T, autoUpdate: true, configured: true, running: false, foregroundBusy: false,
  busyRetries: 0, pausedUntil: 0, budgetRuns: 0, lastAutoRunAt: 0,
  docs: [], global: globalMeta(), ...overrides,
})

test('scheduler: basic gates come first', () => {
  assert.equal(decide(input({ autoUpdate: false, docs: [doc({ turns: 5 })] })).reason, 'off')
  assert.equal(decide(input({ configured: false })).reason, 'unconfigured')
  assert.equal(decide(input({ running: true })).reason, 'running')
  const paused = decide(input({ pausedUntil: T + MINUTE }))
  assert.deepEqual([paused.reason, paused.ms], ['paused', MINUTE])
  assert.equal(decide(input({ budgetRuns: AUTO_DAILY_CAP })).reason, 'budget')
  const gap = decide(input({ lastAutoRunAt: T - 10_000 }))
  assert.deepEqual([gap.reason, gap.ms], ['gap', REQUEST_GAP_MS - 10_000])
})

test('scheduler: waits while a book has fewer than 3 turns', () => {
  const decision = decide(input({ docs: [doc({ turns: 2, oldestPendingAt: T - MINUTE, lastEventAt: T - MINUTE })] }))
  assert.equal(decision.action, 'wait')
})

test('scheduler: debounces 3 turns for 45 seconds', () => {
  const decision = decide(input({ docs: [doc({ turns: TURNS_PER_SUMMARY, oldestPendingAt: T - 50_000, lastEventAt: T - 10_000 })] }))
  assert.deepEqual([decision.reason, decision.ms], ['debounce', SUMMARY_DEBOUNCE_MS - 10_000])
})

test('scheduler: runs a book with 3 turns after the debounce', () => {
  const decision = decide(input({ docs: [doc({ turns: 3, oldestPendingAt: T - HOUR, lastEventAt: T - 46_000 })] }))
  assert.deepEqual(decision, { action: 'run', target: { kind: 'doc', docId: 'd1' } })
})

test('scheduler: leftover turns finally run after 30 minutes', () => {
  const decision = decide(input({ docs: [doc({ turns: 1, oldestPendingAt: T - 31 * MINUTE, lastEventAt: T - 31 * MINUTE })] }))
  assert.deepEqual(decision, { action: 'run', target: { kind: 'doc', docId: 'd1' } })
})

test('scheduler: cooldown delays a book that was summarized recently', () => {
  const decision = decide(input({ docs: [doc({ turns: 5, oldestPendingAt: T - HOUR, lastEventAt: T - 46_000, summarizedAt: T - 5 * MINUTE })] }))
  assert.deepEqual([decision.reason, decision.ms], ['cooldown', DOC_COOLDOWN_MS - 5 * MINUTE])
})

test('scheduler: backoff after failures; 3 failures pause until 24h has passed', () => {
  const backoff = decide(input({ docs: [doc({ turns: 5, oldestPendingAt: T - HOUR, lastEventAt: T - 46_000, failures: 1, failedAt: T - MINUTE, nextRetryAt: T + 2 * MINUTE })] }))
  assert.deepEqual([backoff.reason, backoff.ms], ['backoff', 2 * MINUTE])
  const stale = decide(input({ docs: [doc({ turns: 5, oldestPendingAt: T - HOUR, lastEventAt: T - 46_000, failures: 3, failedAt: T - HOUR })] }))
  assert.equal(stale.action, 'wait')
  const recovered = decide(input({ docs: [doc({ turns: 3, oldestPendingAt: T - HOUR, lastEventAt: T - 46_000, failures: 3, failedAt: T - 25 * HOUR })] }))
  assert.equal(recovered.action, 'run')
})

test('scheduler: foreground work defers until BUSY_RETRY_MAX', () => {
  const ready = { docs: [doc({ turns: 3, oldestPendingAt: T - HOUR, lastEventAt: T - 46_000 })], foregroundBusy: true }
  const deferred = decide(input({ ...ready, busyRetries: 3 }))
  assert.deepEqual([deferred.reason, deferred.ms], ['busy', BUSY_RETRY_MS])
  assert.equal(decide(input({ ...ready, busyRetries: BUSY_RETRY_MAX })).action, 'run')
})

test('scheduler: the oldest pending book wins', () => {
  const decision = decide(input({ docs: [
    doc({ docId: 'early', turns: 3, oldestPendingAt: T - HOUR, lastEventAt: T - 46_000 }),
    doc({ docId: 'later', turns: 3, oldestPendingAt: T - 2 * HOUR, lastEventAt: T - 46_000 }),
  ] }))
  assert.deepEqual(decision.target, { kind: 'doc', docId: 'later' })
})

test('scheduler: global memory runs when stale or after 3 global turns', () => {
  const stale = decide(input({ global: globalMeta({ stale: true, docUpdates: 1 }) }))
  assert.deepEqual(stale, { action: 'run', target: { kind: 'global' } })
  const cooling = decide(input({ global: globalMeta({ stale: true, docUpdates: 1, summarizedAt: T - 5 * MINUTE }) }))
  assert.deepEqual([cooling.reason, cooling.ms], ['cooldown', Math.min(GLOBAL_COOLDOWN_MS - 5 * MINUTE, TICK_MS)])
  const turns = decide(input({ global: globalMeta({ turns: 3, oldestPendingAt: T - HOUR, lastEventAt: T - 46_000 }) }))
  assert.deepEqual(turns, { action: 'run', target: { kind: 'global' } })
})

test('scheduler: documents win over the global memory', () => {
  const decision = decide(input({
    docs: [doc({ turns: 3, oldestPendingAt: T - HOUR, lastEventAt: T - 46_000 })],
    global: globalMeta({ stale: true, docUpdates: 1 }),
  }))
  assert.equal(decision.target.kind, 'doc')
})

test('scheduler: a book with only onboarding (no turns) is idle', () => {
  const decision = decide(input({ docs: [doc({ turns: 0 })] }))
  assert.deepEqual([decision.reason, decision.ms], ['idle', TICK_MS])
})

test('scheduler: spendBudget resets on a new day', () => {
  const day = todayKey(T)
  const old = { version: 1, autoUpdate: true, noticeShown: false, budget: { day: '2000-01-01', runs: 9 }, pausedUntil: 0, consecutiveFailures: 0, updatedAt: 0 }
  assert.deepEqual(spendBudget(old, T).budget, { day, runs: 1 })
  const today = { ...old, budget: { day, runs: 9 } }
  assert.deepEqual(spendBudget(today, T).budget, { day, runs: 10 })
})

test('scheduler: nextRetryAt follows the backoff table', () => {
  assert.equal(nextRetryAt(1, T), T + 300_000)
  assert.equal(nextRetryAt(2, T), T + 1_800_000)
  assert.equal(nextRetryAt(3, T), 0)
  assert.equal(nextRetryAt(0, T), 0)
})
