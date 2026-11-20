import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseJsonSafe, cleanText, cleanLine, cleanList, normalizeOnboarding, normalizeDocumentMemory,
  normalizeGlobalMemory, normalizeMemoryIndex, normalizeMemorySettings, utf8Bytes,
  normalizeProfile, normalizePending, normalizeEvidence, normalizeManual, normalizeReading,
} from '../../src/memory/normalize.ts'
import { LIMITS, docMemoryKey } from '../../src/memory/types.ts'

test('normalize: parseJsonSafe never throws', () => {
  assert.equal(parseJsonSafe(null), undefined)
  assert.equal(parseJsonSafe(''), undefined)
  assert.equal(parseJsonSafe('{bad'), undefined)
  assert.deepEqual(parseJsonSafe('{"a":1}'), { a: 1 })
})

test('normalize: cleanText strips control characters, trims and clamps', () => {
  assert.equal(cleanText('  a\u0000b  ', 10), 'ab')
  assert.equal(cleanText(123, 10), '')
  assert.equal(cleanText('x'.repeat(50), 10).length, 10)
})

test('normalize: cleanLine collapses all whitespace', () => {
  assert.equal(cleanLine('a\n\n  b\tc', 20), 'a b c')
})

test('normalize: cleanList dedupes by normalized key and splits strings', () => {
  assert.deepEqual(cleanList([' A ', 'a', '', 5, 'B'], 5, 10), ['A', 'B'])
  assert.deepEqual(cleanList('甲，乙；丙\n丁', 3, 10), ['甲', '乙', '丙'])
  assert.deepEqual(cleanList(null, 3, 10), [])
  assert.deepEqual(cleanList({}, 3, 10), [])
})

test('normalize: onboarding needs two valid 1–4 levels', () => {
  assert.deepEqual(normalizeOnboarding({ docLevel: 2, fieldLevel: 1 }), { docLevel: 2, fieldLevel: 1, goal: '', preference: '', note: '', answeredAt: 0, source: 'import' })
  assert.deepEqual(normalizeOnboarding({ docLevel: 2, fieldLevel: 1, goal: ' 通过考试 ', preference: ' 多举例 ', note: '补充', answeredAt: 3, source: 'manual' }), { docLevel: 2, fieldLevel: 1, goal: '通过考试', preference: '多举例', note: '补充', answeredAt: 3, source: 'manual' })
  assert.equal(normalizeOnboarding({ docLevel: 5, fieldLevel: 1 }), null)
  assert.equal(normalizeOnboarding({ docLevel: '2', fieldLevel: 1 }), null)
  assert.equal(normalizeOnboarding(null), null)
})

test('normalize: document memory rejects garbage, newer versions and mismatched ids', () => {
  assert.equal(normalizeDocumentMemory(undefined, 'd1'), null)
  assert.equal(normalizeDocumentMemory('text', 'd1'), null)
  assert.equal(normalizeDocumentMemory([], 'd1'), null)
  assert.equal(normalizeDocumentMemory({ version: 2, docId: 'd1' }, 'd1'), null)
  assert.equal(normalizeDocumentMemory({ docId: 'other' }, 'd1'), null)
})

test('normalize: empty document memory is filled with defaults', () => {
  const memory = normalizeDocumentMemory({}, 'd1')
  assert.equal(memory.version, 1)
  assert.equal(memory.docId, 'd1')
  assert.deepEqual(memory.profile, { goals: [], level: '', interests: [], strengths: [], weaknesses: [], misconceptions: [], preferences: [] })
  assert.deepEqual(memory.pending, [])
  assert.deepEqual(memory.manual, { locked: {}, pinned: {}, suppressed: [] })
  assert.equal(memory.status.state, 'idle')
  assert.equal(memory.onboarding, null)
})

test('normalize: document memory truncates long fields and drops bad entries', () => {
  const memory = normalizeDocumentMemory({ summary: 'x'.repeat(3000) }, 'd1')
  assert.equal(memory.summary.length, LIMITS.summary)
  const pending = Array.from({ length: 40 }, (_, index) => ({ kind: 'assistant-turn', at: index, question: index < 2 ? '' : `q${index}`, answer: 'a' }))
  const kept = normalizeDocumentMemory({ pending }, 'd1')
  assert.equal(kept.pending.length, LIMITS.pending)
  assert.equal(kept.pending.at(-1).question, 'q39')
  const evidence = normalizeDocumentMemory({ evidence: [{ kind: 'bogus', text: 'x' }, { kind: 'assistant', text: 'ok' }] }, 'd1')
  assert.equal(evidence.evidence.length, 1)
  assert.doesNotThrow(() => normalizeDocumentMemory({ profile: 'oops', reading: null, manual: 7 }, 'd1'))
})

test('normalize: document memory stays below the byte limit for pathological input', () => {
  const memory = normalizeDocumentMemory({
    summary: '超'.repeat(200000),
    pending: Array.from({ length: 40 }, (_, index) => ({ kind: 'chat-turn', at: index, question: '问'.repeat(5000), answer: '答'.repeat(5000) })),
    evidence: Array.from({ length: 60 }, (_, index) => ({ kind: 'chat', at: index, text: '证'.repeat(5000) })),
  }, 'd1')
  assert.ok(utf8Bytes(JSON.stringify(memory)) <= LIMITS.docBytes)
})

test('normalize: global memory forces misconceptions empty and tolerates garbage', () => {
  assert.deepEqual(normalizeGlobalMemory({ profile: { misconceptions: ['x'] } }).profile.misconceptions, [])
  assert.doesNotThrow(() => normalizeGlobalMemory(undefined))
  const global = normalizeGlobalMemory({ profile: { goals: ['g'] }, themes: ['t'], sources: [{ docId: 'a', title: 'A' }] })
  assert.deepEqual(global.profile.goals, ['g'])
  assert.deepEqual(global.themes, ['t'])
  assert.equal(global.sources.length, 1)
})

test('normalize: memory index must be an object, dedupes ids and caps entries', () => {
  assert.equal(normalizeMemoryIndex(undefined), null)
  assert.equal(normalizeMemoryIndex('x'), null)
  const index = normalizeMemoryIndex({ docs: [{ docId: 'a', updatedAt: 1 }, { docId: 'a', updatedAt: 5 }, { title: '没有 id' }] })
  assert.equal(index.docs.length, 1)
  assert.equal(index.docs[0].updatedAt, 5)
  const many = normalizeMemoryIndex({ docs: Array.from({ length: 2500 }, (_, i) => ({ docId: `d${i}`, updatedAt: i })) })
  assert.equal(many.docs.length, LIMITS.indexDocs)
  assert.ok(many.docs.every(entry => entry.updatedAt >= 500))
})

test('normalize: memory settings defaults and strict off', () => {
  assert.equal(normalizeMemorySettings({}).autoUpdate, true)
  assert.equal(normalizeMemorySettings({ autoUpdate: false }).autoUpdate, false)
  assert.equal(normalizeMemorySettings({ autoUpdate: 0 }).autoUpdate, true)
  assert.deepEqual(normalizeMemorySettings({}).budget, { day: '', runs: 0 })
})

test('normalize: helper normalizers tolerate broken structures', () => {
  assert.deepEqual(normalizeProfile('oops'), { goals: [], level: '', interests: [], strengths: [], weaknesses: [], misconceptions: [], preferences: [] })
  assert.deepEqual(normalizePending([{ kind: 'nope', question: 'q' }]), [])
  assert.deepEqual(normalizeEvidence([{ kind: 'reading', text: '' }]), [])
  assert.deepEqual(normalizeManual({ locked: { summary: -1, level: 3 }, pinned: { goals: 'x' } }), { locked: { level: 3 }, pinned: {}, suppressed: [] })
  assert.deepEqual(normalizeReading(null), { page: 1, pageCount: 1, progress: 0, maxProgress: 0, sessions: 0, firstOpenedAt: 0, lastOpenedAt: 0, activeDays: 0, lastDay: '', questions: 0 })
  assert.equal(normalizeReading({ progress: 0.5, maxProgress: 0.2 }).maxProgress, 0.5)
})

test('normalize: storage keys satisfy the backend key rule', () => {
  const uuid = '7c1e5f0a-3b42-4d1c-9a6e-2f8d0b1c4e55'
  const rule = /^[a-zA-Z0-9._-]{1,100}$/
  assert.ok(rule.test(docMemoryKey(uuid)))
  assert.ok(rule.test(docMemoryKey('a b/c')))
  assert.equal(docMemoryKey('a b/c'), 'memory.v1.doc.a_b_c')
})
