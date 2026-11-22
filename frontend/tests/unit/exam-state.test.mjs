import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createExamState } from '../../src/exam/state.ts'
import { createExamStore } from '../../src/exam/storage.ts'
import { EXAM_CHOICE_KEY } from '../../src/exam/choice.ts'
import { EXAM_KEYS } from '../../src/exam/types.ts'
import { scoreExam } from '../../src/exam/scoring.ts'
import { DOC_ID, EXAM_ID, NOW, emptyAnswers, meta as sampleMeta, questions } from './fixtures/exam-sample.mjs'

function memoryStorage() {
  const data = new Map()
  return {
    data,
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  }
}

function fakeStorage(seed = {}) {
  const data = new Map(Object.entries(seed))
  const writes = []
  return {
    data,
    writes,
    async getSetting(key) { return data.has(key) ? data.get(key) : null },
    async setSetting(key, value) {
      writes.push(key)
      data.set(key, String(value))
    },
    async deleteSetting(key) { data.delete(key) },
  }
}

const FULL_META = {
  ...sampleMeta,
  batches: [0, 1, 2, 3].map(index => ({ index, status: 'ok', attempts: 1, error: '', finishedAt: NOW })),
}

function indexEntry(status, extra = {}) {
  return {
    id: EXAM_ID, docId: DOC_ID, title: sampleMeta.docTitle, docKind: 'pdf',
    createdAt: NOW, updatedAt: NOW, status, count: 20, max: 200, answered: 0,
    score: status === 'done' ? 37 : null, template: 'A', grounded: true, ...extra,
  }
}

async function seedExam(store, { status = 'taking', submitted = false, meta = FULL_META, answers = null } = {}) {
  await store.saveMeta(meta)
  for (const question of questions) await store.saveQuestion(question)
  const value = answers || (submitted
    ? { ...emptyAnswers(), submittedAt: NOW, result: scoreExam(questions, emptyAnswers()) }
    : emptyAnswers())
  await store.saveAnswers(value)
  await store.saveEntry(indexEntry(status), meta.id)
  return value
}

function makeHarness(options = {}) {
  const storage = fakeStorage(options.seed)
  const store = createExamStore(storage)
  const emitted = []
  const notifications = []
  const timers = []
  const choiceStorage = memoryStorage()
  let clock = NOW
  let settings = options.settings || {
    presets: [{ id: 'p-1', name: 'DeepSeek', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', protocol: 'chat', model: 'deepseek-chat', effort: 'medium' }],
    assistantPreset: 'p-1',
  }
  const documents = options.documents || [{ id: DOC_ID, title: sampleMeta.docTitle, kind: 'pdf', pageCount: 412, sourceMissing: false }]
  const deps = {
    store,
    plan: async () => ({ ok: false, code: 'model', error: 'not-used' }),
    batch: async () => ({ ok: false, errors: ['not-used'], reason: 'not-used' }),
    openSource: async () => ({ context: {}, close() {} }),
    memory: async () => '',
    emit: event => emitted.push(event),
    exportMarkdown: async () => ({ cancelled: true }),
    settings: () => settings,
    choiceStorage,
    notify: message => notifications.push(message),
    reportFailure: () => {},
    clearFailure: () => {},
    setBusy: () => {},
    now: () => clock,
    uuid: () => `${EXAM_ID}-new`,
    setTimer: (fn, ms) => { const id = Symbol(); timers.push({ id, fn, ms }); return id },
    clearTimer: id => {
      const index = timers.findIndex(timer => timer.id === id)
      if (index >= 0) timers.splice(index, 1)
    },
  }
  const api = createExamState(deps)
  api.setDocuments(documents)
  return {
    api, deps, store, storage, emitted, notifications, timers, choiceStorage,
    setSettings: next => { settings = next; api.refreshSettings() },
    setDocuments: list => api.setDocuments(list),
    setClock: value => { clock = value },
    runTimers() {
      const due = timers.splice(0)
      for (const timer of due) timer.fn()
    },
    answerWrites: () => storage.writes.filter(key => key === EXAM_KEYS.answers(EXAM_ID)).length,
  }
}

test('state: 空存储 init 后进入准备区', async () => {
  const h = makeHarness()
  await h.api.init()
  assert.equal(h.api.view.value, 'setup')
  assert.equal(h.api.state.ready, true)
  assert.deepEqual(h.api.state.list, [])
})

test('state: startBlocker 四种文案', async () => {
  const h = makeHarness()
  h.setDocuments([{ id: DOC_ID, title: '高数', kind: 'pdf', pageCount: 100, sourceMissing: false }])
  await h.api.init()
  assert.equal(h.api.startBlocker.value, '先选一本书。')

  h.api.selectDocument(DOC_ID)
  h.setDocuments([{ id: DOC_ID, title: '高数', kind: 'pdf', pageCount: 100, sourceMissing: true }])
  assert.equal(h.api.startBlocker.value, '原文件已移动，请先在文档库里重新定位。')

  h.setDocuments([{ id: DOC_ID, title: '高数', kind: 'pdf', pageCount: 100, sourceMissing: false }])
  h.setSettings({ presets: [] })
  assert.equal(h.api.startBlocker.value, '还没有模型预设：请先在 设置 → AI 里点「新建预设」添加一个。')

  h.setSettings({ presets: [{ id: 'p-1', name: 'x', provider: 'deepseek', baseUrl: 'https://x', protocol: 'chat', model: '', effort: '' }] })
  assert.equal(h.api.startBlocker.value, '模拟测试用的模型预设没有选模型：请点模型按钮选一个。')

  h.setSettings({ presets: [{ id: 'p-1', name: 'x', provider: 'deepseek', baseUrl: 'https://x', protocol: 'chat', model: 'deepseek-chat', effort: 'medium' }] })
  assert.equal(h.api.startBlocker.value, '')
  h.api.state.generation.running = true
  assert.equal(h.api.startBlocker.value, '正在给另一套试卷出题，请等它完成或先停止。')
})

test('state: 客观题展开后锁定；大题未展开不接受自评', async () => {
  const h = makeHarness()
  await h.api.init()
  await seedExam(h.store)
  await h.api.open(EXAM_ID)
  assert.equal(h.api.view.value, 'taking')

  h.api.reveal(0)
  h.api.choose(0, 'A')
  assert.deepEqual(h.api.state.current.answers.items['0'].choice, [])
  assert.equal(h.api.state.current.answers.items['0'].revealed, true)

  h.api.selfScore(14, 7)
  assert.equal(h.api.state.current.answers.items['14'].selfScore, null)
  h.api.reveal(14)
  h.api.selfScore(14, 7)
  assert.equal(h.api.state.current.answers.items['14'].selfScore, 7)
})

test('state: 400 ms 内三次作答只写一次 answers', async () => {
  const h = makeHarness()
  await h.api.init()
  await seedExam(h.store)
  await h.api.open(EXAM_ID)
  const before = h.answerWrites()

  h.api.choose(0, 'A')
  h.api.choose(0, 'B')
  h.api.choose(1, 'C')
  assert.equal(h.timers.length, 1)
  assert.equal(h.answerWrites(), before)
  h.runTimers()
  await h.store.flush()
  assert.equal(h.answerWrites(), before + 1)
})

test('state: 连点交卷只提交一次，memory.want 默认开', async () => {
  const h = makeHarness()
  await h.api.init()
  await seedExam(h.store)
  await h.api.open(EXAM_ID)
  const before = h.answerWrites()

  await Promise.all([h.api.submit(), h.api.submit()])
  assert.equal(h.answerWrites(), before + 1)
  assert.equal(h.api.view.value, 'result')
  assert.equal(h.api.state.current.answers.memory.want, true)
  assert.ok(h.api.state.current.answers.result)
  assert.equal(h.api.state.current.answers.result.max, 200)
})

test('state: 结果页可以改大题自评，离开结果页后只读', async () => {
  const h = makeHarness()
  await h.api.init()
  await seedExam(h.store)
  await h.api.open(EXAM_ID)
  h.api.reveal(14)
  h.api.selfScore(14, 7)
  await h.api.submit()
  assert.equal(h.api.state.current.answers.result.total, 7)

  h.api.selfScore(14, 9)
  assert.equal(h.api.state.current.answers.result.total, 9)
  await h.store.flush()
  const saved = await h.store.loadAnswers(EXAM_ID)
  assert.equal(saved.answers.result.total, 9)

  await h.api.finalize()
  h.api.selfScore(14, 5)
  assert.equal(h.api.state.current.answers.result.total, 9)
  await h.api.open(EXAM_ID)
  assert.equal(h.api.state.current.readOnly, true)
})

test('state: 取消勾选后 finalize 不写记忆', async () => {
  const h = makeHarness()
  await h.api.init()
  await seedExam(h.store)
  await h.api.open(EXAM_ID)
  await h.api.submit()
  await h.api.setMemoryWant(false)
  await h.api.finalize()
  assert.equal(h.emitted.length, 0)
  assert.equal(h.api.state.current.answers.memory.skipped, 'unchecked')
  assert.ok(h.api.state.current.answers.finalizedAt > 0)
})

test('state: finalize 幂等，事件里没有题干 / 选项 / 答案原文', async () => {
  const h = makeHarness()
  await h.api.init()
  await seedExam(h.store)
  await h.api.open(EXAM_ID)
  await h.api.submit()
  await h.api.finalize()
  await h.api.finalize()
  assert.equal(h.emitted.length, 1)
  const event = h.emitted[0]
  assert.equal(event.type, 'quiz-result')
  assert.equal(event.selfAssessed, true)
  assert.equal(event.max, 200)
  const json = JSON.stringify(event)
  for (const question of questions) {
    assert.equal(json.includes(question.stem), false)
    for (const option of question.options) assert.equal(json.includes(option.text), false)
  }
})

test('state: 书被移出文档库后交卷不写记忆', async () => {
  const h = makeHarness()
  await h.api.init()
  await seedExam(h.store)
  h.api.setDocuments([])
  await h.api.open(EXAM_ID)
  await h.api.submit()
  assert.equal(h.api.state.current.answers.memory.skipped, 'doc-removed')
  await h.api.finalize()
  assert.equal(h.emitted.length, 0)
})

test('state: init 把 running 批改成 stopped，并补发结果页的记忆', async () => {
  const h = makeHarness()
  const runningMeta = { ...FULL_META, batches: FULL_META.batches.map(batch => (batch.index === 2 ? { ...batch, status: 'running' } : batch)) }
  await h.store.saveMeta(runningMeta)
  await h.store.saveQuestion(questions[0])
  await h.store.saveAnswers(emptyAnswers())
  await h.store.saveEntry(indexEntry('draft', { count: 1 }), EXAM_ID)
  await h.api.init()
  const meta = await h.store.loadMeta(EXAM_ID)
  assert.equal(meta.batches[2].status, 'stopped')
  assert.equal(meta.batches[0].status, 'ok')

  const doneStore = createExamStore(fakeStorage())
  const answers = { ...emptyAnswers(), submittedAt: NOW, result: scoreExam(questions, emptyAnswers()) }
  await doneStore.saveMeta(FULL_META)
  for (const question of questions) await doneStore.saveQuestion(question)
  await doneStore.saveAnswers(answers)
  await doneStore.saveEntry(indexEntry('done'), EXAM_ID)

  const h2 = makeHarness()
  const emitted2 = []
  const api2 = createExamState({ ...h2.deps, store: doneStore, emit: event => emitted2.push(event) })
  api2.setDocuments([{ id: DOC_ID, title: sampleMeta.docTitle, kind: 'pdf', pageCount: 412, sourceMissing: false }])
  await api2.init()
  assert.equal(emitted2.length, 1)
  const saved = await doneStore.loadAnswers(EXAM_ID)
  assert.ok(saved.answers.finalizedAt > 0)
})

test('state: setChoice 写入模拟测试自己的键，不影响对话模式', async () => {
  const h = makeHarness()
  await h.api.init()
  h.api.setChoice({ version: 1, preset: 'p-9', scope: 's', model: 'm', effort: 'high' })
  const raw = h.choiceStorage.data.get(EXAM_CHOICE_KEY)
  assert.ok(raw)
  const parsed = JSON.parse(raw)
  assert.equal(parsed.preset, 'p-9')
  assert.equal(parsed.model, 'm')
  assert.equal(h.choiceStorage.data.has('kaizhi.chatmode.choice.v1'), false)
})
