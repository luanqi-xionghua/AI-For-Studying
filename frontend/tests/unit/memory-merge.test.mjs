import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyEvent, applyGlobalTurn, applyOnboarding, mergeList, mergeDocumentSummary, mergeGlobalSummary,
  diffEdit, applyManualEdit, removeListItem, removeEvidence, unlockField, markFailure,
  toIndexEntry, toDocMeta, hasMemoryContent,
} from '../../src/memory/merge.ts'
import { emptyDocumentMemory, emptyGlobalMemory } from '../../src/memory/normalize.ts'
import { LIMITS } from '../../src/memory/types.ts'

const NOW = 1_700_000_000_000
const DAY = 86_400_000
const doc = (overrides = {}) => ({ ...emptyDocumentMemory('d1', '书', NOW), ...overrides })
const profile = (overrides = {}) => ({
  goals: [], level: '', interests: [], strengths: [], weaknesses: [], misconceptions: [], preferences: [], ...overrides,
})
const assistantTurn = (overrides = {}) => ({ type: 'assistant-turn', docId: 'd1', title: '书', conversationId: 'c1', question: '问题', answer: '回答', at: NOW, ...overrides })
const onboardingEvent = (overrides = {}) => ({
  type: 'onboarding', docId: 'd1', title: '书',
  answers: { docLevel: 3, fieldLevel: 2, note: '补充', answeredAt: NOW, source: 'import' },
  importId: 'abcdefgh1234', at: NOW, ...overrides,
})

test('merge: a successful turn lands in pending, evidence and the question counter', () => {
  const result = applyEvent(doc(), assistantTurn(), NOW)
  assert.equal(result.pending.length, 1)
  assert.equal(result.evidence.length, 1)
  assert.deepEqual([result.evidence[0].kind, result.evidence[0].ref], ['assistant', '阅读助手'])
  assert.equal(result.reading.questions, 1)
  assert.equal(result.revision, 1)
})

test('merge: pending keeps only the newest 24 turns', () => {
  let memory = doc()
  for (let index = 0; index < 30; index++) memory = applyEvent(memory, assistantTurn({ question: `q${index}`, at: NOW + index }), NOW + index)
  assert.equal(memory.pending.length, LIMITS.pending)
  assert.equal(memory.pending.at(-1).question, 'q29')
})

test('merge: reading milestones add one evidence at 25% only once', () => {
  const reading = progress => ({ type: 'reading', docId: 'd1', title: '书', page: 1, pageCount: 100, progress, at: NOW })
  let memory = applyEvent(doc(), reading(0.2), NOW)
  assert.equal(memory.evidence.length, 0)
  memory = applyEvent(memory, reading(0.3), NOW)
  assert.equal(memory.evidence.length, 1)
  assert.equal(memory.evidence[0].text, '读到全书的 25%')
  memory = applyEvent(memory, reading(0.35), NOW)
  assert.equal(memory.evidence.length, 1)
  assert.equal(memory.reading.maxProgress, 0.35)
})

test('merge: progress can go back but maxProgress never drops', () => {
  const reading = progress => ({ type: 'reading', docId: 'd1', title: '书', page: 1, pageCount: 100, progress, at: NOW })
  let memory = applyEvent(doc(), reading(0.5), NOW)
  memory = applyEvent(memory, reading(0.3), NOW)
  assert.equal(memory.reading.progress, 0.3)
  assert.equal(memory.reading.maxProgress, 0.5)
})

test('merge: activeDays counts distinct local days', () => {
  const opened = (at) => ({ type: 'opened', docId: 'd1', title: '书', page: 1, pageCount: 10, progress: 0, at })
  let memory = applyEvent(doc(), opened(NOW), NOW)
  assert.equal(memory.reading.activeDays, 1)
  memory = applyEvent(memory, opened(NOW + 1000), NOW + 1000)
  assert.equal(memory.reading.activeDays, 1)
  memory = applyEvent(memory, opened(NOW + DAY), NOW + DAY)
  assert.equal(memory.reading.activeDays, 2)
})

test('merge: onboarding creates the initial rule-based memory', () => {
  const { memory, changed } = applyOnboarding(null, onboardingEvent(), NOW)
  assert.equal(changed, true)
  assert.equal(memory.onboarding.docLevel, 3)
  assert.ok(memory.summary.startsWith('导入时自评：'))
  assert.equal(memory.dirty, true)
  assert.equal(memory.evidence[0].id, 'ob-abcdefgh')
  assert.ok(memory.profile.level.startsWith('自评：'))
})

test('merge: onboarding only fills a missing self-assessment', () => {
  const memory = doc({ summary: '用户写的' })
  const { memory: next } = applyOnboarding(memory, onboardingEvent(), NOW)
  assert.equal(next.onboarding.docLevel, 3)
  assert.equal(next.summary, '用户写的')
})

test('merge: onboarding never overwrites an existing self-assessment', () => {
  const memory = doc({ onboarding: { docLevel: 1, fieldLevel: 1, note: '', answeredAt: NOW, source: 'import' } })
  const { memory: next, changed } = applyOnboarding(memory, onboardingEvent({ answers: { docLevel: 4, fieldLevel: 4, note: '', answeredAt: NOW, source: 'import' } }), NOW)
  assert.equal(changed, true)
  assert.equal(next.onboarding.docLevel, 1)
  assert.ok(next.evidence.some(item => item.text.includes('未替换原自评')))
})

test('merge: the same onboarding import is idempotent', () => {
  const event = onboardingEvent()
  const first = applyOnboarding(null, event, NOW).memory
  const second = applyOnboarding(first, event, NOW)
  assert.equal(second.changed, false)
  assert.equal(JSON.stringify(second.memory), JSON.stringify(first))
})

test('merge: mergeList keeps pinned first and filters duplicates and suppressed', () => {
  assert.deepEqual(mergeList(['甲'], ['乙', ' 甲 ', '丙', '丁'], ['丙'], 3), ['甲', '乙', '丁'])
})

test('merge: a normal document summary replaces the fields and clears pending', () => {
  const latest = doc({ pending: [{ id: 'a', kind: 'assistant-turn', at: NOW, question: 'q', answer: 'a' }] })
  const result = mergeDocumentSummary(latest, { summary: 'S', profile: profile({ goals: ['g'], level: 'L' }), questions: ['q'] }, { consumedIds: ['a'], now: NOW })
  assert.equal(result.summary, 'S')
  assert.deepEqual(result.profile.goals, ['g'])
  assert.deepEqual(result.questions, ['q'])
  assert.equal(result.pending.length, 0)
  assert.equal(result.summarizedAt, NOW)
  assert.equal(result.dirty, false)
  assert.equal(result.status.failures, 0)
})

test('merge: locked fields survive a summary', () => {
  const latest = doc({ summary: '手写', manual: { locked: { summary: NOW - 1 }, pinned: {}, suppressed: [] } })
  const result = mergeDocumentSummary(latest, { summary: '模型', profile: profile(), questions: [] }, { consumedIds: [], now: NOW })
  assert.equal(result.summary, '手写')
})

test('merge: pinned items stay in front, suppressed items never come back', () => {
  const latest = doc({ profile: profile({ weaknesses: ['A'] }), manual: { locked: {}, pinned: { weaknesses: ['A'] }, suppressed: ['b'] } })
  const result = mergeDocumentSummary(latest, { summary: 'S', profile: profile({ weaknesses: ['B', 'C'] }), questions: [] }, { consumedIds: [], now: NOW })
  assert.deepEqual(result.profile.weaknesses, ['A', 'C'])
})

test('merge: an empty summary result does not wipe existing arrays', () => {
  const latest = doc({ profile: profile({ interests: ['x'] }) })
  const result = mergeDocumentSummary(latest, { summary: 'S', profile: profile(), questions: [] }, { consumedIds: [], now: NOW })
  assert.deepEqual(result.profile.interests, ['x'])
})

test('merge: only the consumed turns leave pending', () => {
  const pending = ['a', 'b', 'c'].map(id => ({ id, kind: 'assistant-turn', at: NOW, question: id, answer: '' }))
  const latest = doc({ pending })
  const result = mergeDocumentSummary(latest, { summary: 'S', profile: profile(), questions: [] }, { consumedIds: ['a', 'b'], now: NOW })
  assert.deepEqual(result.pending.map(item => item.id), ['c'])
})

test('merge: empty questions fall back to the consumed questions', () => {
  const latest = doc({ pending: [{ id: 'a', kind: 'assistant-turn', at: NOW, question: '这是一个很长的问题'.repeat(10), answer: '' }] })
  const result = mergeDocumentSummary(latest, { summary: 'S', profile: profile(), questions: [] }, { consumedIds: ['a'], now: NOW })
  assert.equal(result.questions.length, 1)
  assert.ok(result.questions[0].length <= 24)
})

test('merge: diffEdit only reports fields whose normalized values changed', () => {
  assert.deepEqual(diffEdit({ summary: 'a', goals: ['x'] }, { summary: 'b', goals: ['x', '', '  '] }), { summary: 'b' })
})

test('merge: manual text edits lock the field', () => {
  const result = applyManualEdit(doc({ summary: '旧' }), { summary: '新的' }, NOW)
  assert.equal(result.summary, '新的')
  assert.equal(result.manual.locked.summary, NOW)
  assert.equal(result.dirty, true)
  assert.ok(result.evidence.some(item => item.kind === 'manual'))
})

test('merge: manual array edits pin the new list and suppress removed items', () => {
  const latest = doc({ profile: profile({ weaknesses: ['A', 'B'] }) })
  const result = applyManualEdit(latest, { weaknesses: ['A', 'C'] }, NOW)
  assert.deepEqual(result.profile.weaknesses, ['A', 'C'])
  assert.deepEqual(result.manual.pinned.weaknesses, ['A', 'C'])
  assert.ok(result.manual.suppressed.includes('b'))
})

test('merge: adding back a suppressed item removes it from the blocklist', () => {
  const latest = doc({ manual: { locked: {}, pinned: {}, suppressed: ['b'] } })
  const result = applyManualEdit(latest, { weaknesses: ['B'] }, NOW)
  assert.equal(result.manual.suppressed.includes('b'), false)
})

test('merge: removing one item updates the array, pinned list and blocklist', () => {
  const latest = doc({ profile: profile({ weaknesses: ['A', 'B'] }), manual: { locked: {}, pinned: { weaknesses: ['A'] }, suppressed: [] } })
  const result = removeListItem(latest, 'weaknesses', 'A', NOW)
  assert.deepEqual(result.profile.weaknesses, ['B'])
  assert.deepEqual(result.manual.pinned.weaknesses, [])
  assert.ok(result.manual.suppressed.includes('a'))
})

test('merge: unlocking keeps the text and drops the lock', () => {
  const latest = doc({ manual: { locked: { summary: NOW - 5 }, pinned: {}, suppressed: [] } })
  const result = unlockField(latest, 'summary', NOW)
  assert.equal(result.manual.locked.summary, undefined)
  assert.equal(result.summary, latest.summary)
})

test('merge: failures follow the retry table and stop auto-retrying at three', () => {
  let memory = doc()
  memory = markFailure(memory, 'e1', NOW)
  assert.deepEqual([memory.status.failures, memory.status.nextRetryAt], [1, NOW + 300_000])
  memory = markFailure(memory, 'e2', NOW)
  assert.deepEqual([memory.status.failures, memory.status.nextRetryAt], [2, NOW + 1_800_000])
  memory = markFailure(memory, 'e3', NOW)
  assert.deepEqual([memory.status.failures, memory.status.nextRetryAt], [3, 0])
})

test('merge: removing evidence only drops that evidence', () => {
  const latest = doc({ evidence: [{ id: 'e1', kind: 'manual', at: NOW, text: 'a' }, { id: 'e2', kind: 'manual', at: NOW, text: 'b' }] })
  const result = removeEvidence(latest, 'e1', NOW)
  assert.deepEqual(result.evidence.map(item => item.id), ['e2'])
})

test('merge: the global summary replaces sources and clears removed', () => {
  const latest = emptyGlobalMemory(NOW)
  latest.removed = ['旧书']
  latest.pending = [{ id: 'p', kind: 'chat-turn', at: NOW, question: 'q', answer: '' }]
  const sources = [{ docId: 'a', title: 'A', summarizedAt: NOW, note: 'n' }]
  const result = mergeGlobalSummary(latest, { summary: 'G', profile: profile({ goals: ['g'] }), themes: ['t'] }, { consumedIds: ['p'], sources, now: NOW })
  assert.deepEqual(result.sources, sources)
  assert.deepEqual(result.removed, [])
  assert.deepEqual(result.profile.misconceptions, [])
  assert.deepEqual(result.themes, ['t'])
  assert.equal(result.pending.length, 0)
})

test('merge: a global turn goes into the global pending queue', () => {
  const result = applyGlobalTurn(emptyGlobalMemory(NOW), { type: 'chat-turn', scope: { kind: 'global' }, conversationId: 'c', question: 'q', answer: 'a', at: NOW }, NOW)
  assert.equal(result.pending.length, 1)
  assert.equal(result.evidence[0].ref, '对话模式 · 全局记忆')
})

test('merge: helpers describe the memory', () => {
  const memory = doc({ summary: 'S' })
  assert.equal(hasMemoryContent(memory), true)
  assert.equal(hasMemoryContent(emptyDocumentMemory('d1', '书', NOW)), false)
  const entry = toIndexEntry({ ...memory, pending: [{ id: 'a', kind: 'assistant-turn', at: NOW, question: 'q', answer: '' }] })
  assert.equal(entry.pending, 1)
  assert.equal(entry.docId, 'd1')
  const meta = toDocMeta(memory)
  assert.deepEqual([meta.docId, meta.turns], ['d1', 0])
})

test('merge: pure functions never mutate their input', () => {
  const latest = doc({ profile: profile({ weaknesses: ['A'] }), manual: { locked: { summary: NOW }, pinned: { weaknesses: ['A'] }, suppressed: ['x'] } })
  const snapshot = JSON.stringify(latest)
  applyEvent(latest, assistantTurn(), NOW)
  applyOnboarding(latest, onboardingEvent(), NOW)
  mergeDocumentSummary(latest, { summary: 'S', profile: profile({ weaknesses: ['B'] }), questions: [] }, { consumedIds: [], now: NOW })
  applyManualEdit(latest, { summary: '新', weaknesses: ['C'] }, NOW)
  removeListItem(latest, 'weaknesses', 'A', NOW)
  markFailure(latest, 'e', NOW)
  assert.equal(JSON.stringify(latest), snapshot)
  const global = emptyGlobalMemory(NOW)
  const globalSnapshot = JSON.stringify(global)
  applyGlobalTurn(global, { type: 'chat-turn', scope: { kind: 'global' }, conversationId: 'c', question: 'q', answer: 'a', at: NOW }, NOW)
  mergeGlobalSummary(global, { summary: 'G', profile: profile(), themes: [] }, { consumedIds: [], sources: [], now: NOW })
  assert.equal(JSON.stringify(global), globalSnapshot)
})

test('merge: the same turnId replaces the pending answer instead of appending', () => {
  const event = { type: 'chat-turn', scope: { kind: 'global' }, conversationId: 'c', question: 'q', answer: '第一版', at: NOW, turnId: 'turn-1' }
  let memory = applyEvent(doc(), { ...event, scope: { kind: 'doc', docId: 'd1', title: '书' } }, NOW)
  assert.equal(memory.pending.length, 1)
  assert.equal(memory.evidence.length, 1)
  assert.equal(memory.reading.questions, 1)
  memory = applyEvent(memory, { ...event, scope: { kind: 'doc', docId: 'd1', title: '书' }, answer: '第二版', at: NOW + 1000 }, NOW + 1000)
  assert.equal(memory.pending.length, 1)
  assert.equal(memory.pending[0].answer, '第二版')
  assert.equal(memory.pending[0].at, NOW + 1000)
  assert.equal(memory.pending[0].turnId, 'turn-1')
  assert.equal(memory.evidence.length, 1, '重新回答不新增证据')
  assert.equal(memory.reading.questions, 1, '重新回答不重复计问题数')
  assert.equal(memory.evidence[0].text, 'q')
})

test('merge: a different turnId keeps both pending turns', () => {
  const base = { type: 'chat-turn', scope: { kind: 'global' }, conversationId: 'c', question: 'q', at: NOW }
  let memory = applyEvent(doc(), { ...base, scope: { kind: 'doc', docId: 'd1', title: '书' }, answer: 'a', turnId: 'turn-1' }, NOW)
  memory = applyEvent(memory, { ...base, scope: { kind: 'doc', docId: 'd1', title: '书' }, answer: 'b', turnId: 'turn-2', at: NOW + 1 }, NOW + 1)
  assert.equal(memory.pending.length, 2)
  assert.deepEqual(memory.pending.map(item => item.turnId), ['turn-1', 'turn-2'])
})

test('merge: the global pending queue also replaces a repeated turnId', () => {
  const event = { type: 'chat-turn', scope: { kind: 'global' }, conversationId: 'c', question: 'q', answer: '第一版', at: NOW, turnId: 'turn-9' }
  let global = applyGlobalTurn(emptyGlobalMemory(NOW), event, NOW)
  assert.equal(global.pending.length, 1)
  assert.equal(global.evidence.length, 1)
  global = applyGlobalTurn(global, { ...event, answer: '第二版', at: NOW + 500 }, NOW + 500)
  assert.equal(global.pending.length, 1)
  assert.equal(global.pending[0].answer, '第二版')
  assert.equal(global.pending[0].at, NOW + 500)
  assert.equal(global.evidence.length, 1, '重新回答不新增全局证据')
})
