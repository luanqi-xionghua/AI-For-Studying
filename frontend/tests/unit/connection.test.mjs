import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { listModels, testConnection } from '../../src/ai/connection.mjs'

// 浏览器预览的传输就是 fetch：换成假的，记下请求、按需回应。
const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })
function serve(handler) {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method, headers: Object.fromEntries(new Headers(init.headers || {}).entries()), body: init.body ? JSON.parse(init.body) : undefined, signal: init.signal }
    calls.push(call)
    return handler(call)
  }
  return calls
}
const json = (status, value) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
/** 流式回应：先给出这些事件，之后一直不结束（看测试会不会主动断开）。 */
function sse(events, signal) {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`))
      signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true })
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

test('model list: OpenAI-compatible GET /models with the key; known models first, non-chat models left out', async () => {
  const calls = serve(() => json(200, { object: 'list', data: [{ id: 'deepseek-chat' }, { id: 'text-embedding-3' }, { id: 'deepseek-v4-pro' }, { id: 'deepseek-flash' }, { id: 'deepseek-chat' }, 'bare-model'] }))
  const result = await listModels({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com/', apiKey: 'sk-test' })
  assert.equal(calls[0].url, 'https://api.deepseek.com/models')
  assert.deepEqual([calls[0].method, calls[0].headers.authorization], ['GET', 'Bearer sk-test'])
  assert.deepEqual(result.models.map(item => item.id), ['deepseek-flash', 'deepseek-v4-pro', 'bare-model', 'deepseek-chat'])
  assert.equal(result.models[0].name, 'DeepSeek Flash')
  assert.equal(result.hidden, 1)
})

test('model list: Claude uses /v1/models with its own headers and display names', async () => {
  const calls = serve(() => json(200, { data: [{ id: 'claude-x-1', display_name: 'Claude X' }], has_more: false }))
  const result = await listModels({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'sk-ant' })
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/models?limit=1000')
  assert.deepEqual([calls[0].headers['x-api-key'], calls[0].headers['anthropic-version'], calls[0].headers.authorization], ['sk-ant', '2023-06-01', undefined])
  assert.deepEqual(result.models, [{ id: 'claude-x-1', name: 'Claude X' }])
})

test('model list: clear errors — missing key or address, rejected key (key hidden), no list endpoint; local servers need no key', async () => {
  await assert.rejects(listModels({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKey: '' }), /API Key/)
  await assert.rejects(listModels({ provider: 'custom', baseUrl: '', apiKey: 'x' }), /API 地址/)
  await assert.rejects(listModels({ provider: 'custom', baseUrl: 'http://example.com/v1', apiKey: 'x' }), /HTTPS/)
  serve(() => json(401, { error: { message: 'bad key sk-leak' } }))
  await assert.rejects(listModels({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKey: 'sk-leak' }), error => /HTTP 401：bad key \[已隐藏\]/.test(error.message) && !error.message.includes('sk-leak'))
  serve(() => new Response('not found', { status: 404 }))
  await assert.rejects(listModels({ provider: 'glm', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKey: 'k' }), /没读到模型列表（HTTP 404）/)
  const calls = serve(() => json(200, { models: [{ name: 'llama3:latest', model: 'llama3:latest' }] }))
  const local = await listModels({ provider: 'custom', protocol: 'chat', baseUrl: 'http://localhost:11434/v1', apiKey: '' })
  assert.deepEqual([local.models, calls[0].headers.authorization], [[{ id: 'llama3:latest' }], undefined])
  // 请求根本没发出去：写明连不上哪台服务器
  serve(() => { throw new TypeError('Failed to fetch') })
  await assert.rejects(listModels({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKey: 'k' }), /连不上 api\.deepseek\.com，请检查网络、代理或 API 地址（Failed to fetch）/)
  await assert.rejects(testConnection({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', effort: '' }, 'k'), /连不上 api\.deepseek\.com/)
})

test('test connection: sends the same request as a real chat, then stops at the first streamed event', async () => {
  let streamSignal
  const calls = serve(call => { streamSignal = call.signal; return sse([{ choices: [{ delta: { role: 'assistant' } }] }], call.signal) })
  const result = await testConnection({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com', protocol: 'chat', model: 'deepseek-flash', effort: 'none', fast: false }, 'sk-test')
  assert.ok(result.ms >= 0)
  assert.equal(calls[0].url, 'https://api.deepseek.com/chat/completions')
  assert.equal(calls[0].headers.authorization, 'Bearer sk-test')
  assert.deepEqual([calls[0].body.model, calls[0].body.stream, calls[0].body.thinking], ['deepseek-flash', true, { type: 'disabled' }])
  assert.equal(calls[0].body.messages.at(-1).content, 'ping')
  assert.equal(streamSignal.aborted, true, 'the connection is closed right after the first event')
})

test('test connection: errors in the HTTP status or inside the stream are reported', async () => {
  const preset = { provider: 'openai', baseUrl: 'https://api.openai.com/v1', protocol: 'responses', model: 'gpt-5.4-mini', effort: 'low', fast: true }
  const calls = serve(() => json(404, { error: { message: 'The model `gpt-x` does not exist' } }))
  await assert.rejects(testConnection(preset, 'sk'), /HTTP 404：The model `gpt-x` does not exist/)
  assert.equal(calls[0].url, 'https://api.openai.com/v1/responses')
  assert.equal(calls[0].body.service_tier, 'priority')
  serve(call => sse([{ error: { message: 'quota exceeded' } }], call.signal))
  await assert.rejects(testConnection(preset, 'sk'), /模型返回错误：quota exceeded/)
  await assert.rejects(testConnection({ ...preset, model: '' }, 'sk'), /模型名称/)
  await assert.rejects(testConnection({ ...preset, effort: 'max' }, 'sk'), /不支持所选思考强度/)
})

test('test connection: Claude goes to /v1/messages with its thinking and effort settings', async () => {
  const calls = serve(call => sse([{ type: 'message_start', message: {} }], call.signal))
  await testConnection({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com', protocol: 'anthropic', model: 'claude-sonnet-5-5', effort: 'high', fast: false }, 'sk-ant')
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages')
  assert.equal(calls[0].headers['x-api-key'], 'sk-ant')
  assert.deepEqual([calls[0].body.stream, calls[0].body.thinking?.type, calls[0].body.output_config], [true, 'adaptive', { effort: 'high' }])
})
