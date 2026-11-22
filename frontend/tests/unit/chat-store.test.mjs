import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createChatStore } from '../../src/chat/storage.ts'
import { CHATMODE_KEYS, CHATMODE_VERSION, conversationKey } from '../../src/chat/types.ts'

function memoryStorage() {
  const map = new Map()
  return {
    map,
    async getSetting(key) { return map.has(key) ? map.get(key) : null },
    async setSetting(key, value) { map.set(key, value) },
    async deleteSetting(key) { map.delete(key) },
  }
}

const conversation = (id, messages = []) => ({
  version: CHATMODE_VERSION,
  id,
  title: id,
  createdAt: 1,
  updatedAt: 1,
  scope: { kind: 'global' },
  messages,
  attachments: [],
})

const message = { id: 'm1', role: 'user', content: '问', at: 1 }

test('chat store: 保存空会话不会留下悬空的 activeId', async () => {
  const storage = memoryStorage()
  const store = createChatStore(storage)
  await store.saveConversation(conversation('fresh'), 'fresh')
  const index = await store.loadIndex()
  // 0 条消息的会话没有清单条目，activeId 也不能指向它，否则重启后会打开一条不存在的记录。
  assert.deepEqual(index.list, [])
  assert.equal(index.activeId, '')
})

test('chat store: 保存有消息的会话会写入清单并保留 activeId', async () => {
  const storage = memoryStorage()
  const store = createChatStore(storage)
  await store.saveConversation(conversation('a', [message]), 'a')
  const index = await store.loadIndex()
  assert.deepEqual(index.list.map(item => item.id), ['a'])
  assert.equal(index.activeId, 'a')
})

test('chat store: 删掉最后一个会话后 activeId 归零', async () => {
  const storage = memoryStorage()
  const store = createChatStore(storage)
  await store.saveConversation(conversation('a', [message]), 'a')
  await store.deleteConversation('a', 'a')
  const index = await store.loadIndex()
  assert.deepEqual(index.list, [])
  assert.equal(index.activeId, '')
})

test('chat store: 删除别的会话时，悬空的 activeId 会被修正', async () => {
  const storage = memoryStorage()
  const store = createChatStore(storage)
  storage.map.set(CHATMODE_KEYS.index, JSON.stringify({
    version: CHATMODE_VERSION,
    activeId: 'ghost',
    list: [{ id: 'b', title: 'b', createdAt: 1, updatedAt: 1, scope: { kind: 'global' }, count: 1 }],
  }))
  await store.deleteConversation('b', 'ghost')
  const index = await store.loadIndex()
  assert.deepEqual(index.list, [])
  assert.equal(index.activeId, '')
})

test('chat store: 缺失的会话键返回 undefined，坏 JSON 返回 null', async () => {
  const storage = memoryStorage()
  const store = createChatStore(storage)
  assert.equal(await store.loadConversation('nope'), undefined)
  storage.map.set(conversationKey('bad'), '{oops')
  assert.equal(await store.loadConversation('bad'), null)
})
