import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RERANK_SYSTEM, REWRITE_SYSTEM, applyRerank, buildRerankMessages, parseRerank,
  parseRewrite, rerankAvailability, rerankMaterials, rewriteQuery, serializeCandidates,
} from '../../src/ai/materials.ts'

function hit(id, extra = {}) {
  return {
    id, title: `标题 ${id}`, course: '计算机网络', courseKey: '计算机网络', category: '',
    ext: 'pdf', format: 'PDF', size: 1024, count: 1, year: 2014, source: 'openise',
    url: `https://github.com/${id}`, links: [], owned: null, score: 1, coverage: 1, intents: ['exam'],
    ...extra,
  }
}

test('rerank: 候选序列化只保留 12 条且不带链接', () => {
  const items = Array.from({ length: 13 }, (_, index) => hit(`id${index}`))
  items[0] = hit('id0', { title: '含\n换行｜和分隔符 https://x.example/a', course: '' })
  const text = serializeCandidates(items)
  const lines = text.split('\n')
  assert.equal(lines.length, 12)
  assert.ok(!lines[0].includes('id0'), '不应出现内部 id')
  assert.ok(!/github\.com|arxiv\.jaison\.ink/.test(text), '不应出现站点域名')
  assert.ok(lines[0].split('｜')[1] === '-', '空课程显示为 -')
})

test('rerank: 提示词只有一条 user 消息', () => {
  const messages = buildRerankMessages({
    query: '计算机网络 期末试卷',
    courses: ['计算机网络'],
    intents: ['exam'],
    items: [hit('a'), hit('b')],
  })
  assert.equal(messages.length, 1)
  assert.equal(messages[0].role, 'user')
  assert.ok(messages[0].content.includes('查询：计算机网络 期末试卷'))
  assert.ok(messages[0].content.includes('识别出的意图：考试真题'))
})

test('rerank: system 提示词禁止编造链接', () => {
  assert.ok(RERANK_SYSTEM.includes('不要输出任何网址'))
  assert.ok(RERANK_SYSTEM.includes('{"order":[{"n":'))
})

test('rerank: 解析正常并补齐漏掉的编号', () => {
  const parsed = parseRerank('{"order":[{"n":3,"why":"2014 年真题"},{"n":1,"why":"答案"}]}', 3)
  assert.deepEqual(parsed.order, [3, 1, 2])
  assert.equal(parsed.reasons.get(3), '2014 年真题')
})

test('rerank: 容忍代码块与前后缀', () => {
  const parsed = parseRerank('好的，```json\n{"order":[{"n":2,"why":"笔记"}]}\n```', 2)
  assert.deepEqual(parsed.order, [2, 1])
})

test('rerank: 越界、重复、非整数一律跳过', () => {
  const parsed = parseRerank('{"order":[{"n":0},{"n":4},{"n":"2"},{"n":2.5},{"n":1},{"n":1}]}', 3)
  assert.deepEqual(parsed.order, [1, 2, 3])
})

test('rerank: 理由里的网址会被剥掉', () => {
  const parsed = parseRerank('{"order":[{"n":1,"why":"见 https://github.com/x 很好"}]}', 1)
  assert.ok(!/http|github\.com/.test(parsed.reasons.get(1)))
})

test('rerank: 解析失败返回 null', () => {
  assert.equal(parseRerank('抱歉', 3), null)
  assert.equal(parseRerank('{"order":"x"}', 3), null)
  assert.equal(parseRerank('{"order":[]}', 3), null)
})

test('rerank: applyRerank 不丢条目', () => {
  const items = Array.from({ length: 15 }, (_, index) => ({ id: String(index) }))
  const order = items.slice(0, 12).map(item => item.id).reverse()
  const applied = applyRerank(items, order)
  assert.equal(applied.length, 15)
  assert.deepEqual(applied.slice(12).map(item => item.id), ['12', '13', '14'])
})

test('rerank: 超时会中止并 reject', async () => {
  let received
  const input = { query: 'q', courses: [], intents: [], items: [hit('a'), hit('b')] }
  const controller = new AbortController()
  await assert.rejects(() => rerankMaterials(input, {
    signal: controller.signal,
    timeoutMs: 20,
    complete: options => new Promise(() => { received = options }),
  }))
  assert.equal(received.signal.aborted, true)
})

test('rerank: 输出超长会中止并 reject', async () => {
  const input = { query: 'q', courses: [], intents: [], items: [hit('a'), hit('b')] }
  const controller = new AbortController()
  await assert.rejects(() => rerankMaterials(input, {
    signal: controller.signal,
    complete: async options => {
      options.onDelta('a', 'a'.repeat(2100))
      return 'a'
    },
  }))
})

test('rerank: 调用参数符合约定', async () => {
  let captured
  const input = { query: 'q', courses: ['计算机网络'], intents: ['exam'], items: [hit('a'), hit('b')] }
  const controller = new AbortController()
  const outcome = await rerankMaterials(input, {
    signal: controller.signal,
    complete: async options => {
      captured = options
      return '{"order":[{"n":2,"why":"更贴题"},{"n":1,"why":"次选"}]}'
    },
  })
  assert.equal(captured.kind, 'discover')
  assert.equal(captured.fast, true)
  assert.equal(captured.systemPrefix, RERANK_SYSTEM)
  assert.equal(captured.messages.length, 1)
  assert.deepEqual(outcome.order, ['b', 'a'])
  assert.equal(outcome.reasons.b, '更贴题')
})

test('rerank: 可用性判断', () => {
  assert.deepEqual(rerankAvailability({ presets: [] }), { ok: false, reason: 'no-preset' })
  assert.deepEqual(rerankAvailability({ presets: [{}], model: '' }), { ok: false, reason: 'no-model' })
  assert.deepEqual(rerankAvailability({ presets: [{}], model: 'deepseek-flash' }), { ok: true, reason: '' })
})

test('rewrite: 解析去掉代码块、前缀、引号和句号', () => {
  assert.equal(parseRewrite('计算机网络 期末试卷'), '计算机网络 期末试卷')
  assert.equal(parseRewrite('```\n线性代数 课后答案\n```'), '线性代数 课后答案')
  assert.equal(parseRewrite('改写结果：「计算机网络 期末试卷」。'), '计算机网络 期末试卷')
  assert.equal(parseRewrite('好的\n数据库 期中试卷\n说明：……'), '好的')
})

test('rewrite: 空输出返回空串', () => {
  assert.equal(parseRewrite(''), '')
  assert.equal(parseRewrite('   \n  '), '')
  assert.equal(parseRewrite(' 。 '), '')
})

test('rewrite: 超长结果被截断', () => {
  assert.equal(parseRewrite('计'.repeat(200)).length, 60)
})

test('rewrite: 调用参数用阅读助手预设的小模型', async () => {
  let captured
  const controller = new AbortController()
  const text = await rewriteQuery({ query: '计网 期末' }, {
    signal: controller.signal,
    complete: async options => { captured = options; return '计算机网络 期末试卷' },
  })
  assert.equal(text, '计算机网络 期末试卷')
  assert.equal(captured.kind, 'discover')
  assert.equal(captured.fast, true)
  assert.equal(captured.systemPrefix, REWRITE_SYSTEM)
  assert.equal(captured.messages.length, 1)
  assert.equal(captured.messages[0].role, 'user')
  assert.equal(captured.messages[0].content, '计网 期末')
})

test('rewrite: 超时会中止并抛出，由调用方回落', async () => {
  let received
  const controller = new AbortController()
  await assert.rejects(() => rewriteQuery({ query: 'q' }, {
    signal: controller.signal,
    timeoutMs: 20,
    complete: options => new Promise(() => { received = options }),
  }))
  assert.equal(received.signal.aborted, true)
})
