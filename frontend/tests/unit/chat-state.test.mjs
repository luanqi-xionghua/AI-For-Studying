import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createChatState, CHAT_SYSTEM_PREFIX } from '../../src/chat/state.ts'
import { NO_PRESET_MESSAGE } from '../../src/ai/settings.mjs'
import { CHATMODE_KEYS, conversationKey } from '../../src/chat/types.ts'

const connection = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', protocol: 'chat', model: 'deepseek-flash', effort: 'low' }
const tag = (kind) => ({ kind, injected: kind !== 'none', chars: kind === 'none' ? 0 : 3 })
const optionsFor = (scope = { kind: 'global' }, injection = { text: 'INJ', tag: tag(scope.kind) }) => ({
  connection, scope, injectionFor: async () => injection,
})
const waitFor = async (check, label = 'condition', timeout = 2000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)) }
  throw new Error('waited for ' + label)
}

function fakeStore(seedIndex) {
  const conversations = new Map(), calls = []
  let index = seedIndex || { version: 1, activeId: '', list: [] }
  return {
    conversations, calls,
    get index() { return index },
    async loadIndex() { return JSON.parse(JSON.stringify(index)) },
    async loadConversation(id) { return conversations.has(id) ? JSON.parse(conversations.get(id)) : null },
    async saveConversation(conversation, activeId) {
      calls.push(['save', conversation.id])
      conversations.set(conversation.id, JSON.stringify(conversation))
      const entry = { id: conversation.id, title: conversation.title, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt, scope: conversation.scope, count: conversation.messages.length }
      index = { version: 1, activeId, list: [entry, ...index.list.filter(item => item.id !== conversation.id)].sort((a, b) => b.updatedAt - a.updatedAt) }
    },
    async deleteConversation(id, activeId) {
      calls.push(['delete', id])
      conversations.delete(id)
      index = { version: 1, activeId: activeId === id ? (index.list.find(item => item.id !== id)?.id || '') : activeId, list: index.list.filter(item => item.id !== id) }
    },
    async flush() {}, freeze() {}, unfreeze() {},
  }
}

function normalStream() {
  const calls = []
  let count = 0
  const handler = async options => {
    calls.push(options)
    count++
    options.onDelta('第一段')
    options.onDelta('第二段')
    options.onUsage({ input: 10, output: 5, reasoning: 1, estimated: false })
    return `回答${count}`
  }
  return { calls, handler }
}

function hangingStream() {
  const calls = []
  const handler = options => {
    calls.push(options)
    return new Promise((resolve, reject) => {
      options.onDelta('部分')
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })
  }
  return { calls, handler }
}

const active = []
function make({ stream } = {}) {
  const model = stream || normalStream()
  const store = fakeStore()
  const events = [], usages = []
  let now = 1000, seq = 0
  const chat = createChatState({
    store,
    streamChat: model.handler,
    recordUsage: entry => usages.push(entry),
    estimateTokens: text => Math.ceil(String(text).length / 4),
    emit: event => events.push(event),
    now: () => ++now,
    uuid: () => `id-${++seq}`,
    reportFailure: () => {},
  })
  active.push(chat)
  return { chat, store, events, usages, model }
}

beforeEach(() => { active.length = 0 })
afterEach(async () => {
  for (const chat of active) {
    for (const live of chat.state.conversations.values()) live.request?.controller.abort()
    try { await chat.flush() } catch { /* 已结束 */ }
  }
})

test('chat state: a normal round streams, saves, records usage and emits one learning event', async () => {
  const { chat, store, events, usages } = make()
  await chat.load()
  const conversation = chat.newConversation({ kind: 'global' })
  await chat.send(conversation.id, '问题', optionsFor())
  assert.equal(conversation.messages.length, 2)
  assert.equal(conversation.messages[1].content, '第一段第二段')
  assert.equal(conversation.title, '问题')
  assert.equal(usages.length, 1)
  assert.equal(usages[0].kind, 'chatmode')
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'chat-turn')
  assert.equal(events[0].scope.kind, 'global')
  assert.ok(events[0].answer.length <= 300)
  assert.ok(store.calls.some(call => call[0] === 'save'))
})

test('chat state: the request carries the system prefix, the injection and no tools', async () => {
  const { chat, model } = make()
  await chat.load()
  const conversation = chat.newConversation()
  await chat.send(conversation.id, '问题', optionsFor({ kind: 'global' }, { text: '注入文本', tag: { kind: 'global', injected: true, chars: 4 } }))
  const request = model.calls[0]
  assert.equal(request.systemPrefix, CHAT_SYSTEM_PREFIX)
  assert.equal(request.extraInstructions, '注入文本')
  assert.equal('tools' in request, false)
  assert.equal(request.messages.at(-1).content, '问题')
})

test('chat state: no preset means no request and a clear error', async () => {
  const { chat, model } = make()
  await chat.load()
  const conversation = chat.newConversation()
  await chat.send(conversation.id, '问题', { connection: null, reason: NO_PRESET_MESSAGE, scope: { kind: 'global' }, injectionFor: async () => ({ text: '', tag: tag('global') }) })
  assert.equal(model.calls.length, 0)
  assert.equal(conversation.messages.length, 0)
  assert.equal(conversation.error, NO_PRESET_MESSAGE)
})

test('chat state: the "no memory" scope injects nothing and emits nothing', async () => {
  const { chat, model, events } = make()
  await chat.load()
  const conversation = chat.newConversation()
  await chat.send(conversation.id, '问题', optionsFor({ kind: 'none' }, { text: '', tag: { kind: 'none', injected: false, chars: 0 } }))
  assert.equal(model.calls.length, 1)
  assert.equal(model.calls[0].extraInstructions, '')
  assert.equal(conversation.messages[0].memory.kind, 'none')
  assert.equal(events.length, 0)
})

test('chat state: empty and over-long questions never reach the model', async () => {
  const { chat, model } = make()
  await chat.load()
  const conversation = chat.newConversation()
  await chat.send(conversation.id, '   ', optionsFor())
  assert.equal(conversation.error, '请输入问题。')
  await chat.send(conversation.id, '字'.repeat(16001), optionsFor())
  assert.equal(conversation.error, '请将单次问题缩短至 16000 字以内。')
  assert.equal(model.calls.length, 0)
  assert.equal(conversation.messages.length, 0)
})

test('chat state: a conversation at the message limit refuses to grow', async () => {
  const { chat, model } = make()
  await chat.load()
  const conversation = chat.newConversation()
  conversation.messages = Array.from({ length: 60 }, (_, index) => ({ id: `m${index}`, role: 'user', content: 'x' }))
  await chat.send(conversation.id, '问题', optionsFor())
  assert.equal(conversation.error, '这段对话已经很长，请新建对话继续，以控制上下文与内存。')
  assert.equal(model.calls.length, 0)
})

test('chat state: at most two conversations may be answering at once', async () => {
  const stream = hangingStream()
  const { chat } = make({ stream })
  await chat.load()
  const first = chat.newConversation()
  const second = chat.newConversation()
  const third = chat.newConversation()
  const pendingA = chat.send(first.id, 'a', optionsFor())
  const pendingB = chat.send(second.id, 'b', optionsFor())
  await waitFor(() => stream.calls.length === 2, 'two streams')
  await chat.send(third.id, 'c', optionsFor())
  assert.equal(third.error, '已有 2 段对话正在回答，请等其中一段结束。')
  assert.equal(stream.calls.length, 2)
  chat.stop(first.id); chat.stop(second.id)
  await Promise.allSettled([pendingA, pendingB])
})

test('chat state: sending again while a request is running is ignored', async () => {
  const stream = hangingStream()
  const { chat } = make({ stream })
  await chat.load()
  const conversation = chat.newConversation()
  const pending = chat.send(conversation.id, '第一问', optionsFor())
  await waitFor(() => stream.calls.length === 1, 'stream')
  await chat.send(conversation.id, '第二问', optionsFor())
  assert.equal(conversation.messages.filter(message => message.role === 'user').length, 1)
  assert.equal(stream.calls.length, 1)
  chat.stop(conversation.id)
  await pending
})

test('chat state: stopping keeps the partial answer and emits nothing', async () => {
  const stream = hangingStream()
  const { chat, events, usages } = make({ stream })
  await chat.load()
  const conversation = chat.newConversation()
  const pending = chat.send(conversation.id, '问题', optionsFor())
  await waitFor(() => stream.calls.length === 1 && Boolean(conversation.request), 'stream')
  chat.stop(conversation.id)
  await pending
  const answer = conversation.messages[1]
  assert.equal(answer.content, '部分')
  assert.equal(answer.stopped, true)
  assert.equal(conversation.error, '')
  assert.equal(events.length, 0)
  assert.equal(usages.length, 1)
})

test('chat state: a model error marks the answer failed', async () => {
  const message = '请在 AI 设置中为这个 API 地址填写自己的 Key'
  const { chat, events } = make({ stream: { calls: [], handler: async () => { throw new Error(message) } } })
  await chat.load()
  const conversation = chat.newConversation()
  await chat.send(conversation.id, '问题', optionsFor())
  assert.equal(conversation.messages[1].failed, true)
  assert.equal(conversation.error, message)
  assert.equal(events.length, 0)
})

test('chat state: a failing injection does not block the request', async () => {
  const { chat, model } = make()
  await chat.load()
  const conversation = chat.newConversation()
  await chat.send(conversation.id, '问题', { connection, scope: { kind: 'global' }, injectionFor: async () => { throw new Error('read failed') } })
  assert.equal(model.calls.length, 1)
  assert.equal(model.calls[0].extraInstructions, '')
})

test('chat state: regenerating replaces the answer but keeps one question', async () => {
  const { chat, model } = make()
  await chat.load()
  const conversation = chat.newConversation()
  await chat.send(conversation.id, '问题', optionsFor())
  assert.equal(conversation.messages.length, 2)
  await chat.regenerate(conversation.id, optionsFor())
  assert.equal(conversation.messages.filter(message => message.role === 'user').length, 1)
  assert.equal(conversation.messages.length, 2)
  assert.equal(model.calls.length, 2)
  assert.equal(conversation.messages[1].content, '第一段第二段')
})

test('chat state: switching the scope only affects later questions', async () => {
  const { chat } = make()
  await chat.load()
  const conversation = chat.newConversation({ kind: 'global' })
  await chat.send(conversation.id, '第一问', optionsFor({ kind: 'global' }))
  const docScope = { kind: 'doc', docId: 'd1', title: '书' }
  chat.setScope(conversation.id, docScope)
  await chat.send(conversation.id, '第二问', optionsFor(docScope))
  const users = conversation.messages.filter(message => message.role === 'user')
  assert.equal(users[0].memory.kind, 'global')
  assert.equal(users[1].memory.kind, 'doc')
  assert.equal(conversation.scope.kind, 'doc')
})

test('chat state: removing a conversation aborts it and deletes its key', async () => {
  const stream = hangingStream()
  const { chat, store } = make({ stream })
  await chat.load()
  const conversation = chat.newConversation()
  const pending = chat.send(conversation.id, '问题', optionsFor())
  await waitFor(() => stream.calls.length === 1, 'stream')
  await chat.remove(conversation.id)
  await pending
  assert.ok(store.calls.some(call => call[0] === 'delete' && call[1] === conversation.id))
  assert.equal(store.conversations.has(conversation.id), false)
  assert.equal(chat.state.list.some(item => item.id === conversation.id), false)
  assert.equal(store.conversations.has(conversation.id), false)
})

test('chat state: empty conversations are never persisted', async () => {
  const { chat, store } = make()
  await chat.load()
  chat.newConversation()
  await chat.flush()
  assert.equal(store.calls.filter(call => call[0] === 'save').length, 0)
})

test('chat state: busy reflects running requests', async () => {
  const stream = hangingStream()
  const { chat } = make({ stream })
  await chat.load()
  const conversation = chat.newConversation()
  const pending = chat.send(conversation.id, '问题', optionsFor())
  await waitFor(() => stream.calls.length === 1, 'stream')
  assert.equal(chat.busy(), true)
  chat.stop(conversation.id)
  await pending
  assert.equal(chat.busy(), false)
})

test('chat state: a damaged conversation shows a message instead of crashing', async () => {
  const store = fakeStore({ version: 1, activeId: 'stored', list: [{ id: 'stored', title: '旧对话', createdAt: 1, updatedAt: 1, scope: { kind: 'global' }, count: 2 }] })
  let seq = 0
  const chat = createChatState({
    store,
    streamChat: async () => {},
    recordUsage: () => {},
    estimateTokens: () => 0,
    emit: () => {},
    now: () => ++seq,
    uuid: () => `id-${++seq}`,
    reportFailure: () => {},
  })
  active.push(chat)
  await chat.load()
  const live = await chat.open('stored')
  assert.equal(live.damaged, true)
  assert.equal(live.messages.length, 0)
  assert.match(live.error, /损坏/)
})

test('chat state: a brand new conversation is loaded, not damaged', async () => {
  const { chat } = make()
  await chat.load()
  const live = chat.current()
  assert.equal(live.loaded, true)
  assert.equal(live.damaged, false)
  assert.equal(live.error, '')
})

test('chat state: a stored conversation loads when opened', async () => {
  const store = fakeStore({ version: 1, activeId: 'saved', list: [{ id: 'saved', title: '旧对话', createdAt: 1, updatedAt: 1, scope: { kind: 'global' }, count: 2 }] })
  store.conversations.set('saved', JSON.stringify({ version: 1, id: 'saved', title: '旧对话', createdAt: 1, updatedAt: 1, scope: { kind: 'global' }, messages: [{ id: 'm1', role: 'user', content: '问' }, { id: 'm2', role: 'assistant', content: '答' }] }))
  let seq = 0
  const chat = createChatState({
    store,
    streamChat: async () => {},
    recordUsage: () => {},
    estimateTokens: () => 0,
    emit: () => {},
    now: () => ++seq,
    uuid: () => `id-${++seq}`,
    reportFailure: () => {},
  })
  active.push(chat)
  await chat.load()
  const placeholder = chat.current()
  assert.equal(placeholder.loaded, false)
  const live = await chat.open(placeholder.id)
  assert.equal(live.loaded, true)
  assert.equal(live.damaged, false)
  assert.equal(live.messages.length, 2)
})

test('chat state: the total content limit refuses to grow', async () => {
  const { chat, model } = make()
  await chat.load()
  const conversation = chat.newConversation()
  conversation.messages = Array.from({ length: 6 }, (_, index) => ({ id: `m${index}`, role: 'user', content: 'x'.repeat(30000) }))
  await chat.send(conversation.id, '问题', optionsFor())
  assert.equal(conversation.error, '这段对话已经很长，请新建对话继续，以控制上下文与内存。')
  assert.equal(model.calls.length, 0)
})

test('chat state: the learning event carries the user message id as turnId', async () => {
  const { chat, events } = make()
  await chat.load()
  const conversation = chat.newConversation()
  await chat.send(conversation.id, '问题', optionsFor())
  const user = conversation.messages.find(message => message.role === 'user')
  assert.equal(events.length, 1)
  assert.equal(events[0].turnId, user.id)
  assert.equal(events[0].type, 'chat-turn')
})

test('chat state: regenerating reuses the same turnId so memory replaces instead of appending', async () => {
  const { chat, events } = make()
  await chat.load()
  const conversation = chat.newConversation()
  await chat.send(conversation.id, '问题', optionsFor())
  await chat.regenerate(conversation.id, optionsFor())
  assert.equal(events.length, 2)
  assert.equal(events[0].turnId, events[1].turnId)
  assert.equal(events[0].turnId, conversation.messages[0].id)
})
