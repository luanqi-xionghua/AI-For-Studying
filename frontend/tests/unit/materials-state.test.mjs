import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMaterialsState } from '../../src/materials/state.ts'
import { MATERIALS_LIMITS, friendlyMaterialError, MATERIALS_STORAGE_KEY } from '../../src/materials/types.ts'

const emptyStatus = () => ({
  state: 'empty', total: 0, raw: 0, syncedAt: 0, attemptedAt: 0,
  stale: false, syncing: false, recovered: false, sources: [],
})
const readyStatus = (extra = {}) => ({ ...emptyStatus(), state: 'ready', total: 2982, syncedAt: Date.now(), ...extra })

function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed))
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
    data,
  }
}

function hit(id, title, extra = {}) {
  return {
    id, title, course: '计算机网络', courseKey: '计算机网络', category: '', ext: 'pdf',
    format: 'PDF', size: 1024, count: 1, year: null, source: 'openise',
    url: `https://github.com/x/${id}`, links: [{ id, source: 'openise', label: 'OpenISE', host: 'github.com' }],
    owned: null, score: 1, coverage: 1, intents: ['exam'], ...extra,
  }
}

function searchResult(query, hits, extra = {}) {
  return {
    query, normalized: query, found: hits.length > 0, reason: hits.length ? '' : 'low-coverage',
    courses: [{ text: '计算机网络', key: '计算机网络' }], intents: ['exam'],
    content: [], library: [], results: hits, total: hits.length,
    tookMs: 1, indexSyncedAt: Date.now(), hints: [], ...extra,
  }
}

function makeHarness(options = {}) {
  const calls = { status: 0, sync: 0, cancel: 0, clear: 0, search: [], open: [] }
  let statusValue = null
  const readStatus = () => (options.status ? options.status() : (statusValue ?? emptyStatus()))
  const state = createMaterialsState({
    client: {
      async status() { calls.status += 1; return readStatus() },
      async sync(onProgress) { calls.sync += 1; return options.sync ? options.sync(onProgress) : { ok: true, partial: false, total: 1, raw: 1, syncedAt: Date.now(), tookMs: 1, sources: [] } },
      async cancel() { calls.cancel += 1; return options.cancel ? options.cancel() : { cancelled: true } },
      async search(query, limit) { calls.search.push([query, limit]); return options.search ? options.search(query) : searchResult(query, [hit('a', '试卷4')]) },
      async open(id) { calls.open.push(id); return { opened: true, host: 'github.com' } },
      async clear() { calls.clear += 1; return { cleared: true } },
    },
    rerank: options.rerank,
    rewrite: options.rewrite,
    rerankAvailable: options.rerankAvailable || (() => ({ ok: false, reason: 'no-preset' })),
    storage: options.storage || memoryStorage(),
    now: () => Date.now(),
  })
  return { state, calls, setStatus: value => { statusValue = value } }
}

test('materials state: 未同步时是 unsynced，偏好为默认值', async () => {
  const { state } = makeHarness()
  await state.init()
  assert.equal(state.view.value, 'unsynced')
  assert.deepEqual(JSON.parse(JSON.stringify(state.state.prefs)), { recent: [], aiRerank: true, preferMirror: false })
  state.dispose()
})

test('materials state: 坏的本地存储回落到默认值', async () => {
  const { state } = makeHarness({ storage: memoryStorage({ [MATERIALS_STORAGE_KEY]: '{bad' }) })
  await state.init()
  assert.deepEqual(state.state.prefs.recent, [])
  assert.equal(state.state.prefs.aiRerank, true)
  state.dispose()
})

test('materials state: 空查询不发请求', async () => {
  const { state, calls } = makeHarness()
  await state.init()
  await state.submit('   ')
  assert.equal(calls.search.length, 0)
  state.dispose()
})

test('materials state: 查询竞态只保留最后一次结果', async () => {
  let release
  const slow = new Promise(resolve => { release = resolve })
  const { state } = makeHarness({
    search: query => (query === 'A'
      ? slow.then(() => searchResult('A', [hit('a', 'A 结果')]))
      : Promise.resolve(searchResult('B', [hit('b', 'B 结果')]))),
  })
  await state.init()
  const first = state.submit('A')
  await state.submit('B')
  release()
  await first
  assert.equal(state.state.search.result.query, 'B')
  assert.equal(state.state.search.result.results[0].id, 'b')
  state.dispose()
})

test('materials state: 最近搜索去重并限制条数', async () => {
  const storage = memoryStorage()
  const { state } = makeHarness({ storage })
  await state.init()
  for (let i = 0; i < 10; i += 1) await state.submit(`查询${i}`)
  await state.submit('查询2')
  assert.equal(state.state.prefs.recent.length, MATERIALS_LIMITS.recent)
  assert.equal(state.state.prefs.recent[0], '查询2')
  const saved = JSON.parse(storage.data.get(MATERIALS_STORAGE_KEY))
  assert.equal(saved.version, 1)
  assert.equal(saved.recent[0], '查询2')
  state.dispose()
})

test('materials state: 同步进度与完成', async () => {
  const events = []
  let status = emptyStatus()
  const { state } = makeHarness({
    status: () => status,
    sync: async onProgress => {
      onProgress({ type: 'progress', phase: 'start', done: 0, total: 58, message: '正在连接资料来源…' })
      onProgress({ type: 'progress', phase: 'fetch', done: 12, total: 58, message: '正在读取破壁计划资料列表 12 / 54' })
      onProgress({ type: 'progress', phase: 'store', done: 58, total: 58, message: '正在写入本机索引…' })
      events.push(state.state.sync.done)
      assert.equal(state.state.sync.committing, true)
      status = readyStatus()
      return { ok: true, partial: false, total: 2982, raw: 4738, syncedAt: Date.now(), tookMs: 8, sources: [] }
    },
  })
  await state.init()
  assert.equal(state.view.value, 'unsynced')
  await state.startSync()
  assert.equal(events[0], 58)
  assert.equal(state.state.sync.committing, false)
  assert.equal(state.state.sync.running, false)
  assert.equal(state.view.value, 'idle')
  state.dispose()
})

test('materials state: 连点同步只发起一次', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const { state, calls } = makeHarness({ sync: () => gate.then(() => ({ ok: true, partial: false, total: 0, raw: 0, syncedAt: Date.now(), tookMs: 1, sources: [] })) })
  await state.init()
  const first = state.startSync()
  void state.startSync()
  release()
  await first
  assert.equal(calls.sync, 1)
  state.dispose()
})

test('materials state: 取消同步给出提示并保留旧索引', async () => {
  const { state, setStatus } = makeHarness({
    status: () => readyStatus(),
    sync: () => Promise.reject(new Error('MAT_CANCELLED：已取消同步')),
    cancel: () => ({ cancelled: true }),
  })
  await state.init()
  const pending = state.startSync()
  await state.cancelSync()
  await pending
  assert.equal(state.state.sync.error, '已取消同步，继续使用原来的索引。')
  assert.equal(state.state.status.state, 'ready')
  state.dispose()
})

test('materials state: 写库阶段不可取消', async () => {
  const { state } = makeHarness({
    status: () => readyStatus(),
    sync: () => new Promise(() => {}),
    cancel: () => ({ cancelled: false, reason: 'committing' }),
  })
  await state.init()
  void state.startSync()
  await state.cancelSync()
  assert.equal(state.state.sync.cancelling, false)
  assert.equal(state.state.sync.committing, true)
  state.dispose()
})

test('materials state: 同步失败仍可搜索并给出横幅', async () => {
  const { state } = makeHarness({
    status: () => readyStatus(),
    sync: () => Promise.reject(new Error('MAT_NETWORK：连不上资料来源，请检查网络后重试')),
  })
  await state.init()
  await state.startSync()
  assert.equal(state.view.value, 'idle')
  assert.ok(state.state.sync.error.includes('已有的索引仍可继续搜索'))
  assert.equal(state.banner.value.kind, 'failed')
  state.dispose()
})

test('materials state: 没有预设时不做重排', async () => {
  let rerankCalls = 0
  const { state } = makeHarness({
    status: () => readyStatus(),
    rerank: async () => { rerankCalls += 1; return { order: [], reasons: {}, model: '' } },
    rerankAvailable: () => ({ ok: false, reason: 'no-preset' }),
    search: query => searchResult(query, [hit('a', 'A'), hit('b', 'B'), hit('c', 'C')]),
  })
  await state.init()
  await state.submit('计算机网络 期末')
  assert.equal(rerankCalls, 0)
  assert.equal(state.state.rerank.status, 'unavailable')
  assert.equal(state.state.rerank.unavailableReason, 'no-preset')
  state.dispose()
})

test('materials state: 重排改变显示顺序并附理由', async () => {
  const { state } = makeHarness({
    status: () => readyStatus(),
    rerankAvailable: () => ({ ok: true, reason: '' }),
    rerank: async input => ({
      order: [input.items[2].id, input.items[0].id, input.items[1].id],
      reasons: { [input.items[2].id]: '2014 年真题，附答案' },
      model: 'deepseek-flash',
    }),
    search: query => searchResult(query, [hit('a', 'A'), hit('b', 'B'), hit('c', 'C')]),
  })
  await state.init()
  await state.submit('计算机网络 期末')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(state.state.rerank.status, 'done')
  assert.deepEqual(state.displayed.value.map(item => item.id), ['c', 'a', 'b'])
  assert.equal(state.state.rerank.reasons.c, '2014 年真题，附答案')
  state.dispose()
})

test('materials state: 重排失败回落本地顺序', async () => {
  const { state } = makeHarness({
    status: () => readyStatus(),
    rerankAvailable: () => ({ ok: true, reason: '' }),
    rerank: async () => { throw new Error('boom') },
    search: query => searchResult(query, [hit('a', 'A'), hit('b', 'B'), hit('c', 'C')]),
  })
  await state.init()
  await state.submit('计算机网络 期末')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(state.state.rerank.status, 'failed')
  assert.deepEqual(state.displayed.value.map(item => item.id), ['a', 'b', 'c'])
  state.dispose()
})

test('materials state: 少于 3 条不重排', async () => {
  let rerankCalls = 0
  const { state } = makeHarness({
    status: () => readyStatus(),
    rerankAvailable: () => ({ ok: true, reason: '' }),
    rerank: async () => { rerankCalls += 1; return { order: [], reasons: {}, model: '' } },
    search: query => searchResult(query, [hit('a', 'A'), hit('b', 'B')]),
  })
  await state.init()
  await state.submit('计算机网络')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(rerankCalls, 0)
  assert.equal(state.state.rerank.status, 'idle')
  state.dispose()
})

test('materials state: 同步期间提交会在同步后重搜一次', async () => {
  const { state, calls, setStatus } = makeHarness({ status: () => readyStatus() })
  await state.init()
  let release
  const gate = new Promise(resolve => { release = resolve })
  state.state.sync.running = true
  const pending = state.submit('计网 答案')
  await pending
  setStatus(readyStatus())
  state.state.sync.running = false
  release()
  assert.equal(calls.search.length, 1)
  assert.equal(calls.search[0][0], '计网 答案')
  state.dispose()
})

test('materials state: 错误码映射为成品文案', () => {
  assert.equal(
    friendlyMaterialError(new Error('MAT_RATE_LIMIT：GitHub 暂时限制了访问次数：约 37 分钟后再试')),
    'GitHub 暂时限制了访问次数，约 37 分钟后再试。破壁计划的资料不受影响。',
  )
  assert.equal(friendlyMaterialError(new Error('something else')), '本机连接出错，请重新打开资料检索页。')
})

test('materials state: 清空索引回到未同步状态', async () => {
  let status = readyStatus()
  const { state, calls } = makeHarness({ status: () => status })
  await state.init()
  status = emptyStatus()
  const message = await state.clearIndex()
  assert.equal(message, '')
  assert.equal(calls.clear, 1)
  assert.equal(state.view.value, 'unsynced')
  state.dispose()
})

test('materials state: 先把口语改写成规范查询再检索', async () => {
  const seen = []
  const { state } = makeHarness({
    status: () => readyStatus(),
    rerankAvailable: () => ({ ok: true, reason: '' }),
    rewrite: async ({ query }) => '计算机网络 期末试卷',
    rerank: async input => ({ order: input.items.map(item => item.id), reasons: {}, model: '' }),
    search: query => { seen.push(query); return searchResult(query, [hit('a', 'A')]) },
  })
  await state.init()
  await state.submit('计网 期末')
  assert.deepEqual(seen, ['计算机网络 期末试卷'])
  assert.equal(state.state.search.submitted, '计网 期末')
  assert.equal(state.state.search.rewritten, '计算机网络 期末试卷')
  state.dispose()
})

test('materials state: 改写失败就退回原话', async () => {
  const seen = []
  const { state } = makeHarness({
    status: () => readyStatus(),
    rerankAvailable: () => ({ ok: true, reason: '' }),
    rewrite: async () => { throw new Error('rewrite-timeout') },
    search: query => { seen.push(query); return searchResult(query, [hit('a', 'A')]) },
  })
  await state.init()
  await state.submit('计网 期末')
  assert.deepEqual(seen, ['计网 期末'])
  assert.equal(state.state.search.rewritten, '')
  state.dispose()
})

test('materials state: 改写后没找到时用原话再搜一次', async () => {
  const seen = []
  const { state } = makeHarness({
    status: () => readyStatus(),
    rerankAvailable: () => ({ ok: true, reason: '' }),
    rewrite: async () => '某某规范名',
    search: query => {
      seen.push(query)
      return query === '某某规范名'
        ? searchResult(query, [], { found: false, reason: 'low-coverage' })
        : searchResult(query, [hit('a', '原话命中')])
    },
  })
  await state.init()
  await state.submit('乱七八糟的说法')
  assert.deepEqual(seen, ['某某规范名', '乱七八糟的说法'])
  assert.equal(state.state.search.result.results[0].title, '原话命中')
  assert.equal(state.state.search.rewritten, '')
  state.dispose()
})

test('materials state: 没有预设时不做改写', async () => {
  let rewrites = 0
  const { state } = makeHarness({
    status: () => readyStatus(),
    rerankAvailable: () => ({ ok: false, reason: 'no-preset' }),
    rewrite: async () => { rewrites += 1; return '改名' },
    search: query => searchResult(query, [hit('a', 'A')]),
  })
  await state.init()
  await state.submit('计网 期末')
  assert.equal(rewrites, 0)
  state.dispose()
})
