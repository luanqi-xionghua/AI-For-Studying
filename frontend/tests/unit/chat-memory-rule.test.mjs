import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { hasAttachmentTurn, learningTargets } from '../../src/chat/memory-rule.ts'
import { createChatState } from '../../src/chat/state.ts'

const connection = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', protocol: 'chat', model: 'deepseek-flash', effort: 'low' }
const docScope = { kind: 'doc', docId: 'd1', title: '线代A' }
const tag = (kind) => ({ kind, injected: kind !== 'none', chars: kind === 'none' ? 0 : 3 })
const optionsFor = (scope = { kind: 'global' }, extra = {}) => ({
  connection, scope, injectionFor: async () => ({ text: 'INJ', tag: tag(scope.kind) }), ...extra,
})
const attachmentDocs = [{ id: 'a1', source: 'library', docId: 'd1', title: '线代A', kind: 'pdf', addedAt: 1 }]
const active = []

function fakeStore() {
  const conversations = new Map()
  let index = { version: 1, activeId: '', list: [] }
  return {
    conversations,
    async loadIndex() { return JSON.parse(JSON.stringify(index)) },
    async loadConversation(id) { return conversations.has(id) ? JSON.parse(conversations.get(id)) : null },
    async saveConversation(conversation, activeId) {
      conversations.set(conversation.id, JSON.stringify(conversation))
      const entry = { id: conversation.id, title: conversation.title, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt, scope: conversation.scope, count: conversation.messages.length }
      index = { version: 1, activeId, list: [entry, ...index.list.filter(item => item.id !== conversation.id)] }
    },
    async deleteConversation(id, activeId) {
      conversations.delete(id)
      index = { version: 1, activeId, list: index.list.filter(item => item.id !== id) }
    },
    async flush() {}, freeze() {}, unfreeze() {},
  }
}

function make() {
  const store = fakeStore()
  const events = []
  let seq = 0
  const chat = createChatState({
    store,
    streamChat: async options => { options.onDelta('回答'); options.onUsage({ input: 5, output: 3, reasoning: 0, estimated: false }) },
    recordUsage: () => {},
    estimateTokens: text => Math.ceil(String(text).length / 4),
    emit: event => events.push(event),
    now: () => ++seq,
    uuid: () => `id-${++seq}`,
    reportFailure: () => {},
  })
  active.push(chat)
  return { chat, store, events }
}

beforeEach(() => { active.length = 0 })
afterEach(async () => {
  for (const chat of active) {
    for (const live of chat.state.conversations.values()) live.request?.controller.abort()
    try { await chat.flush() } catch { /* 已结束 */ }
  }
})

test('memory rule: the truth table covers every scope and attachment state', () => {
  assert.deepEqual(learningTargets({ kind: 'none' }, false), [])
  assert.deepEqual(learningTargets({ kind: 'none' }, true), [])
  assert.deepEqual(learningTargets({ kind: 'global' }, false), ['global'])
  assert.deepEqual(learningTargets({ kind: 'global' }, true), [])
  assert.deepEqual(learningTargets({ kind: 'doc', docId: 'd1', title: '书' }, false), ['doc', 'global'])
  assert.deepEqual(learningTargets({ kind: 'doc', docId: 'd1', title: '书' }, true), [])
})

test('memory rule: attachments win over every scope, including a removed-document fallback', () => {
  // 文档范围在「书已被移除」时会被调用方降级成 none；带附件时两种都不写。
  assert.deepEqual(learningTargets({ kind: 'none' }, true), [])
  assert.equal(hasAttachmentTurn(['data:image/png;base64,x'], []), true)
  assert.equal(hasAttachmentTurn([], [{ id: 'a1' }]), true)
  assert.equal(hasAttachmentTurn([], []), false)
  assert.equal(hasAttachmentTurn(undefined, undefined), false)
})

test('memory rule: a turn with images writes nothing, posts the skipped tag and keeps the image mark', async () => {
  for (const scope of [{ kind: 'global' }, docScope, { kind: 'none' }]) {
    const { chat, events } = make()
    await chat.load()
    const conversation = chat.newConversation(scope.kind === 'doc' ? docScope : scope.kind === 'none' ? { kind: 'none' } : { kind: 'global' })
    await chat.send(conversation.id, '看图', optionsFor(scope, { attachments: { images: ['data:image/png;base64,AAAA'] } }))
    assert.equal(events.length, 0, `scope ${scope.kind} with images`)
    const user = conversation.messages[0]
    assert.equal(user.memory.skipped, 'attachments')
    assert.equal(user.attach.images, 1)
    assert.deepEqual(user.images, ['data:image/png;base64,AAAA'])
  }
})

test('memory rule: a conversation with any document attachment never writes memory', async () => {
  const { chat, events } = make()
  await chat.load()
  const conversation = chat.newConversation({ kind: 'global' })
  conversation.attachments = [{ id: 'a1', source: 'temp', title: '临时文档 1', kind: 'pdf', addedAt: 1 }]
  await chat.send(conversation.id, '问题', optionsFor({ kind: 'global' }))
  assert.equal(events.length, 0)
  assert.equal(conversation.messages[0].memory.skipped, 'attachments')
})

test('memory rule: an expired document chip still counts as an attachment', async () => {
  const { chat, events } = make()
  await chat.load()
  const conversation = chat.newConversation(docScope)
  conversation.attachments = [{ id: 'a1', source: 'temp', title: '临时文档 1', kind: 'pdf', addedAt: 1 }]
  await chat.send(conversation.id, '问题', optionsFor(docScope))
  assert.equal(events.length, 0)
})

test('memory rule: a document-scope turn without attachments still emits one event with turnId', async () => {
  const { chat, events } = make()
  await chat.load()
  const conversation = chat.newConversation(docScope)
  await chat.send(conversation.id, '问题', optionsFor(docScope))
  assert.equal(events.length, 1)
  assert.equal(events[0].scope.kind, 'doc')
  assert.equal(events[0].turnId, conversation.messages[0].id)
  assert.equal(conversation.messages[0].memory.skipped, undefined)
})

test('memory rule: draft documents passed in options mark the message and skip memory', async () => {
  const { chat, events } = make()
  await chat.load()
  const conversation = chat.newConversation(docScope)
  await chat.send(conversation.id, '问题', optionsFor(docScope, { attachments: { docs: attachmentDocs } }))
  assert.equal(events.length, 0)
  const user = conversation.messages[0]
  assert.equal(user.memory.skipped, 'attachments')
  assert.deepEqual(user.attach.docs, [{ aid: 'a1', source: 'library', docId: 'd1', title: '线代A' }])
})
