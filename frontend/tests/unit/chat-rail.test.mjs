import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  CHAT_RAIL_KEY, filterConversations, loadRailPreference, normalizeRailPreference, railRows, saveRailPreference,
} from '../../src/chat/rail.ts'

const entry = (id, title, updatedAt, count = 2) => ({ id, title, createdAt: 1, updatedAt, scope: { kind: 'global' }, count })

let local
beforeEach(() => {
  local = new Map()
  globalThis.localStorage = { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, String(value)), removeItem: key => local.delete(key) }
})
afterEach(() => { delete globalThis.localStorage })

const source = async path => readFile(new URL('../../src/' + path, import.meta.url), 'utf8')

test('chat rail: search only looks at titles and ignores case and full-width spaces', () => {
  const list = [entry('a', '线性代数复习计划', 3), entry('b', 'MIT 18.06 讲义', 2), entry('c', '', 1)]
  assert.deepEqual(filterConversations(list, '').map(item => item.id), ['a', 'b', 'c'])
  assert.deepEqual(filterConversations(list, '   ').map(item => item.id), ['a', 'b', 'c'])
  assert.deepEqual(filterConversations(list, 'mit').map(item => item.id), ['b'])
  assert.deepEqual(filterConversations(list, '线性　代数').map(item => item.id), ['a'])
  assert.deepEqual(filterConversations(list, '不存在'), [])
})

test('chat rail: rows are newest first and the unfinished active conversation is pinned on top', () => {
  const list = [entry('a', 'A', 1), entry('b', 'B', 3), entry('c', 'C', 2)]
  assert.deepEqual(railRows(list, 'b', null).map(row => row.id), ['b', 'c', 'a'])
  const draft = railRows(list, 'live', { id: 'live', title: '', createdAt: 9, updatedAt: 9, scope: { kind: 'global' }, messageCount: 0 })
  assert.deepEqual(draft.map(row => row.id), ['live', 'b', 'c', 'a'])
  assert.equal(draft[0].draft, true)
  // 已经在清单里的当前会话不再补一行。
  assert.equal(railRows(list, 'b', { id: 'b', title: 'B', createdAt: 1, updatedAt: 3, scope: { kind: 'global' }, messageCount: 4 }).length, 3)
  // 当前会话有消息、但清单还没落库时补一行，不带 draft。
  const fresh = railRows(list, 'live', { id: 'live', title: '第一问', createdAt: 9, updatedAt: 9, scope: { kind: 'global' }, messageCount: 2 })
  assert.equal(fresh[0].id, 'live')
  assert.equal(fresh[0].draft, undefined)
  // 不是当前会话就不补。
  assert.equal(railRows(list, 'a', { id: 'live', title: '', createdAt: 9, updatedAt: 9, scope: { kind: 'global' }, messageCount: 0 }).length, 3)
})

test('chat rail: only conversations that have messages are listed', () => {
  const list = [entry('a', 'A', 1, 0), entry('b', 'B', 2, 1)]
  assert.deepEqual(railRows(list, '', null).map(row => row.id), ['b'])
})

test('chat rail: the collapsed preference round-trips and tolerates broken storage', () => {
  assert.deepEqual(normalizeRailPreference(null), { version: 1, collapsed: false })
  assert.deepEqual(normalizeRailPreference({ collapsed: true }), { version: 1, collapsed: true })
  assert.deepEqual(normalizeRailPreference({ collapsed: 'yes' }), { version: 1, collapsed: false })
  saveRailPreference({ version: 1, collapsed: true })
  assert.equal(local.get(CHAT_RAIL_KEY), '{"version":1,"collapsed":true}')
  assert.deepEqual(loadRailPreference(), { version: 1, collapsed: true })
  local.set(CHAT_RAIL_KEY, '{bad')
  assert.deepEqual(loadRailPreference(), { version: 1, collapsed: false })
  const broken = { getItem: () => { throw new Error('blocked') } }
  assert.deepEqual(loadRailPreference(broken), { version: 1, collapsed: false })
})

test('chat rail: the page no longer hosts a history panel and keeps the scope picker in the composer', async () => {
  const page = await source('components/chat/ChatModePage.vue')
  assert.equal(page.includes('ChatHistoryPanel'), false)
  assert.equal(page.includes('历史'), false)
  assert.ok(page.includes('<template #scope>'))
  assert.ok(page.includes('<MemoryScopePicker up '))
  const header = page.slice(page.indexOf('<header'), page.indexOf('</header>'))
  assert.ok(!header.includes('MemoryScopePicker'))
  assert.ok(page.includes('aria-label="对话模式"'))
})

test('chat rail: the rail exposes its a11y hooks and the drawer is a modal dialog', async () => {
  const rail = await source('components/chat/ChatConversationRail.vue')
  assert.ok(rail.includes('aria-label="对话列表"'))
  assert.ok(rail.includes('aria-current'))
  assert.ok(rail.includes('maxlength'))
  assert.ok(rail.includes("'dialog'"))
  assert.ok(rail.includes('aria-modal'))
  assert.ok(rail.includes('<ul'))
  assert.ok(rail.includes('aria-label="搜索对话标题"'))
  assert.ok(rail.includes('role="status"'))
  assert.ok(rail.includes('最多保留最近 40 段对话'))
  assert.ok(rail.includes('F2'))
})

test('chat rail: the rail styles follow the scoped-style rule and reduced motion', async () => {
  const rail = await source('components/chat/ChatConversationRail.vue')
  const style = rail.slice(rail.indexOf('<style'))
  assert.doesNotMatch(style, /:global\([^)]*\)\s*[.#:[a-z]/i)
  assert.ok(style.includes('prefers-reduced-motion'))
  assert.ok(style.includes('forced-colors'))
})
