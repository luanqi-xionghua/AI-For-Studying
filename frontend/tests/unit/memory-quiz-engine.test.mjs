// 记忆引擎的 quiz-result 分支（1.2.6 补的引擎级用例）：经事件总线进入引擎，文档与全局各写一条，
// 重复事件幂等，全局读失败不影响文档，normalize 两次结果不变。
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryEngine } from '../../src/memory/engine.ts'
import { createMemoryStore } from '../../src/memory/store.ts'
import { emitLearningEvent, resetLearningEvents } from '../../src/memory/events.ts'
import { normalizeDocumentMemory, normalizeGlobalMemory } from '../../src/memory/normalize.ts'
import { MEMORY_KEYS, docMemoryKey } from '../../src/memory/types.ts'

const NOW = 1_764_000_000_000
const settle = async (rounds = 12) => { for (let index = 0; index < rounds; index++) await new Promise(resolve => setTimeout(resolve, 0)) }

function fakeStorage({ failGet = new Set() } = {}) {
  const map = new Map()
  return {
    map,
    getSetting: async key => {
      if (failGet.has(key)) throw new Error('读取失败')
      return map.has(key) ? map.get(key) : null
    },
    setSetting: async (key, value) => { map.set(key, value) },
    deleteSetting: async key => { map.delete(key) },
  }
}

const engines = []
function makeEngine(storage = fakeStorage()) {
  let nextId = 0
  const calls = []
  const engine = createMemoryEngine({
    store: createMemoryStore(storage),
    callModel: async request => { calls.push(request); return '{}' },
    configView: () => ({ configured: true, presetTitle: '记忆管理', modelName: 'Flash', effort: 'low', effortName: '低', high: false, message: '' }),
    notify: () => {},
    foregroundBusy: () => false,
    now: () => NOW,
    setTimer: () => ++nextId,
    clearTimer: () => {},
    reportFailure: () => {},
    clearFailure: () => {},
  })
  engines.push(engine)
  return { engine, storage, calls }
}

const EVENT = {
  type: 'quiz-result', docId: 'doc-1', title: '高等数学（上）', examId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  total: 142, max: 200,
  byType: { single: { score: 80, max: 100 }, multiple: { score: 25, max: 40 }, essay: { score: 37, max: 60 } },
  weak: [{ tag: '泰勒公式', lost: 15 }], selfAssessed: true, note: '未作答 2 题', at: NOW,
}

const readDoc = storage => JSON.parse(storage.map.get(docMemoryKey('doc-1')))
const readGlobal = storage => JSON.parse(storage.map.get(MEMORY_KEYS.global))

beforeEach(() => { resetLearningEvents() })
afterEach(async () => {
  for (const engine of engines.splice(0)) { try { await engine.stop() } catch { /* 已停 */ } }
  resetLearningEvents()
})

test('memory quiz engine: 一条 quiz-result 同时写进文档与全局，不调用模型', async () => {
  const { engine, storage, calls } = makeEngine()
  await engine.start()
  emitLearningEvent(EVENT)
  await settle()
  await engine.flush()
  const doc = readDoc(storage)
  assert.deepEqual(doc.pending.map(item => [item.kind, item.turnId]), [['quiz-result', `exam:${EVENT.examId}`]])
  assert.deepEqual(doc.evidence.map(item => item.kind), ['quiz'])
  assert.ok(doc.pending[0].question.includes('自评 142/200'))
  assert.ok(doc.pending[0].answer.includes('泰勒公式'))
  const global = readGlobal(storage)
  assert.deepEqual(global.pending.map(item => item.turnId), [`exam:${EVENT.examId}`])
  assert.equal(global.evidence[0].ref, '模拟测试 · 《高等数学（上）》')
  assert.equal(engine.state.index.docs.find(entry => entry.docId === 'doc-1').pending, 1)
  assert.equal(calls.length, 0)
})

test('memory quiz engine: 同一套试卷的事件重复到达也只留一条（文档与全局）', async () => {
  const { engine, storage } = makeEngine()
  await engine.start()
  emitLearningEvent(EVENT)
  emitLearningEvent({ ...EVENT, at: NOW + 1000 })
  await settle()
  await engine.flush()
  assert.equal(readDoc(storage).pending.length, 1)
  assert.equal(readDoc(storage).evidence.length, 1)
  assert.equal(readGlobal(storage).pending.length, 1)
  assert.equal(readGlobal(storage).evidence.length, 1)
  // 另一套试卷是另一条。
  emitLearningEvent({ ...EVENT, examId: 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee' })
  await settle()
  await engine.flush()
  assert.equal(readDoc(storage).pending.length, 2)
  assert.equal(readGlobal(storage).evidence.length, 2)
})

test('memory quiz engine: 全局记忆读失败时文档照写，且不会用空记忆覆盖全局', async () => {
  const storage = fakeStorage({ failGet: new Set([MEMORY_KEYS.global]) })
  const { engine } = makeEngine(storage)
  await engine.start()
  emitLearningEvent(EVENT)
  await settle()
  await engine.flush()
  assert.equal(readDoc(storage).pending.length, 1)
  assert.equal(storage.map.has(MEMORY_KEYS.global), false)
})

test('memory quiz engine: 含 quiz 记录的记忆 normalize 两次结果不变', async () => {
  const { engine, storage } = makeEngine()
  await engine.start()
  emitLearningEvent(EVENT)
  await settle()
  await engine.flush()
  const doc = readDoc(storage)
  const once = normalizeDocumentMemory(doc, 'doc-1')
  assert.deepEqual(normalizeDocumentMemory(JSON.parse(JSON.stringify(once)), 'doc-1'), once)
  assert.equal(once.pending[0].kind, 'quiz-result')
  assert.equal(once.evidence[0].kind, 'quiz')
  const global = normalizeGlobalMemory(readGlobal(storage))
  assert.deepEqual(normalizeGlobalMemory(JSON.parse(JSON.stringify(global))), global)
})
