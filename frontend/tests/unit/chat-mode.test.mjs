import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

test('chat history: older turns that carried images get a text marker, the latest turn does not', () => {
  const wire = wireMessages(conversation({ messages: [
    userMessage('旧问', { attach: { images: 2 } }),
    { id: 'a1', role: 'assistant', content: '答' },
    userMessage('新问', { attach: { images: 1 } }),
  ] }))
  assert.equal(wire[0].content, '旧问\n\n[这条消息当时附了 2 张图片，图片未随历史发送]')
  assert.equal(wire[2].content, '新问')
})

test('chat history: old answers go back to the model as plain citations, not source ids', () => {
  const wire = wireMessages(conversation({ messages: [
    userMessage('旧问'),
    {
      id: 'a1', role: 'assistant', content: '结论 [S1a2b3c-1] 和 [Sfffffff-9]',
      refs: { docs: [{ aid: 'a1', title: '线代', source: 'library', ok: true }], cites: [{ id: 'S1a2b3c-1', d: 0, p: 3 }] },
    },
    userMessage('新问'),
  ] }))
  assert.equal(wire[1].content, '结论 〔《线代》第 3 页〕 和 [Sfffffff-9]')
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

test('chat choice: 抽屉的「确定」只收起，不额外保存一次选择', () => {
  const composer = readFileSync(new URL('../../src/components/chat/ChatComposer.vue', import.meta.url), 'utf8')
  const page = readFileSync(new URL('../../src/components/chat/ChatModePage.vue', import.meta.url), 'utf8')
  // 选择仍在点预设/模型/强度时即时提交：父级唯一的保存入口是 @choice → applyChoice。
  assert.match(composer, /function commit\(next: ChatModelChoice\) \{ emit\('choice', next\) \}/)
  assert.match(page, /function applyChoice\(next: ChatModelChoice\) \{ saveChatChoice\(next\); choice\.value = next \}/)
  assert.match(page, /@choice="applyChoice"/)
  // 确定复用 closePicker；既不 emit choice 也不发消息，父级也没给它接 @confirm，所以确认不会多存一次。
  const confirmBody = /function confirmPicker\(\) \{([\s\S]*?)\n\}/.exec(composer)?.[1]
  assert.ok(confirmBody !== undefined, 'confirmPicker 未定义')
  assert.match(confirmBody, /closePicker\(\)/)
  assert.ok(!confirmBody.includes('emit('), '确定只收起抽屉，不二次提交')
  const composerTag = page.slice(page.indexOf('<ChatComposer'), page.indexOf('>', page.indexOf('<ChatComposer')))
  assert.ok(!composerTag.includes('@confirm'), 'ChatModePage 不应给 ChatComposer 接 @confirm')
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
  assert.equal(normalizeChatConversation({ version: 2, id: 'c', messages: [] }, 'c'), null)
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

const libraryAttachment = { id: 'a1', source: 'library', docId: 'd1', title: '线性代数（第 5 版）', kind: 'pdf', addedAt: 3 }
const tempAttachment = { id: 'a2', source: 'temp', title: '临时文档 1', kind: 'word', addedAt: 4 }

test('chat storage: attachment descriptors, marks and refs survive a round trip', () => {
  const loaded = normalizeChatConversation({
    version: 1, id: 'c1', title: '对比', createdAt: 1, updatedAt: 2, scope: { kind: 'doc', docId: 'd1', title: '线性代数（第 5 版）' },
    attachments: [libraryAttachment, tempAttachment],
    customTitle: true,
    messages: [
      {
        id: 'u1', role: 'user', content: '问题',
        attach: { images: 2, docs: [{ aid: 'a1', source: 'library', docId: 'd1', title: '线性代数（第 5 版）' }] },
        memory: { kind: 'doc', docId: 'd1', title: '线性代数（第 5 版）', injected: true, chars: 10, skipped: 'attachments' },
      },
      {
        id: 'm1', role: 'assistant', content: '回答',
        refs: {
          docs: [{ aid: 'a1', title: '线性代数（第 5 版）', source: 'library', ok: true }, { aid: 'a2', title: '临时文档 1', source: 'temp', ok: false, error: '扫描件没有文字层' }],
          cites: [{ id: 'S1a2b3c-1', d: 0, p: 212 }, { id: 'S1a2b3c-2', d: 1, l: 40 }],
        },
      },
    ],
  }, 'c1')
  assert.equal(loaded.version, 1)
  assert.equal(loaded.attachments.length, 2)
  assert.equal(loaded.attachments[0].docId, 'd1')
  assert.equal(loaded.attachments[1].source, 'temp')
  assert.equal(loaded.customTitle, true)
  assert.equal(loaded.messages[0].attach.images, 2)
  assert.equal(loaded.messages[0].memory.skipped, 'attachments')
  assert.deepEqual(loaded.messages[1].refs.cites, [{ id: 'S1a2b3c-1', d: 0, p: 212 }, { id: 'S1a2b3c-2', d: 1, l: 40 }])
  assert.equal(loaded.messages[1].refs.docs[1].error, '扫描件没有文字层')
})

test('chat storage: an old conversation without the new fields loads with defaults', () => {
  const loaded = normalizeChatConversation({ version: 1, id: 'c1', title: '旧', messages: [{ id: 'u', role: 'user', content: '问' }] }, 'c1')
  assert.deepEqual(loaded.attachments, [])
  assert.equal(loaded.customTitle, undefined)
  assert.equal(loaded.messages[0].attach, undefined)
  assert.equal(loaded.messages[0].refs, undefined)
  assert.equal(loaded.version, 1)
})

test('chat storage: attachment descriptors are capped, deduplicated and validated', () => {
  const loaded = normalizeChatConversation({
    version: 1, id: 'c1', messages: [],
    attachments: [
      libraryAttachment,
      { ...libraryAttachment, id: 'a9' },
      { id: 'a3', source: 'library', title: '没有 docId', kind: 'pdf', addedAt: 1 },
      { id: 'a4', source: 'temp', title: '稿', kind: 'docx', addedAt: 1 },
      { id: 'a5', source: 'temp', title: '临时文档 2', kind: 'pdf', addedAt: 1 },
      { id: 'a6', source: 'temp', title: '临时文档 3', kind: 'pdf', addedAt: 1 },
    ],
  }, 'c1')
  assert.deepEqual(loaded.attachments.map(item => item.id), ['a1', 'a5', 'a6'])
  assert.equal(loaded.attachments.length, 3)
})

test('chat storage: citations are capped at 40 per message and must point at a known document', () => {
  const cites = Array.from({ length: 60 }, (_, index) => ({ id: `S1a2b3c-${index}`, d: 0, p: index + 1 }))
  cites.push({ id: 'Sdead-1', d: 5, p: 1 })
  const refs = normalizeChatConversation({
    version: 1, id: 'c1', messages: [{ id: 'm1', role: 'assistant', content: '答', refs: { docs: [{ aid: 'a1', title: '书', source: 'library', ok: true }], cites } }],
  }, 'c1').messages[0].refs
  assert.equal(refs.cites.length, 40)
  assert.equal(refs.cites.some(cite => cite.id === 'Sdead-1'), false)
})

test('chat storage: prepareConversation strips runtime-only fields and anonymises temporary documents', () => {
  const live = conversation({
    attachments: [{ id: 'a2', source: 'temp', title: '机密讲义.pdf', kind: 'pdf', addedAt: 1 }],
    messages: [
      userMessage('问', {
        images: ['data:image/png;base64,AAAA'], attach: { images: 1, docs: [{ aid: 'a2', source: 'temp', title: '机密讲义.pdf' }] },
        memory: { kind: 'global', injected: true, chars: 1, skipped: 'attachments' },
      }),
      {
        id: 'm1', role: 'assistant', content: '答',
        refs: { docs: [{ aid: 'a2', title: '机密讲义.pdf', source: 'temp', ok: true }], cites: [{ id: 'S1a2b3c-1', d: 0, p: 3 }] },
        progress: [{ aid: 'a2', status: 'ok' }],
      },
    ],
  })
  live.draft = '草稿'
  live.draftImages = ['data:image/png;base64,BBBB']
  live.request = { controller: new AbortController() }
  const prepared = prepareConversation(live)
  const json = JSON.stringify(prepared)
  assert.equal(json.includes('data:image'), false)
  assert.equal(json.includes('机密讲义'), false)
  assert.equal(json.includes('progress'), false)
  assert.equal(json.includes('草稿'), false)
  assert.equal(prepared.version, 1)
  assert.equal(prepared.attachments[0].title, '临时文档 1')
  assert.equal(prepared.messages[0].attach.docs[0].title, '临时文档 1')
  assert.equal(prepared.messages[0].attach.images, 1)
  assert.equal(prepared.messages[1].refs.docs[0].title, '临时文档 1')
  assert.equal(prepared.messages[0].images, undefined)
})

test('chat storage: fitConversation drops citations on older answers before dropping messages', () => {
  const docs = [{ aid: 'a1', title: '书'.repeat(50), source: 'library', ok: true }]
  const cites = Array.from({ length: 40 }, (_, index) => ({ id: `S1a2b3c-${index}`, d: 0, p: index + 1 }))
  const messages = Array.from({ length: 24 }, (_, index) => index % 2
    ? { id: `a${index}`, role: 'assistant', content: 'x'.repeat(4000), refs: { docs, cites } }
    : userMessage('问'.repeat(1000)))
  const full = conversation({ messages })
  const total = new TextEncoder().encode(JSON.stringify(full)).length
  const fitted = fitConversation(full, total - 1)
  assert.equal(fitted.messages.length, messages.length)
  assert.equal(fitted.trimmed, undefined)
  const assistants = fitted.messages.filter(message => message.role === 'assistant')
  assert.equal(assistants.at(-1).refs.cites.length, 40)
  assert.equal(assistants.slice(0, -10).every(message => message.refs.cites.length === 0), true)
})

test('chat storage: fitConversation still drops the oldest pairs when citations are not enough', () => {
  const messages = Array.from({ length: 20 }, (_, index) => ({
    id: `m${index}`, role: index % 2 ? 'assistant' : 'user', content: 'x'.repeat(20000), reasoning: 'y'.repeat(4000),
  }))
  const fitted = fitConversation(conversation({ messages }), 60000)
  assert.equal(fitted.trimmed, true)
  assert.ok(fitted.messages.length < messages.length)
  assert.ok(new TextEncoder().encode(JSON.stringify(fitted)).length <= 60000)
})

test('chat storage: two conversations saved at the same time both survive in the index', async () => {
  const storage = chatStorage()
  const store = createChatStore(storage)
  await Promise.all([
    store.saveConversation(conversation({ id: 'c1', updatedAt: 2, messages: [userMessage('a')] }), ''),
    store.saveConversation(conversation({ id: 'c2', updatedAt: 1, messages: [userMessage('b')] }), ''),
  ])
  const index = await store.loadIndex()
  assert.deepEqual(index.list.map(item => item.id).sort(), ['c1', 'c2'])
})
