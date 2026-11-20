import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emitLearningEvent, onLearningEvent, resetLearningEvents } from '../../src/memory/events.ts'

const event = (index = 0) => ({ type: 'reading', docId: `d${index}`, title: `t${index}`, page: 1, pageCount: 10, progress: 0.1, at: index })

test('events: dispatches to listeners', () => {
  resetLearningEvents()
  const seen = []
  onLearningEvent(value => seen.push(value))
  const first = event()
  emitLearningEvent(first)
  assert.equal(seen.length, 1)
  assert.equal(seen[0], first)
})

test('events: queues while nobody listens and replays on the first listener', async () => {
  resetLearningEvents()
  emitLearningEvent(event(0))
  emitLearningEvent(event(1))
  emitLearningEvent(event(2))
  const seen = []
  onLearningEvent(value => seen.push(value.docId))
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(seen, ['d0', 'd1', 'd2'])
})

test('events: the backlog keeps the newest 200', async () => {
  resetLearningEvents()
  for (let index = 0; index < 250; index++) emitLearningEvent(event(index))
  const seen = []
  onLearningEvent(value => seen.push(value.docId))
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(seen.length, 200)
  assert.equal(seen[0], 'd50')
  assert.equal(seen.at(-1), 'd249')
})

test('events: a throwing listener does not break the others', () => {
  resetLearningEvents()
  let received = 0
  onLearningEvent(() => { throw new Error('boom') })
  onLearningEvent(() => { received++ })
  assert.doesNotThrow(() => emitLearningEvent(event()))
  assert.equal(received, 1)
})

test('events: unsubscribe stops delivery', () => {
  resetLearningEvents()
  let received = 0
  const off = onLearningEvent(() => { received++ })
  emitLearningEvent(event())
  off()
  emitLearningEvent(event())
  assert.equal(received, 1)
})
