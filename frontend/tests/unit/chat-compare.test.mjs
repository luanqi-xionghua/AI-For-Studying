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
