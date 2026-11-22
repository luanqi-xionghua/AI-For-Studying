import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createExamStore, emptyAnswers, normalizeExamAnswers, normalizeExamIndex, normalizeExamMeta,
} from '../../src/exam/storage.ts'
import { EXAM_KEYS, EXAM_LIMITS } from '../../src/exam/types.ts'
import { meta as sampleMeta, questions as sampleQuestions } from './fixtures/exam-sample.mjs'

const ID = '11111111-2222-3333-4444-555555555555'

function fakeStorage(seed = {}) {
  const data = new Map(Object.entries(seed))
  const calls = { get: 0, set: 0, del: 0 }
  return {
    data,
    calls,
    async getSetting(key) { calls.get += 1; return data.has(key) ? data.get(key) : null },
    async setSetting(key, value) { calls.set += 1; data.set(key, String(value)) },
    async deleteSetting(key) { calls.del += 1; data.delete(key) },
  }
}

function entry(id, status, updatedAt) {
  return {
    id, docId: 'doc-1', title: '高等数学（上）', docKind: 'pdf', createdAt: updatedAt - 1000,
    updatedAt, status, count: status === 'draft' ? 5 : 20, max: 200, answered: 0, score: null,
    template: 'A', grounded: true,
  }
}

test('storage: 键名合法且最长 49 个字符', () => {
  const keys = [EXAM_KEYS.index, EXAM_KEYS.brokenIndex, EXAM_KEYS.meta(ID), EXAM_KEYS.answers(ID)]
  for (let slot = 0; slot < 20; slot++) keys.push(EXAM_KEYS.question(ID, slot))
  assert.equal(Math.max(...keys.map(key => key.length)), 49)
  for (const key of keys) assert.match(key, /^[a-zA-Z0-9._-]{1,100}$/)
})

test('storage: 题目往返一致；超过 900 KiB 的值被拒且不发请求', async () => {
  const storage = fakeStorage()
  const store = createExamStore(storage)
  await store.saveQuestion(sampleQuestions[0])
  const loaded = await store.loadQuestion('exam-1', 0)
  assert.equal(loaded.stem, sampleQuestions[0].stem)
  assert.deepEqual(loaded.source.pages, sampleQuestions[0].source.pages)

  const before = storage.calls.set
  const huge = { ...sampleQuestions[1], stem: 'x'.repeat(EXAM_LIMITS.settingBytes) }
  await assert.rejects(() => store.saveQuestion(huge), /模拟测试的数据超过本机保存上限。/)
  assert.equal(storage.calls.set, before)
})

test('storage: 索引归一化（损坏 / 更新版本 / 去重 / 截 20）', () => {
  const broken = normalizeExamIndex(null)
  assert.equal(broken.broken, true)
  assert.deepEqual(broken.index.list, [])

  const newer = normalizeExamIndex({ version: 2, list: [] })
  assert.equal(newer.newer, true)

  const list = []
  for (let i = 0; i < 25; i++) list.push(entry(`id-${i % 22}`, 'taking', 1000 + i))
  const result = normalizeExamIndex({ version: 1, updatedAt: 5, activeId: 'id-3', list })
  assert.equal(result.index.list.length, 20)
  assert.equal(new Set(result.index.list.map(item => item.id)).size, 20)
  assert.ok(result.index.list[0].updatedAt >= result.index.list[1].updatedAt)
  assert.equal(result.index.activeId, 'id-3')
})

test('storage: meta 归一化（slots 必须是 20 个 / batches 补齐 4 个）', () => {
  assert.equal(normalizeExamMeta({ ...sampleMeta, slots: sampleMeta.slots.slice(0, 19) }, sampleMeta.id), null)
  assert.equal(normalizeExamMeta({ ...sampleMeta, version: 2 }, sampleMeta.id), 'newer')
  assert.equal(normalizeExamMeta({ ...sampleMeta, id: 'other' }, sampleMeta.id), null)

  const normalized = normalizeExamMeta({ ...sampleMeta, batches: [{ index: 0, status: 'ok' }] }, sampleMeta.id)
  assert.equal(normalized.batches.length, 4)
  assert.equal(normalized.batches[0].status, 'ok')
  assert.equal(normalized.batches[3].status, 'pending')
})

test('storage: 作答归一化（只留 A–D、自评分范围）', () => {
  const answers = emptyAnswers('exam-1')
  answers.items['0'] = { choice: ['A', 'A', 'E', 'c'], revealed: true, revealedAt: 5, selfScore: 11 }
  const normalized = normalizeExamAnswers({ ...answers, examId: 'exam-1' }, 'exam-1')
  assert.equal(normalized.broken, false)
  assert.deepEqual(normalized.answers.items['0'].choice, ['A', 'C'])
  assert.equal(normalized.answers.items['0'].selfScore, null)
  assert.equal(normalizeExamAnswers(null, 'exam-1').broken, true)
  const wrongId = normalizeExamAnswers({ ...answers, examId: 'x' }, 'exam-1')
  assert.equal(wrongId.broken, true)
  assert.deepEqual(wrongId.answers.items, {})
})

test('storage: 超过 20 套时淘汰最早交卷的一套并删 22 个键', async () => {
  const storage = fakeStorage()
  const store = createExamStore(storage)
  const list = []
  for (let i = 0; i < 20; i++) list.push(entry(`id-${i}`, i % 3 === 0 ? 'done' : i % 3 === 1 ? 'draft' : 'taking', 1000 + i))
  await store.saveIndex({ version: 1, updatedAt: 1, activeId: '', list })

  const victim = list[0]
  for (const key of [EXAM_KEYS.meta(victim.id), EXAM_KEYS.answers(victim.id)]) await storage.setSetting(key, '{}')
  for (let slot = 0; slot < 20; slot++) await storage.setSetting(EXAM_KEYS.question(victim.id, slot), '{}')

  const removed = await store.evictForRoom('new-id', 'id-1')
  assert.deepEqual(removed, [victim.id])
  const index = (await store.loadIndex()).index
  assert.equal(index.list.length, 19)
  assert.equal(index.list.some(item => item.id === victim.id), false)
  assert.equal(index.list.some(item => item.id === 'id-1'), true)
  for (const key of [EXAM_KEYS.meta(victim.id), EXAM_KEYS.answers(victim.id)]) {
    assert.equal(storage.data.has(key), false)
  }
  for (let slot = 0; slot < 20; slot++) assert.equal(storage.data.has(EXAM_KEYS.question(victim.id, slot)), false)
})

test('storage: 两个并发的 saveEntry 都写进索引', async () => {
  const storage = fakeStorage()
  const store = createExamStore(storage)
  await Promise.all([
    store.saveEntry(entry('a', 'taking', 1000)),
    store.saveEntry(entry('b', 'taking', 2000)),
  ])
  const index = (await store.loadIndex()).index
  assert.deepEqual(index.list.map(item => item.id).sort(), ['a', 'b'])
})

test('storage: freeze 期间跳过写入，unfreeze 后恢复', async () => {
  const storage = fakeStorage()
  const store = createExamStore(storage)
  const answers = emptyAnswers('exam-1')
  store.freeze()
  await store.saveAnswers(answers)
  assert.equal(storage.data.has(EXAM_KEYS.answers('exam-1')), false)
  assert.equal(storage.calls.set, 0)
  store.unfreeze()
  await store.saveAnswers(answers)
  assert.equal(storage.data.has(EXAM_KEYS.answers('exam-1')), true)
})

test('storage: 加载时删掉不在 ok 批里的孤儿题', async () => {
  const storage = fakeStorage()
  const store = createExamStore(storage)
  const meta = {
    ...sampleMeta,
    batches: [0, 1, 2, 3].map(index => ({
      index, status: index === 0 ? 'ok' : 'pending', attempts: 0, error: '', finishedAt: 0,
    })),
  }
  await store.saveMeta(meta)
  await store.saveQuestion(sampleQuestions[0])
  await store.saveQuestion(sampleQuestions[1])
  const loaded = await store.loadExam(sampleMeta.id)
  assert.deepEqual(loaded.questions.map(question => question.slot), [0])
  assert.equal(storage.data.has(EXAM_KEYS.question(sampleMeta.id, 1)), false)
  assert.deepEqual(loaded.missingSlots, [4, 8, 12, 16])
})
