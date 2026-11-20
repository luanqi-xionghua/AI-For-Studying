import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { chatTitle, boundChatHistory, wireMessages } from '../../src/chat/history.ts'
import {
  CHAT_CHOICE_KEY, connectionScope, loadChatChoice, normalizeChatChoice, pickChatEffort, pickChatModel,
  pickChatPreset, resolveChatChoice, saveChatChoice,
} from '../../src/chat/choice.ts'
import {
  createChatStore, fitConversation, normalizeChatConversation, normalizeScope, prepareConversation,
} from '../../src/chat/storage.ts'
import { CHATMODE_KEYS, conversationKey } from '../../src/chat/types.ts'
import { normalizeAiSettings } from '../../src/ai/settings.mjs'

let local
beforeEach(() => {
  local = new Map()
  globalThis.localStorage = { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, String(value)), removeItem: key => local.delete(key) }
})
afterEach(() => { delete globalThis.localStorage })

const conversation = (overrides = {}) => ({ version: 1, id: 'c1', title: '', createdAt: 1, updatedAt: 1, scope: { kind: 'global' }, messages: [], ...overrides })
const userMessage = (content, overrides = {}) => ({ id: Math.random().toString(36).slice(2), role: 'user', content, ...overrides })

test('chat history: chatTitle compresses whitespace and truncates at 28 chars', () => {
  assert.equal(chatTitle('  多个   空白\n换行  '), '多个 空白 换行')
  const long = chatTitle('字'.repeat(30))
  assert.equal(long.length, 28)
  assert.ok(long.endsWith('…'))
})

test('chat history: only the newest 12 messages ride along with the question', () => {
  const messages = Array.from({ length: 20 }, (_, index) => ({ role: 'user', content: `消息${index}` }))
  const result = boundChatHistory(messages)
  assert.equal(result.length, 13)
  assert.equal(result[0].role, 'user')
  assert.equal(result.at(-1).content, '消息19')
})

test('chat history: the character budget stops older messages', () => {
  const messages = [
    { role: 'user', content: 'A'.repeat(39000) },
    { role: 'assistant', content: 'B'.repeat(5000) },
    { role: 'user', content: '最后的问题' },
  ]
  const result = boundChatHistory(messages)
  assert.equal(result.at(-1).content, '最后的问题')
  assert.equal(result.some(message => message.content === 'A'.repeat(39000)), false)
})

test('chat history: a leading assistant message is removed', () => {
  const messages = Array.from({ length: 6 }, (_, index) => ({ role: index % 2 === 0 ? 'assistant' : 'user', content: `m${index}` }))
  const result = boundChatHistory(messages)
  assert.ok(result.length >= 1)
  assert.equal(result[0].role, 'user')
})

test('chat history: a single message is returned as-is', () => {
  assert.deepEqual(boundChatHistory([{ role: 'user', content: 'hi' }]), [{ role: 'user', content: 'hi' }])
})

test('chat history: wireMessages skips failed and empty messages', () => {
  const wire = wireMessages(conversation({ messages: [
    userMessage('问'), { id: 'a1', role: 'assistant', content: '失败', failed: true }, { id: 'a2', role: 'assistant', content: '   ' }, userMessage('再问'),
  ] }))
  assert.deepEqual(wire.map(message => message.content), ['问', '再问'])
})

const presets = [
  { id: 'a', name: '主力', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', protocol: 'chat', model: 'deepseek-v4-pro', effort: 'high', fast: false },
  { id: 'b', name: '省钱', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', protocol: 'chat', model: 'deepseek-flash', effort: 'none', fast: false },
]
const settings = normalizeAiSettings({ presetsVersion: 2, presets, assistantPreset: 'a', translationPreset: 'b', explainPreset: 'b' })
const emptyChoice = () => normalizeChatChoice(null)

test('chat choice: normalizeChatChoice tolerates broken data', () => {
  assert.deepEqual(normalizeChatChoice(null), { version: 1, preset: '', scope: '', model: '', effort: '' })
  assert.deepEqual(normalizeChatChoice({ preset: 3 }), { version: 1, preset: '', scope: '', model: '', effort: '' })
})

test('chat choice: resolve falls back to the assistant preset then to the first', () => {
  assert.equal(resolveChatChoice(normalizeAiSettings({ presets: [] }), emptyChoice()), null)
  const fallback = resolveChatChoice(settings, emptyChoice())
  assert.equal(fallback.preset.id, 'a')
  assert.equal(fallback.model, 'deepseek-v4-pro')
  const first = resolveChatChoice(normalizeAiSettings({ presetsVersion: 2, presets }), emptyChoice())
  assert.equal(first.preset.id, 'a')
})

test('chat choice: stored model and effort apply only while the preset fingerprint matches', () => {
  const scoped = { version: 1, preset: 'b', scope: connectionScope(settings.presets[1]), model: 'deepseek-v4-pro', effort: 'max' }
  const resolved = resolveChatChoice(settings, scoped)
  assert.equal(resolved.preset.id, 'b')
  assert.equal(resolved.model, 'deepseek-v4-pro')
  assert.equal(resolved.effort, 'max')
  const moved = resolveChatChoice(settings, { ...scoped, scope: '["deepseek","https://other.test","chat"]' })
  assert.equal(moved.model, 'deepseek-flash')
  assert.equal(moved.effort, 'none')
  const gone = resolveChatChoice(settings, { ...scoped, preset: 'missing' })
  assert.equal(gone.preset.id, 'a')
})

test('chat choice: pickers update only the chat choice', () => {
  const presetPick = pickChatPreset(settings, 'b')
  assert.equal(presetPick.preset, 'b')
  assert.equal(presetPick.model, 'deepseek-flash')
  assert.equal(presetPick.effort, 'none')
  const modelPick = pickChatModel(settings, { ...emptyChoice(), preset: 'a', scope: connectionScope(settings.presets[0]), model: 'deepseek-v4-pro', effort: 'max' }, 'deepseek-flash')
  assert.equal(modelPick.model, 'deepseek-flash')
  const effortPick = pickChatEffort(settings, presetPick, 'max')
  assert.equal(effortPick.effort, 'max')
})

test('chat choice: switching to a model without the stored effort falls back to its default', () => {
  const qwen = normalizeAiSettings({ presetsVersion: 2, presets: [{ id: 'q', name: '', provider: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', protocol: 'chat', model: 'qwen-max', effort: '', fast: false }], assistantPreset: 'q' })
  const choice = { version: 1, preset: 'q', scope: connectionScope(qwen.presets[0]), model: 'qwen-max', effort: 'high' }
  assert.equal(pickChatModel(qwen, choice, 'qwen-plus').effort, '')
})

test('chat choice: nothing here touches the reader settings', () => {
  const raw = JSON.stringify({ presetsVersion: 2, presets, assistantPreset: 'a' })
  local.set('paperdesk.ai.settings.v1', raw)
  pickChatPreset(settings, 'b')
  pickChatModel(settings, emptyChoice(), 'deepseek-flash')
  pickChatEffort(settings, emptyChoice(), 'max')
  saveChatChoice(pickChatPreset(settings, 'b'))
  assert.equal(local.get('paperdesk.ai.settings.v1'), raw)
  assert.ok(local.has(CHAT_CHOICE_KEY))
})

test('chat choice: loadChatChoice never throws on broken storage', () => {
  local.set(CHAT_CHOICE_KEY, '{bad')
  assert.deepEqual(loadChatChoice(), normalizeChatChoice(null))
})

test('chat scope: normalizeScope accepts doc, none and falls back to global', () => {
  assert.deepEqual(normalizeScope({ kind: 'doc', docId: 'd', title: 't' }), { kind: 'doc', docId: 'd', title: 't' })
  assert.deepEqual(normalizeScope({ kind: 'doc' }), { kind: 'global' })
  assert.deepEqual(normalizeScope('x'), { kind: 'global' })
})

test('chat storage: conversationKey stays within the backend key rules', () => {
  const key = conversationKey('c41d2a70-5e0b-4a56-8f1e-9d3c2b7a6e10')
  assert.match(key, /^[a-zA-Z0-9._-]{1,100}$/)
  assert.equal(conversationKey('a b/c').includes(' '), false)
})

test('chat storage: normalizeChatConversation rejects broken data and bad ids', () => {
  assert.equal(normalizeChatConversation(undefined, 'c'), null)
  assert.equal(normalizeChatConversation({ id: 'other', messages: [] }, 'c'), null)
  const result = normalizeChatConversation({ messages: [{ role: 'system', content: 'nope' }, { role: 'user', content: 5 }, { role: 'user', content: 'ok' }] }, 'c')
  assert.equal(result.messages.length, 1)
  assert.equal(result.messages[0].content, 'ok')
})

test('chat storage: prepareConversation truncates text and drops empty failed answers', () => {
  const long = conversation({ messages: [
    { id: 'a', role: 'assistant', content: 'x'.repeat(70000), reasoning: 'y'.repeat(9000) },
    { id: 'b', role: 'assistant', content: '', failed: true },
    ...Array.from({ length: 5 }, (_, index) => userMessage(`m${index}`)),
  ] })
  const prepared = prepareConversation(long)
  assert.equal(prepared.messages[0].content.length, 60000)
  assert.equal(prepared.messages[0].reasoning.length, 4000)
  assert.equal(prepared.messages.some(message => message.failed && !message.content), false)
})

test('chat storage: prepareConversation keeps only the last 60 messages', () => {
  const messages = Array.from({ length: 70 }, (_, index) => userMessage(`m${index}`))
  const prepared = prepareConversation(conversation({ messages }))
  assert.equal(prepared.messages.length, 60)
  assert.equal(prepared.messages.at(-1).content, 'm69')
})

test('chat storage: fitConversation drops reasoning and old pairs until it fits', () => {
  const messages = Array.from({ length: 20 }, (_, index) => ({ id: `m${index}`, role: index % 2 ? 'assistant' : 'user', content: 'x'.repeat(60000), reasoning: 'y'.repeat(4000) }))
  const fitted = fitConversation(conversation({ messages }))
  assert.ok(new TextEncoder().encode(JSON.stringify(fitted)).length <= 900 * 1024)
  assert.equal(fitted.messages.every(message => !message.reasoning), true)
  assert.equal(fitted.trimmed, true)
  assert.ok(fitted.messages.length < messages.length)
})

function chatStorage(seed = {}) {
  const map = new Map(Object.entries(seed)), calls = []
  return {
    map, calls,
    getSetting: async key => { calls.push(['get', key]); return map.has(key) ? map.get(key) : null },
    setSetting: async (key, value) => { calls.push(['set', key]); map.set(key, value) },
    deleteSetting: async key => { calls.push(['delete', key]); map.delete(key) },
  }
}

test('chat storage: the 42nd conversation pushes out the oldest two keys', async () => {
  const storage = chatStorage()
  const store = createChatStore(storage)
  for (let index = 0; index < 42; index++) {
    await store.saveConversation(conversation({ id: `c${index}`, updatedAt: index, createdAt: index, messages: [userMessage('q')] }), '')
  }
  const index = await store.loadIndex()
  assert.equal(index.list.length, 40)
  assert.equal(storage.map.has(conversationKey('c0')), false)
  assert.equal(storage.map.has(conversationKey('c1')), false)
  assert.equal(storage.map.has(conversationKey('c41')), true)
})

test('chat storage: a corrupt index reads as an empty list', async () => {
  const storage = chatStorage({ [CHATMODE_KEYS.index]: 'oops' })
  const index = await createChatStore(storage).loadIndex()
  assert.deepEqual(index, { version: 1, activeId: '', list: [] })
})

test('chat storage: freezing drops saves', async () => {
  const storage = chatStorage()
  const store = createChatStore(storage)
  store.freeze()
  await store.saveConversation(conversation({ messages: [userMessage('q')] }), '')
  assert.equal(storage.map.has(conversationKey('c1')), false)
  store.unfreeze()
  await store.saveConversation(conversation({ messages: [userMessage('q')] }), '')
  assert.equal(storage.map.has(conversationKey('c1')), true)
})
