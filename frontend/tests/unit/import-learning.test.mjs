import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  importer, learning, learningReady, currentLearningAnswers, markLearningRecorded,
  setLearningEnabled, resetLearningAnswers, enqueue, runQueue,
} from '../../src/library/importer.ts'

let store
beforeEach(() => {
  store = new Map()
  globalThis.localStorage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
  }
  importer.items.length = 0
  importer.running = false
  setLearningEnabled(false)
  resetLearningAnswers()
})
afterEach(() => {
  delete globalThis.localStorage
  importer.items.length = 0
  importer.running = false
  resetLearningAnswers()
})
const answers = (docLevel = 2, fieldLevel = 3, note = '') => ({ docLevel, fieldLevel, note, answeredAt: 42, source: 'import' })

test('import learning: ready when the switch is off', () => {
  assert.equal(learning.enabled, false)
  assert.equal(learningReady(), true)
  assert.equal(currentLearningAnswers(), null)
})

test('import learning: not ready while a question is unanswered', () => {
  setLearningEnabled(true)
  learning.docLevel = 2
  assert.equal(learningReady(), false)
  assert.equal(currentLearningAnswers(), null)
})

test('import learning: both answers make a ready payload', () => {
  setLearningEnabled(true)
  learning.docLevel = 2
  learning.fieldLevel = 3
  learning.note = '  备注  '
  const payload = currentLearningAnswers(1234)
  assert.deepEqual(payload, { docLevel: 2, fieldLevel: 3, note: '备注', answeredAt: 1234, source: 'import' })
})

test('import learning: the note is clamped to 200 characters', () => {
  setLearningEnabled(true)
  learning.docLevel = 1
  learning.fieldLevel = 1
  learning.note = '字'.repeat(300)
  assert.equal(currentLearningAnswers(1).note.length, 200)
})

test('import learning: every queued item gets its own copy of the answers', () => {
  const source = answers()
  const added = enqueue(['C:\\a.pdf', 'C:\\b.md', 'C:\\c.docx'], source)
  assert.equal(added.length, 3)
  assert.ok(added.every(item => item.onboarding))
  assert.deepEqual(added.map(item => item.onboarding.docLevel), [2, 2, 2])
  assert.notEqual(added[0].onboarding, added[1].onboarding)
  assert.notEqual(added[0].onboarding, source)
})

test('import learning: unsupported files never carry answers', () => {
  const added = enqueue(['C:\\a.pdf', 'C:\\x.xlsx'], answers())
  assert.ok(added[0].onboarding)
  assert.equal(added[1].status, 'error')
  assert.equal(added[1].onboarding, undefined)
})

test('import learning: without answers nothing is attached', () => {
  assert.equal(enqueue(['C:\\a.pdf'])[0].onboarding, undefined)
  assert.equal(enqueue(['C:\\b.pdf'], null)[0].onboarding, undefined)
})

test('import learning: the answers travel with each item to the import callback', async () => {
  importer.items.length = 0
  enqueue(['C:\\a.pdf', 'C:\\b.pdf'], answers(4, 1))
  const seen = []
  await runQueue(async path => [{ id: path, name: path }], (docs, item) => seen.push([docs[0].id, item.onboarding?.docLevel]))
  assert.deepEqual(seen, [['C:\\a.pdf', 4], ['C:\\b.pdf', 4]])
})

test('import learning: failed imports never reach the callback', async () => {
  importer.items.length = 0
  enqueue(['C:\\ok.pdf', 'C:\\bad.pdf'], answers())
  const seen = []
  await runQueue(async path => {
    if (path.includes('bad')) throw new Error('nope')
    return [{ id: path, name: path }]
  }, (docs, item) => seen.push([docs[0].id, item.onboarding?.docLevel]))
  assert.deepEqual(seen, [['C:\\ok.pdf', 2]])
  assert.equal(importer.items.find(item => item.path.includes('bad')).status, 'error')
})

test('import learning: a second batch queued while running keeps its own answers', async () => {
  importer.items.length = 0
  let release
  const gate = new Promise(resolve => { release = resolve })
  const seen = []
  enqueue(['C:\\first.pdf'], answers(1, 1))
  const running = runQueue(async path => { await gate; return [{ id: path, name: path }] }, (docs, item) => seen.push([docs[0].id, item.onboarding?.docLevel]))
  enqueue(['C:\\second.pdf'], answers(4, 3))
  release()
  await running
  assert.deepEqual(seen, [['C:\\first.pdf', 1], ['C:\\second.pdf', 4]])
})

test('import learning: recording a batch clears the answers but remembers the count', () => {
  setLearningEnabled(true)
  learning.docLevel = 3
  learning.fieldLevel = 2
  learning.note = '备注'
  markLearningRecorded(3)
  assert.deepEqual([learning.docLevel, learning.fieldLevel, learning.note, learning.recorded], [0, 0, '', 3])
  assert.equal(learning.enabled, true)
})

test('import learning: the switch remembers itself and clears answers when turned off', () => {
  setLearningEnabled(true)
  learning.docLevel = 2
  learning.fieldLevel = 2
  assert.equal(store.get('kaizhi.import.learning.v1'), '1')
  setLearningEnabled(false)
  assert.equal(store.get('kaizhi.import.learning.v1'), '0')
  assert.deepEqual([learning.docLevel, learning.fieldLevel, learning.note], [0, 0, ''])
})

test('import learning: no localStorage does not throw', () => {
  delete globalThis.localStorage
  assert.doesNotThrow(() => setLearningEnabled(true))
  setLearningEnabled(false)
})
