import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryEngine } from '../../src/memory/engine.ts'
import { createMemoryStore } from '../../src/memory/store.ts'
import { emitLearningEvent, resetLearningEvents } from '../../src/memory/events.ts'
import { emptyDocumentMemory, emptyGlobalMemory, normalizeMemorySettings } from '../../src/memory/normalize.ts'
import { MEMORY_KEYS, docMemoryKey } from '../../src/memory/types.ts'
import { DOCUMENT_SUMMARY_SYSTEM, GLOBAL_SUMMARY_SYSTEM } from '../../src/memory/prompts.ts'
import { BREAKER_PAUSE_MS, todayKey } from '../../src/memory/scheduler.ts'

const NOW = 1_700_000_000_000
const HOUR = 3_600_000
const MINUTE = 60_000
const settle = async (rounds = 12) => { for (let index = 0; index < rounds; index++) await new Promise(resolve => setTimeout(resolve, 0)) }
const waitFor = async (check, label = 'condition', timeout = 3000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)) }
  throw new Error('waited for ' + label)
}

function fakeStorage(seed = {}) {
  const map = new Map(Object.entries(seed)), calls = []
  return {
    map, calls,
    getSetting: async key => { calls.push(['get', key]); return map.has(key) ? map.get(key) : null },
    setSetting: async (key, value) => {
      calls.push(['set', key])
      if (!/^[a-zA-Z0-9._-]{1,100}$/.test(key) || new TextEncoder().encode(value).length > 1024 * 1024) throw new Error('无效设置')
      map.set(key, value)
    },
    deleteSetting: async key => { calls.push(['delete', key]); map.delete(key) },
  }
}

function fakeClock(start = NOW) {
  let now = start
  let nextId = 0
  const timers = new Map()
  return {
    now: () => now,
    setTimer: (run, ms) => { const id = ++nextId; timers.set(id, { run, at: now + ms }); return id },
    clearTimer: id => { timers.delete(id) },
    timerCount: () => timers.size,
    async advance(ms) {
      now += ms
      for (let guard = 0; guard < 300; guard++) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at)
        if (!due.length) break
        for (const [id, timer] of due) { if (!timers.has(id)) continue; timers.delete(id); timer.run() }
        await settle()
      }
      await settle()
    },
  }
}

function fakeModel(handler) {
  const calls = []
  const call = async request => { calls.push(request); return handler(request, calls.length) }
  return { calls, call }
}

const docJson = JSON.stringify({ summary: '新综述', profile: { goals: ['g'], level: 'L' }, questions: [] })
const globalJson = JSON.stringify({ summary: '全局综述', profile: { goals: ['g'], level: 'L' }, themes: ['t'] })
const okModel = () => fakeModel(async request => request.kind === 'doc' ? docJson : globalJson)

const config = (configured = true) => ({ configured, presetTitle: '记忆管理', modelName: 'Flash', effort: 'low', effortName: '低', high: false, message: configured ? '' : '未配置记忆管理预设' })
const engines = []

function makeEngine({ storage = fakeStorage(), model = okModel(), configured = true } = {}) {
  const clock = fakeClock()
  const failures = []
  const notes = []
  const engine = createMemoryEngine({
    store: createMemoryStore(storage),
    callModel: model.call,
    configView: () => config(configured),
    notify: text => notes.push(text),
    foregroundBusy: () => false,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    reportFailure: (id, label, error, retry) => failures.push({ id, label, error, retry }),
    clearFailure: () => {},
  })
  engines.push(engine)
  return { engine, storage, clock, model, failures, notes }
}

function seedDoc(storage, docId, overrides = {}) {
  const memory = { ...emptyDocumentMemory(docId, overrides.title || ('书' + docId), NOW), ...overrides }
  storage.map.set(docMemoryKey(docId), JSON.stringify(memory))
  return memory
}
function seedIndex(storage, entries, extra = {}) {
  storage.map.set(MEMORY_KEYS.index, JSON.stringify({ version: 1, updatedAt: NOW, docs: entries, globalStale: false, docUpdatesSinceGlobal: 0, lastRun: null, ...extra }))
}
function seedGlobal(storage, overrides = {}) {
  const global = { ...emptyGlobalMemory(NOW), ...overrides }
  storage.map.set(MEMORY_KEYS.global, JSON.stringify(global))
  return global
}
const turn = (overrides = {}) => ({ type: 'assistant-turn', docId: 'd1', title: '书d1', conversationId: 'c1', question: '问题', answer: '回答', at: NOW, ...overrides })

beforeEach(() => { resetLearningEvents() })
afterEach(async () => {
  for (const engine of engines.splice(0)) { try { await engine.stop() } catch { /* 已停 */ } }
  resetLearningEvents()
})

test('engine: start only reads settings and the index', async () => {
  const { engine, storage } = makeEngine()
  await engine.start()
  await settle()
  const gets = storage.calls.filter(call => call[0] === 'get').map(call => call[1])
  assert.deepEqual(gets, [MEMORY_KEYS.settings, MEMORY_KEYS.index])
  assert.equal(engine.state.ready, true)
})

test('engine: events emitted before start are not lost', async () => {
  emitLearningEvent(turn())
  const { engine } = makeEngine()
  await engine.start()
  await settle()
  assert.equal(engine.state.index.docs.length, 1)
  assert.equal(engine.state.index.docs[0].pending, 1)
})

test('engine: a new question creates the document memory and persists it after the debounce', async () => {
  const { engine, storage } = makeEngine()
  await engine.start()
  emitLearningEvent(turn())
  await settle()
  assert.equal(engine.state.index.docs.length, 1)
  assert.equal(storage.map.has(docMemoryKey('d1')), false)
  await engine.flush()
  assert.equal(storage.map.has(docMemoryKey('d1')), true)
  assert.equal(storage.map.has(MEMORY_KEYS.index), true)
})

test('engine: reading events never create a memory', async () => {
  const { engine, storage } = makeEngine()
  await engine.start()
  emitLearningEvent({ type: 'reading', docId: 'd1', title: '书d1', page: 2, pageCount: 10, progress: 0.2, at: NOW })
  emitLearningEvent({ type: 'opened', docId: 'd1', title: '书d1', page: 1, pageCount: 10, progress: 0.1, at: NOW })
  await settle()
  assert.equal(engine.state.index.docs.length, 0)
  assert.equal(storage.calls.filter(call => call[0] === 'set').length, 0)
})

test('engine: three turns trigger one automatic summary after the debounce', async () => {
  const { engine, clock, model, storage } = makeEngine()
  await engine.start()
  for (const index of [0, 1, 2]) emitLearningEvent(turn({ question: `q${index}`, at: NOW + index }))
  await settle()
  await clock.advance(46_000)
  assert.equal(model.calls.length, 1)
  assert.equal(model.calls[0].system, DOCUMENT_SUMMARY_SYSTEM)
  const { memory } = await engine.loadDocument('d1')
  assert.equal(memory.pending.length, 0)
  assert.ok(memory.summarizedAt > 0)
  assert.equal(engine.state.index.globalStale, true)
  assert.equal(engine.state.index.docs[0].summarizedAt, memory.summarizedAt)
  assert.ok(storage.map.get(docMemoryKey('d1')).includes('新综述'))
})

test('engine: disabling automatic updates stops the scheduler', async () => {
  const { engine, clock, model } = makeEngine()
  await engine.start()
  await engine.setAutoUpdate(false)
  for (const index of [0, 1, 2, 3, 4]) emitLearningEvent(turn({ question: `q${index}` }))
  await settle()
  await clock.advance(10 * MINUTE)
  assert.equal(model.calls.length, 0)
  assert.equal((await engine.loadDocument('d1')).memory.pending.length, 5)
})

test('engine: manual summarization ignores the automatic-update switch', async () => {
  const { engine, clock, model } = makeEngine()
  await engine.start()
  await engine.setAutoUpdate(false)
  for (const index of [0, 1, 2]) emitLearningEvent(turn({ question: `q${index}` }))
  await settle()
  await clock.advance(MINUTE)
  assert.equal(model.calls.length, 0)
  const result = await engine.summarizeDocumentNow('d1')
  assert.deepEqual(result, { ok: true })
  assert.equal(model.calls.length, 1)
})

test('engine: no memory preset means no requests at all', async () => {
  const { engine, clock, model } = makeEngine({ configured: false })
  await engine.start()
  for (const index of [0, 1, 2, 3, 4]) emitLearningEvent(turn({ question: `q${index}` }))
  await settle()
  await clock.advance(10 * MINUTE)
  assert.equal(model.calls.length, 0)
  assert.deepEqual(await engine.summarizeDocumentNow('d1'), { ok: false, code: 'no-preset', message: '未配置记忆管理预设' })
})

test('engine: invalid JSON keeps the old memory and records a failure', async () => {
  const { engine, clock, storage } = makeEngine({ model: fakeModel(async () => '抱歉，我无法完成。') })
  await engine.start()
  for (const index of [0, 1, 2]) emitLearningEvent(turn({ question: `q${index}` }))
  await settle()
  await clock.advance(46_000)
  await settle()
  const { memory } = await engine.loadDocument('d1')
  assert.equal(memory.summary, '')
  assert.equal(memory.pending.length, 3)
  assert.equal(memory.status.state, 'failed')
  assert.equal(memory.status.failures, 1)
  assert.equal(engine.state.index.docs[0].failed, true)
  assert.equal(engine.state.index.lastRun.ok, false)
  assert.ok(storage.map.get(docMemoryKey('d1')).includes('"state":"failed"'))
})

test('engine: empty model output counts as a failure too', async () => {
  const { engine, clock } = makeEngine({ model: fakeModel(async () => '{"summary":"","profile":{}}') })
  await engine.start()
  for (const index of [0, 1, 2]) emitLearningEvent(turn({ question: `q${index}` }))
  await settle()
  await clock.advance(46_000)
  await settle()
  const { memory } = await engine.loadDocument('d1')
  assert.equal(memory.status.failures, 1)
  assert.equal(memory.pending.length, 3)
  assert.equal(engine.state.index.lastRun.error, '模型没有给出可用的记忆内容。')
})

test('engine: timeouts count as failures', async () => {
  const { MemoryError } = await import('../../src/memory/prompts.ts')
  const { engine, clock } = makeEngine({ model: fakeModel(async () => { throw new MemoryError('timeout', '记忆总结超时，已取消。') }) })
  await engine.start()
  for (const index of [0, 1, 2]) emitLearningEvent(turn({ question: `q${index}` }))
  await settle()
  await clock.advance(46_000)
  await settle()
  const { memory } = await engine.loadDocument('d1')
  assert.equal(memory.status.failures, 1)
})

test('engine: user cancellation does not count as failure', async () => {
  const model = fakeModel(request => new Promise((resolve, reject) => {
    request.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  }))
  const { engine } = makeEngine({ model })
  await engine.start()
  for (const index of [0, 1, 2]) emitLearningEvent(turn({ question: `q${index}` }))
  await settle()
  const pending = engine.summarizeDocumentNow('d1')
  await waitFor(() => model.calls.length === 1, 'model call')
  assert.equal(engine.state.running !== null, true)
  engine.cancelRun()
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.code, 'aborted')
  const { memory } = await engine.loadDocument('d1')
  assert.equal(memory.status.failures, 0)
  assert.equal(memory.pending.length, 3)
})

test('engine: a busy backend is not a failure and is retried later', async () => {
  let attempt = 0
  const model = fakeModel(async request => {
    attempt++
    if (attempt === 1) throw new Error('AI 请求过多，请稍后重试')
    return request.kind === 'doc' ? docJson : globalJson
  })
  const { engine, clock } = makeEngine({ model })
  await engine.start()
  for (const index of [0, 1, 2]) emitLearningEvent(turn({ question: `q${index}` }))
  await settle()
  await clock.advance(46_000)
  await settle()
  assert.equal(model.calls.length, 1)
  let loaded = (await engine.loadDocument('d1')).memory
  assert.equal(loaded.status.failures, 0)
  assert.equal(loaded.pending.length, 3)
  await clock.advance(61_000)
  await settle()
  assert.equal(model.calls.length, 2)
  loaded = (await engine.loadDocument('d1')).memory
  assert.equal(loaded.pending.length, 0)
})

test('engine: failures back off for five minutes, then retry', async () => {
  let attempt = 0
  const model = fakeModel(async request => {
    attempt++
    if (attempt === 1) throw new Error('网络错误')
    return request.kind === 'doc' ? docJson : globalJson
  })
  const { engine, clock } = makeEngine({ model })
  await engine.start()
  for (const index of [0, 1, 2]) emitLearningEvent(turn({ question: `q${index}`, at: NOW }))
  await settle()
  await clock.advance(46_000)
  await settle()
  assert.equal(model.calls.length, 1)
  assert.equal((await engine.loadDocument('d1')).memory.status.failures, 1)
  await clock.advance(4 * MINUTE)
  await settle()
  assert.equal(model.calls.length, 1)
  await clock.advance(2 * MINUTE)
  await settle()
  assert.equal(model.calls.length, 2)
  const { memory } = await engine.loadDocument('d1')
  assert.equal(memory.status.failures, 0)
  assert.equal(memory.summarizedAt > 0, true)
})

test('engine: three consecutive failures pause automatic updates for 30 minutes', async () => {
  const model = fakeModel(async () => { throw new Error('网络错误') })
  const { engine, storage } = makeEngine({ model })
  for (const docId of ['d1', 'd2', 'd3']) seedDoc(storage, docId, { onboarding: { docLevel: 2, fieldLevel: 2, note: '', answeredAt: NOW, source: 'import' } })
  await engine.start()
  for (const docId of ['d1', 'd2', 'd3']) assert.equal((await engine.summarizeDocumentNow(docId)).ok, false)
  assert.equal(engine.state.settings.consecutiveFailures, 3)
  assert.equal(engine.state.settings.pausedUntil, NOW + BREAKER_PAUSE_MS)
  emitLearningEvent(turn({ docId: 'd4', title: '书d4' }))
  await settle()
  const callsBefore = model.calls.length
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(model.calls.length, callsBefore)
  await engine.resumeAutoUpdate()
  assert.equal(engine.state.settings.pausedUntil, 0)
})

test('engine: the daily cap stops automatic runs but not manual ones', async () => {
  const storage = fakeStorage({ [MEMORY_KEYS.settings]: JSON.stringify(normalizeMemorySettings({ budget: { day: todayKey(NOW), runs: 40 } })) })
  const { engine, clock, model } = makeEngine({ storage })
  await engine.start()
  for (const index of [0, 1, 2]) emitLearningEvent(turn({ question: `q${index}` }))
  await settle()
  await clock.advance(10 * MINUTE)
  assert.equal(model.calls.length, 0)
  const result = await engine.summarizeDocumentNow('d1')
  assert.deepEqual(result, { ok: true })
  assert.equal(model.calls.length, 1)
  assert.equal(JSON.parse(storage.map.get(MEMORY_KEYS.settings)).budget.runs, 40)
})

test('engine: manual edits made during a request are not lost', async () => {
  let release
  const model = fakeModel(request => new Promise((resolve, reject) => {
    release = () => resolve(docJson)
    request.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  }))
  const storage = fakeStorage()
  const seeded = seedDoc(storage, 'd1', { revision: 5, pending: [{ id: 'a', kind: 'assistant-turn', at: NOW, question: 'q', answer: '' }] })
  const { engine } = makeEngine({ storage, model })
  await engine.start()
  const pending = engine.summarizeDocumentNow('d1')
  await waitFor(() => model.calls.length === 1, 'model started')
  const edited = await engine.editDocument('d1', { summary: '我写的' }, seeded.revision)
  assert.equal(edited.merged, false)
  release()
  assert.deepEqual(await pending, { ok: true })
  const { memory } = await engine.loadDocument('d1')
  assert.equal(memory.summary, '我写的')
  assert.deepEqual(memory.profile.goals, ['g'])
})

test('engine: questions arriving during a request are kept', async () => {
  let release
  const model = fakeModel(request => new Promise((resolve, reject) => {
    release = () => resolve(docJson)
    request.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  }))
  const storage = fakeStorage()
  seedDoc(storage, 'd1', { pending: [
    { id: 'a', kind: 'assistant-turn', at: NOW, question: 'qa', answer: '' },
    { id: 'b', kind: 'assistant-turn', at: NOW, question: 'qb', answer: '' },
    { id: 'c', kind: 'assistant-turn', at: NOW, question: 'qc', answer: '' },
  ] })
  const { engine } = makeEngine({ storage, model })
  await engine.start()
  const pending = engine.summarizeDocumentNow('d1')
  await waitFor(() => model.calls.length === 1, 'model started')
  emitLearningEvent(turn({ question: '新的问题' }))
  await settle()
  release()
  assert.deepEqual(await pending, { ok: true })
  const { memory } = await engine.loadDocument('d1')
  assert.equal(memory.pending.length, 1)
  assert.equal(memory.pending[0].question, '新的问题')
})

test('engine: editing with a stale revision reports merged', async () => {
  const storage = fakeStorage()
  seedDoc(storage, 'd1', { revision: 5 })
  const { engine } = makeEngine({ storage })
  await engine.start()
  const result = await engine.editDocument('d1', { summary: '我写的' }, 3)
  assert.equal(result.merged, true)
  assert.equal(result.memory.summary, '我写的')
  assert.equal(result.memory.manual.locked.summary > 0, true)
})

test('engine: onboarding is written immediately and never calls the model', async () => {
  const { engine, clock, model, storage } = makeEngine()
  await engine.start()
  emitLearningEvent({ type: 'onboarding', docId: 'd1', title: '书d1', answers: { docLevel: 3, fieldLevel: 2, note: 'n', answeredAt: NOW, source: 'import' }, importId: 'import12345678', at: NOW })
  await settle()
  await engine.flush()
  assert.equal(storage.map.has(docMemoryKey('d1')), true)
  assert.equal(engine.state.index.docs[0].hasOnboarding, true)
  await clock.advance(10 * MINUTE)
  assert.equal(model.calls.length, 0)
})

test('engine: removing a document cleans its key, index entry and global source', async () => {
  const storage = fakeStorage()
  seedDoc(storage, 'd1', { title: '书d1' })
  seedIndex(storage, [{ docId: 'd1', title: '书d1', updatedAt: NOW, summarizedAt: 0, pending: 0, dirty: false, hasOnboarding: false, failed: false }])
  seedGlobal(storage, { sources: [{ docId: 'd1', title: '书d1', summarizedAt: NOW, note: '' }, { docId: 'd2', title: '书d2', summarizedAt: NOW, note: '' }] })
  const { engine } = makeEngine({ storage })
  await engine.start()
  emitLearningEvent({ type: 'document-removed', docId: 'd1', title: '书d1', at: NOW })
  await settle()
  await engine.flush()
  assert.equal(storage.map.has(docMemoryKey('d1')), false)
  assert.equal(engine.state.index.docs.some(entry => entry.docId === 'd1'), false)
  assert.deepEqual(engine.state.global.sources.map(source => source.docId), ['d2'])
  assert.deepEqual(engine.state.global.removed, ['书d1'])
  assert.equal(engine.state.index.globalStale, true)
})

test('engine: removing a document under summarization aborts the request without a failure', async () => {
  const model = fakeModel(request => new Promise((resolve, reject) => {
    request.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  }))
  const storage = fakeStorage()
  seedDoc(storage, 'd1', { pending: [
    { id: 'a', kind: 'assistant-turn', at: NOW, question: 'q1', answer: '' },
    { id: 'b', kind: 'assistant-turn', at: NOW, question: 'q2', answer: '' },
    { id: 'c', kind: 'assistant-turn', at: NOW, question: 'q3', answer: '' },
  ] })
  const { engine } = makeEngine({ storage, model })
  await engine.start()
  const pending = engine.summarizeDocumentNow('d1')
  await waitFor(() => model.calls.length === 1, 'model started')
  emitLearningEvent({ type: 'document-removed', docId: 'd1', title: '书d1', at: NOW })
  await settle()
  const result = await pending
  assert.equal(result.code, 'aborted')
  assert.equal(storage.map.has(docMemoryKey('d1')), false)
  assert.equal(engine.state.global.status.failures, 0)
})

test('engine: pruning removes index entries for documents that left the library', async () => {
  const storage = fakeStorage()
  seedDoc(storage, 'a')
  seedDoc(storage, 'b')
  seedIndex(storage, [
    { docId: 'a', title: '书a', updatedAt: NOW, summarizedAt: 0, pending: 0, dirty: false, hasOnboarding: false, failed: false },
    { docId: 'b', title: '书b', updatedAt: NOW, summarizedAt: 0, pending: 0, dirty: false, hasOnboarding: false, failed: false },
  ])
  const { engine } = makeEngine({ storage })
  await engine.start()
  engine.syncDocuments([{ id: 'a', name: '书a', page: 1, pageCount: 1, progress: 0, lastOpenedAt: 0 }])
  await settle(20)
  assert.equal(storage.map.has(docMemoryKey('b')), false)
  assert.deepEqual(engine.state.index.docs.map(entry => entry.docId), ['a'])
})

test('engine: pruning also works when every document was removed', async () => {
  const storage = fakeStorage()
  seedDoc(storage, 'a')
  seedIndex(storage, [{ docId: 'a', title: '书a', updatedAt: NOW, summarizedAt: 0, pending: 0, dirty: false, hasOnboarding: false, failed: false }])
  const { engine } = makeEngine({ storage })
  await engine.start()
  engine.syncDocuments([])
  await settle(20)
  assert.equal(storage.map.has(docMemoryKey('a')), false)
  assert.equal(engine.state.index.docs.length, 0)
})

test('engine: a corrupt index is rebuilt by probing the document ids', async () => {
  const storage = fakeStorage({ [MEMORY_KEYS.index]: 'oops' })
  seedDoc(storage, 'a')
  const { engine } = makeEngine({ storage })
  await engine.start()
  assert.equal(engine.state.rebuilding, true)
  engine.syncDocuments([
    { id: 'a', name: '书a', page: 1, pageCount: 1, progress: 0, lastOpenedAt: 0 },
    { id: 'b', name: '书b', page: 1, pageCount: 1, progress: 0, lastOpenedAt: 0 },
  ])
  await settle(30)
  assert.deepEqual(engine.state.index.docs.map(entry => entry.docId), ['a'])
  assert.equal(engine.state.rebuilding, false)
  const gets = storage.calls.filter(call => call[0] === 'get').map(call => call[1])
  assert.ok(gets.includes(docMemoryKey('a')))
  assert.ok(gets.includes(docMemoryKey('b')))
})

test('engine: clearing the global memory deletes the key and does not regenerate it', async () => {
  const storage = fakeStorage()
  seedGlobal(storage, { summary: '旧全局' })
  const { engine, clock, model } = makeEngine({ storage })
  await engine.start()
  await engine.clearGlobal()
  await engine.flush()
  assert.equal(storage.map.has(MEMORY_KEYS.global), false)
  assert.equal(engine.state.index.globalStale, false)
  assert.equal(engine.state.index.docUpdatesSinceGlobal, 0)
  await clock.advance(HOUR)
  assert.equal(model.calls.length, 0)
})

test('engine: the global summary uses the global prompt and records sources', async () => {
  const storage = fakeStorage()
  for (const docId of ['a', 'b']) seedDoc(storage, docId, { summarizedAt: NOW, summary: '综述' + docId })
  seedIndex(storage, ['a', 'b'].map(docId => ({ docId, title: '书' + docId, updatedAt: NOW, summarizedAt: NOW, pending: 0, dirty: false, hasOnboarding: false, failed: false })), { globalStale: true, docUpdatesSinceGlobal: 2 })
  const { engine, model } = makeEngine({ storage })
  await engine.start()
  const result = await engine.summarizeGlobalNow()
  assert.deepEqual(result, { ok: true })
  assert.equal(model.calls[0].system, GLOBAL_SUMMARY_SYSTEM)
  assert.equal(engine.state.global.sources.length, 2)
  assert.equal(engine.state.index.globalStale, false)
  assert.equal(engine.state.index.docUpdatesSinceGlobal, 0)
})

test('engine: injectionFor returns the built injection or an empty one', async () => {
  const storage = fakeStorage()
  seedDoc(storage, 'd1', { summary: '综述', onboarding: { docLevel: 2, fieldLevel: 1, note: '', answeredAt: NOW, source: 'import' } })
  const { engine } = makeEngine({ storage })
  await engine.start()
  const doc = await engine.injectionFor({ kind: 'doc', docId: 'd1', title: '书d1' })
  assert.ok(doc.text.length > 0)
  assert.ok(doc.text.length <= 1500)
  assert.equal(doc.tag.injected, true)
  assert.deepEqual(await engine.injectionFor({ kind: 'none' }), { text: '', tag: { kind: 'none', injected: false, chars: 0 } })
  const missing = await engine.injectionFor({ kind: 'doc', docId: 'missing', title: '没有' })
  assert.deepEqual(missing, { text: '', tag: { kind: 'doc', docId: 'missing', title: '没有', injected: false, chars: 0 } })
})

test('engine: the first automatic summary explains itself once', async () => {
  const { engine, clock, notes } = makeEngine()
  await engine.start()
  assert.equal(engine.state.settings.noticeShown, false)
  for (const index of [0, 1, 2]) emitLearningEvent(turn({ question: `q${index}` }))
  await settle()
  await clock.advance(46_000)
  assert.equal(notes.length, 1)
  assert.equal(engine.state.settings.noticeShown, true)
  for (const index of [0, 1, 2]) emitLearningEvent(turn({ question: `r${index}`, at: NOW + 46_000 }))
  await settle()
  await clock.advance(646_000)
  assert.equal(notes.length, 1)
})

test('engine: freezing stops writes and aborts the running request', async () => {
  const model = fakeModel(request => new Promise((resolve, reject) => {
    request.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  }))
  const storage = fakeStorage()
  seedDoc(storage, 'd1', { pending: [{ id: 'a', kind: 'assistant-turn', at: NOW, question: 'q', answer: '' }] })
  const { engine } = makeEngine({ storage, model })
  await engine.start()
  const pending = engine.summarizeDocumentNow('d1')
  await waitFor(() => model.calls.length === 1, 'model started')
  engine.freeze()
  const result = await pending
  assert.equal(result.code, 'aborted')
  const writes = storage.calls.filter(call => call[0] === 'set').length
  emitLearningEvent(turn({ docId: 'd2', title: '书d2' }))
  await settle()
  assert.equal(storage.calls.filter(call => call[0] === 'set').length, writes)
  assert.equal(model.calls.length, 1)
})

test('engine: a failed write is reported and the memory stays in memory', async () => {
  const storage = fakeStorage()
  storage.setSetting = async () => { throw new Error('disk full') }
  const { engine, failures } = makeEngine({ storage })
  await engine.start()
  emitLearningEvent(turn())
  await settle()
  await engine.flush()
  assert.equal(failures.length >= 1, true)
  assert.ok(failures[0].id.startsWith('memory:'))
  const { memory } = await engine.loadDocument('d1')
  assert.equal(memory.pending.length, 1)
})
