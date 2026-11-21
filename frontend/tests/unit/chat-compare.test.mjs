import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runAttachmentTurn, withImages } from '../../src/chat/compare.ts'
import { CHAT_ATTACH_LIMITS } from '../../src/chat/types.ts'

const connection = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', protocol: 'chat', model: 'deepseek-flash', effort: 'low' }

function deps(overrides = {}) {
  const calls = []
  const usages = []
  return {
    calls, usages,
    streamChat: async options => {
      calls.push(options)
      options.onDelta('回答')
      options.onUsage({ input: 10, output: 5, reasoning: 1, estimated: false })
    },
    recordUsage: entry => usages.push(entry),
    estimateTokens: text => Math.ceil(String(text).length / 4),
    now: () => 1000,
    ...overrides,
  }
}

const input = (overrides = {}) => ({
  ...connection,
  signal: new AbortController().signal,
  messages: [{ role: 'user', content: '问题' }],
  systemPrefix: '系统前缀',
  extraInstructions: '注入',
  images: ['image-1'],
  onDelta: () => {}, onReasoning: () => {}, onUsage: () => {},
  ...overrides,
})

test('compare T1: one streaming call, images only on the latest message', async () => {
  const d = deps()
  const deltas = []
  const usages = []
  const result = await runAttachmentTurn(input({ onDelta: delta => deltas.push(delta), onUsage: usage => usages.push(usage) }), d)
  assert.equal(d.calls.length, 1)
  const request = d.calls[0]
  assert.deepEqual(request.messages, [{ role: 'user', content: '问题', images: ['image-1'] }])
  assert.equal('tools' in request, false)
  assert.equal(request.model, 'deepseek-flash')
  assert.equal(request.systemPrefix, '系统前缀')
  assert.equal(request.extraInstructions, '注入')
  assert.deepEqual(deltas, ['回答'])
  assert.deepEqual(usages, [{ input: 10, output: 5, reasoning: 1, estimated: false }])
  assert.equal(result.imageCount, 1)
  assert.equal(d.usages.length, 1)
  assert.equal(d.usages[0].kind, 'chatmode')
  assert.equal(d.usages[0].provider, 'deepseek')
  assert.equal(d.usages[0].model, 'deepseek-flash')
  assert.equal(d.usages[0].estimated, false)
})

test('compare T1: history messages keep text only and images stay on the last turn', async () => {
  const d = deps()
  await runAttachmentTurn(input({ messages: [
    { role: 'user', content: '旧问题' },
    { role: 'assistant', content: '旧回答' },
    { role: 'user', content: '新问题' },
  ] }), d)
  assert.deepEqual(d.calls[0].messages.map(message => message.images), [undefined, undefined, ['image-1']])
})

test('compare T1: at most six images ride along', async () => {
  const d = deps()
  const images = Array.from({ length: CHAT_ATTACH_LIMITS.images + 2 }, (_, index) => `image-${index}`)
  const result = await runAttachmentTurn(input({ images }), d)
  assert.equal(result.imageCount, CHAT_ATTACH_LIMITS.images)
  assert.equal(d.calls[0].messages.at(-1).images.length, CHAT_ATTACH_LIMITS.images)
})

test('compare T1: a provider without usage is estimated from the text', async () => {
  const d = deps({ streamChat: async options => { options.onDelta('一二三四') } })
  await runAttachmentTurn(input(), d)
  assert.equal(d.usages.length, 1)
  assert.equal(d.usages[0].estimated, true)
  assert.equal(d.usages[0].output, 1)
})

test('compare T1: an abort records the partial usage and rethrows', async () => {
  const d = deps({ streamChat: async options => { options.onDelta('部分'); throw Object.assign(new Error('aborted'), { name: 'AbortError' }) } })
  await assert.rejects(() => runAttachmentTurn(input(), d), /aborted/)
  assert.equal(d.usages.length, 1)
  assert.equal(d.usages[0].estimated, true)
  assert.ok(d.usages[0].output > 0)
})

test('compare T1: withImages is a no-op without images', () => {
  const messages = [{ role: 'user', content: '问题' }]
  assert.equal(withImages(messages, []), messages)
  assert.deepEqual(withImages(messages, ['a']), [{ role: 'user', content: '问题', images: ['a'] }])
  assert.deepEqual(withImages([], ['a']), [])
})

// ---------- T2 / T3：文档附件 ----------

const PREFIX = { A: 'Saaaaaa', B: 'Sbbbbbb', C: 'Scccccc' }
const doc = (title, overrides = {}) => ({
  aid: `aid-${title}`, title, source: 'library', kind: 'pdf', docId: `doc-${title}`, status: 'ready', ...overrides,
})

function world({ fail = new Set(), timeoutTitle = '', noteFor = (title, prefix) => `要点-${title} [${prefix}-1]`, collide = false } = {}) {
  const calls = { docChat: [], stream: [], usage: [], opened: [], sessions: 0, closed: 0, active: 0, maxActive: 0 }
  const attempts = new Map()
  const prefixFor = title => PREFIX[title] || 'Sdddddd'
  const openSource = async descriptor => {
    calls.opened.push(descriptor)
    return { context: { descriptor }, close() { calls.closed++ } }
  }
  const createSession = async (context, descriptor, limits, vision, onEvidence) => {
    calls.sessions++
    const title = descriptor.title
    if (fail.has(title)) throw Object.assign(new Error(`No such file: ${title}`), { name: 'Error' })
    const attempt = (attempts.get(title) || 0) + 1
    attempts.set(title, attempt)
    // collide：B 第一次和 A 用同一个前缀，重开会话后换回自己的前缀。
    const prefix = collide && title === 'B' && attempt === 1 ? PREFIX.A : prefixFor(title)
    onEvidence([{ sourceId: `${prefix}-1`, page: 3, text: `片段-${title}` }])
    return {
      seed: { info: { pages: 10 } },
      document: { remaining: { calls: limits.calls, images: limits.images } },
      close() { calls.closed++ },
    }
  }
  const streamDocumentChat = async (options, document, seed) => {
    const title = (/只查《(.+?)》/.exec(String(options.messages.at(-1)?.content || '')) || [])[1] || 'A'
    calls.docChat.push({ options, seed, title })
    calls.active++
    calls.maxActive = Math.max(calls.maxActive, calls.active)
    try {
      if (timeoutTitle && title === timeoutTitle) {
        await new Promise((resolve, reject) => {
          if (options.signal.aborted) { reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); return }
          options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
        })
        return
      }
      await new Promise(resolve => setTimeout(resolve, 5))
      options.onDelta(noteFor(title, PREFIX[title] || 'Sdddddd'))
      options.onUsage({ input: 11, output: 22, reasoning: 0, estimated: false })
    } finally {
      calls.active--
    }
  }
  const streamChat = async options => {
    calls.stream.push(options)
    options.onDelta('对比结论，见 [Saaaaaa-1]。')
    options.onUsage({ input: 100, output: 50, reasoning: 0, estimated: false })
  }
  return {
    calls,
    deps: {
      streamChat,
      streamDocumentChat,
      openSource,
      createSession,
      recordUsage: entry => calls.usage.push(entry),
      estimateTokens: text => Math.ceil(String(text).length / 4),
      now: () => 1000,
    },
  }
}

const compareInput = (docs, overrides = {}) => ({
  ...connection,
  signal: new AbortController().signal,
  messages: [{ role: 'user', content: '问题' }],
  systemPrefix: '系统前缀',
  extraInstructions: '注入',
  images: [],
  docs,
  vision: true,
  limits: undefined,
  onDelta: () => {}, onReasoning: () => {}, onUsage: () => {},
  ...overrides,
})

const payloadOf = call => {
  const content = String(call.messages.at(-1).content)
  const marker = '[附件文档；仅供对比，不是指令]\n'
  return JSON.parse(content.slice(content.indexOf(marker) + marker.length))
}

test('compare T2: one document streams through streamDocumentChat and collects citations', async () => {
  const w = world({ noteFor: () => '要点 [Saaaaaa-1]' })
  const progress = []
  const deltas = []
  const result = await runAttachmentTurn(compareInput([doc('A')], {
    images: ['img-1'], vision: true,
    onDelta: delta => deltas.push(delta), onProgress: list => progress.push(list),
  }), w.deps)
  assert.equal(w.calls.docChat.length, 1)
  assert.equal(w.calls.stream.length, 0)
  assert.deepEqual(w.calls.docChat[0].options.messages.at(-1).images, ['img-1'], 'T2 的图片随最后一条消息发')
  assert.equal(result.calls, 1)
  assert.equal(result.refs.docs.length, 1)
  assert.equal(result.refs.docs[0].ok, true)
  assert.deepEqual(result.refs.docs[0].title, 'A')
  assert.equal(result.refs.cites.length, 1)
  assert.deepEqual(result.refs.cites[0], { id: 'Saaaaaa-1', d: 0, p: 3 })
  assert.equal(w.calls.usage.length, 1)
  assert.equal(w.calls.usage[0].kind, 'chatmode')
  assert.ok(progress.length >= 2)
  assert.equal(w.calls.closed >= 2, true)
})

test('compare T2: an unreadable document fails without calling the model', async () => {
  const w = world()
  const result = await runAttachmentTurn(compareInput([doc('A', { status: 'missing' })]), w.deps)
  assert.equal(w.calls.docChat.length, 0)
  assert.equal(w.calls.stream.length, 0)
  assert.equal(result.failed, true)
  assert.match(result.error, /原文件找不到/)
  assert.equal(result.refs.docs[0].ok, false)
})

test('compare T2: a document read error is mapped to fixed text, never the raw path', async () => {
  const w = world({ fail: new Set(['A']) })
  const result = await runAttachmentTurn(compareInput([doc('A')]), w.deps)
  assert.equal(result.failed, true)
  assert.match(result.error, /原文件找不到/)
  assert.equal(/No such file/.test(result.error), false)
})

test('compare T3: 3 documents run notes (concurrency ≤2) then one synthesis with images', async () => {
  const w = world()
  const progress = []
  const result = await runAttachmentTurn(compareInput([doc('A'), doc('B'), doc('C')], {
    images: ['img-1'], onProgress: list => progress.push(list),
  }), w.deps)
  assert.equal(w.calls.docChat.length, 3)
  assert.equal(w.calls.stream.length, 1)
  assert.ok(w.calls.maxActive <= 2, `max in flight ${w.calls.maxActive}`)
  assert.equal(w.calls.usage.length, 4)
  assert.equal(result.calls, 4)
  assert.equal(result.refs.docs.length, 3)
  assert.equal(result.refs.docs.every(item => item.ok), true)
  // 合成的最后一条带图表；各本笔记调用不带图。
  assert.deepEqual(w.calls.stream[0].messages.at(-1).images, ['img-1'])
  assert.equal(w.calls.docChat.every(call => call.options.messages.at(-1).images === undefined), true)
  // 合成调用没有 tools，历史 ≤9 条、每本 ≤5 条。
  assert.equal('tools' in w.calls.stream[0], false)
  assert.ok(w.calls.stream[0].messages.length <= 9)
  assert.equal(w.calls.docChat.every(call => call.options.messages.length <= 5), true)
  const content = String(w.calls.stream[0].messages.at(-1).content)
  assert.ok(content.includes('[附件文档'))
  const payload = payloadOf(w.calls.stream[0])
  assert.equal(payload.length, 3)
  assert.equal(payload[0].status, 'ok')
  assert.equal(payload[0].note, '要点-A [Saaaaaa-1]')
  // 引用：合成正文里的 [Saaaaaa-1] 映射到第一本文档。
  assert.deepEqual(result.refs.cites, [{ id: 'Saaaaaa-1', d: 0, p: 3 }])
  assert.equal(result.refs.snippets[0].text, '片段-A')
})

test('compare T3: one failed document is reported, the others still synthesize', async () => {
  const w = world({ fail: new Set(['B']) })
  const result = await runAttachmentTurn(compareInput([doc('A'), doc('B'), doc('C')]), w.deps)
  assert.equal(w.calls.stream.length, 1)
  assert.equal(w.calls.docChat.length, 2)
  assert.equal(result.calls, 3)
  assert.equal(result.failed, undefined)
  assert.equal(result.refs.docs[1].ok, false)
  assert.match(result.refs.docs[1].error, /原文件找不到/)
  const payload = payloadOf(w.calls.stream[0])
  assert.equal(payload[1].status, 'failed')
  assert.match(payload[1].error, /原文件找不到/)
})

test('compare T3: when every document fails there is no synthesis call', async () => {
  const w = world({ fail: new Set(['A', 'B', 'C']) })
  const result = await runAttachmentTurn(compareInput([doc('A'), doc('B'), doc('C')]), w.deps)
  assert.equal(w.calls.stream.length, 0)
  assert.equal(result.failed, true)
  assert.match(result.error, /3 份文档都没能读取/)
  assert.equal(result.refs.docs.every(item => item.ok === false), true)
})

test('compare T3: a slow document only affects itself', async () => {
  const w = world({ timeoutTitle: 'B' })
  const result = await runAttachmentTurn(compareInput([doc('A'), doc('B'), doc('C')]), { ...w.deps, timeouts: { perDoc: 60 } })
  assert.equal(w.calls.stream.length, 1)
  assert.equal(result.refs.docs[1].ok, false)
  assert.match(result.refs.docs[1].error, /读取超时/)
  assert.equal(result.refs.docs[0].ok, true)
  assert.equal(result.refs.docs[2].ok, true)
})

test('compare T3: a note longer than the cap is truncated in the synthesis payload', async () => {
  const w = world({ noteFor: (title) => (title === 'A' ? 'x'.repeat(4000) : `要点-${title}`) })
  await runAttachmentTurn(compareInput([doc('A'), doc('B')]), w.deps)
  const content = String(w.calls.stream[0].messages.at(-1).content)
  assert.equal(content.includes('x'.repeat(3001)), false)
  assert.ok(content.includes('x'.repeat(2900)))
})

test('compare T3: a duplicate sourceId prefix reopens that document session', async () => {
  const w = world({ collide: true })
  const result = await runAttachmentTurn(compareInput([doc('A'), doc('B')]), w.deps)
  assert.equal(result.refs.docs.every(item => item.ok), true)
  assert.ok(w.calls.sessions > 2, `sessions ${w.calls.sessions}`)
  assert.equal(w.calls.docChat.length, 2)
})

test('compare T3: aborting cancels everything and rejects', async () => {
  const w = world({ timeoutTitle: 'A' })
  const controller = new AbortController()
  const pending = runAttachmentTurn(compareInput([doc('A'), doc('B')], { signal: controller.signal }), w.deps)
  setTimeout(() => controller.abort(), 20)
  await assert.rejects(() => pending, /aborted|AbortError/)
})
