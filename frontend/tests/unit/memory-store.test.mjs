import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryStore } from '../../src/memory/store.ts'
import { emptyDocumentMemory, emptyGlobalMemory, normalizeMemorySettings } from '../../src/memory/normalize.ts'
import { MEMORY_KEYS, docMemoryKey } from '../../src/memory/types.ts'
import { joinStorageGate, flushStorage, freezeStorage, unfreezeStorage } from '../../src/shared/storage-gate.ts'

const NOW = 1_700_000_000_000
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

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

test('store: document memory round-trips through the injected storage', async () => {
  const storage = fakeStorage()
  const store = createMemoryStore(storage)
  const memory = emptyDocumentMemory('d1', '书名', NOW)
  memory.revision = 3
  await store.saveDoc(memory)
  assert.ok(storage.map.get(docMemoryKey('d1')).includes('"docId":"d1"'))
  const loaded = await store.loadDoc('d1')
  assert.equal(loaded.newer, false)
  assert.deepEqual(loaded.memory, memory)
})

test('store: missing, broken and newer documents', async () => {
  const missing = await createMemoryStore(fakeStorage()).loadDoc('nope')
  assert.deepEqual(missing, { memory: null, newer: false })
  const broken = await createMemoryStore(fakeStorage({ 'memory.v1.doc.d1': '{bad' })).loadDoc('d1')
  assert.deepEqual(broken, { memory: null, newer: false })
  const newer = await createMemoryStore(fakeStorage({ 'memory.v1.doc.d1': '{"version":2,"docId":"d1"}' })).loadDoc('d1')
  assert.deepEqual(newer, { memory: null, newer: true })
})

test('store: index missing vs broken', async () => {
  const missing = await createMemoryStore(fakeStorage()).loadIndex()
  assert.deepEqual(missing, { version: 1, updatedAt: 0, docs: [], globalStale: false, docUpdatesSinceGlobal: 0, lastRun: null })
  const broken = await createMemoryStore(fakeStorage({ [MEMORY_KEYS.index]: 'oops' })).loadIndex()
  assert.equal(broken, null)
})

test('store: writes to the same key are serialized in call order', async () => {
  const storage = fakeStorage()
  const values = []
  storage.setSetting = async (key, value) => { values.push(JSON.parse(value).revision); await sleep(Math.random() * 10); storage.map.set(key, value) }
  const store = createMemoryStore(storage)
  const version = revision => ({ ...emptyDocumentMemory('d1', '书名', NOW), revision })
  await Promise.all([store.saveDoc(version(1)), store.saveDoc(version(2)), store.saveDoc(version(3))])
  await store.flush()
  assert.deepEqual(values, [1, 2, 3])
  assert.equal(JSON.parse(storage.map.get(docMemoryKey('d1'))).revision, 3)
})

test('store: a failed write does not block the next one', async () => {
  const storage = fakeStorage()
  let failed = false
  storage.setSetting = async (key, value) => {
    if (!failed) { failed = true; throw new Error('disk full') }
    storage.map.set(key, value)
  }
  const store = createMemoryStore(storage)
  const first = store.saveDoc({ ...emptyDocumentMemory('d1', '书', NOW), revision: 1 })
  const second = store.saveDoc({ ...emptyDocumentMemory('d1', '书', NOW), revision: 2 })
  await assert.rejects(first, /disk full/)
  await second
  assert.equal(JSON.parse(storage.map.get(docMemoryKey('d1'))).revision, 2)
})

test('store: oversized values are rejected before touching the storage', async () => {
  const storage = fakeStorage()
  const store = createMemoryStore(storage)
  const huge = { version: 1, docId: 'd1', blob: 'x'.repeat(300 * 1024) }
  await assert.rejects(store.saveDoc(huge), /超过本机保存上限/)
  assert.equal(storage.calls.length, 0)
})

test('store: freezing drops writes until unfrozen', async () => {
  const storage = fakeStorage()
  const store = createMemoryStore(storage)
  store.freeze()
  await store.saveDoc(emptyDocumentMemory('d1', '书', NOW))
  assert.equal(storage.map.has(docMemoryKey('d1')), false)
  store.unfreeze()
  await store.saveDoc(emptyDocumentMemory('d1', '书', NOW))
  assert.equal(storage.map.has(docMemoryKey('d1')), true)
})

test('store: freezing also drops a write already queued behind a slow one', async () => {
  const storage = fakeStorage()
  storage.setSetting = async (key, value) => { await sleep(20); storage.map.set(key, value) }
  const store = createMemoryStore(storage)
  const first = store.saveDoc({ ...emptyDocumentMemory('d1', '书', NOW), revision: 1 })
  await sleep(1)
  const second = store.saveDoc({ ...emptyDocumentMemory('d1', '书', NOW), revision: 2 })
  store.freeze()
  await Promise.allSettled([first, second])
  await store.flush()
  assert.equal(JSON.parse(storage.map.get(docMemoryKey('d1'))).revision, 1)
})

test('store: flush waits for pending writes; delete removes the key', async () => {
  const storage = fakeStorage()
  const store = createMemoryStore(storage)
  store.saveDoc(emptyDocumentMemory('d1', '书', NOW))
  store.saveGlobal(emptyGlobalMemory(NOW))
  await store.flush()
  assert.ok(storage.map.has(docMemoryKey('d1')))
  assert.ok(storage.map.has(MEMORY_KEYS.global))
  await store.deleteDoc('d1')
  assert.equal(storage.map.has(docMemoryKey('d1')), false)
  await store.deleteGlobal()
  assert.equal(storage.map.has(MEMORY_KEYS.global), false)
})

test('store: settings and global memory load with defaults', async () => {
  const store = createMemoryStore(fakeStorage())
  const settings = await store.loadSettings()
  assert.deepEqual(settings, normalizeMemorySettings({}))
  const global = await store.loadGlobal()
  assert.deepEqual(global.profile.goals, [])
  assert.equal(global.summary, '')
})

test('storage-gate: flushes, freezes and unfreezes every participant', async () => {
  const calls = []
  const offA = joinStorageGate({
    flush: async () => { calls.push('flush-a') },
    freeze: () => { calls.push('freeze-a') },
    unfreeze: () => { calls.push('unfreeze-a') },
  })
  const offB = joinStorageGate({
    flush: async () => { calls.push('flush-b'); throw new Error('boom') },
    freeze: () => { calls.push('freeze-b') },
    unfreeze: () => { throw new Error('boom'); },
  })
  await flushStorage()
  freezeStorage()
  unfreezeStorage()
  assert.deepEqual(calls.sort(), ['flush-a', 'flush-b', 'freeze-a', 'freeze-b', 'unfreeze-a'])
  offA(); offB()
  calls.length = 0
  await flushStorage()
  freezeStorage()
  unfreezeStorage()
  assert.deepEqual(calls, [])
})
