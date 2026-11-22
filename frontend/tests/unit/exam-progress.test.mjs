import { test } from 'node:test'
import assert from 'node:assert/strict'
import { failedBatchesOf, generationPhaseText } from '../../src/exam/progress.ts'
import { createNotifyRelay, NOTIFY_BACKLOG } from '../../src/exam/notify.ts'

const idle = (overrides = {}) => ({
  phase: 'idle', running: false, batch: -1, done: 0, total: 20, error: '', stopped: false,
  failedBatches: [], degradeOffer: null, ...overrides,
})

test('progress: failedBatchesOf 只取 failed，升序，空 meta 返回空数组', () => {
  const meta = { batches: [
    { index: 3, status: 'failed' }, { index: 0, status: 'ok' }, { index: 1, status: 'failed' }, { index: 2, status: 'stopped' },
  ] }
  assert.deepEqual(failedBatchesOf(meta), [1, 3])
  assert.deepEqual(failedBatchesOf(null), [])
  assert.deepEqual(failedBatchesOf({ batches: null }), [])
})

test('progress: 只有在跑时才说「正在…」', () => {
  assert.match(generationPhaseText(idle({ running: true, phase: 'plan' })), /^正在规划试卷/)
  assert.equal(generationPhaseText(idle({ running: true, phase: 'batch', batch: 1, done: 5 }), [6, 7, 8, 9, 10]),
    '正在出第 2 批（第 6–10 题）… 已生成 5/20')
  assert.equal(generationPhaseText(idle({ running: true, phase: 'batch', batch: 1 })), '正在出第 2 批…')
  assert.equal(generationPhaseText(idle({ running: true })), '正在准备出题…')
})

test('progress: 失败 / 失败批次 / 停止 / 降级 / 半成品各有结论，不再残留「正在准备出题…」', () => {
  // 4 批全部失败：状态机设了 error，phase 已回到 idle。
  assert.equal(generationPhaseText(idle({ error: '4 批都没有出成功', failedBatches: [0, 1, 2, 3] })), '出题失败。')
  // 规划失败后 phase 还停在 plan：不在跑就不能说「正在规划」。
  assert.equal(generationPhaseText(idle({ phase: 'plan', error: '规划超时' })), '出题失败。')
  assert.equal(generationPhaseText(idle({ failedBatches: [3], done: 15 })), '出题未完成：第 4 批生成失败，已生成 15/20。')
  assert.equal(generationPhaseText(idle({ failedBatches: [1, 2], done: 10 })), '出题未完成：第 2、3 批生成失败，已生成 10/20。')
  assert.equal(generationPhaseText(idle({ stopped: true, done: 5 })), '已停止出题。')
  assert.equal(generationPhaseText(idle({ degradeOffer: { reason: '读不到' } })), '已暂停：没能读取原文，等你决定是否继续。')
  assert.equal(generationPhaseText(idle({ done: 5 })), '出题未完成：已生成 5/20，可以继续出题。')
  for (const value of [idle({ error: 'x' }), idle({ failedBatches: [0] }), idle({ stopped: true }), idle()]) {
    assert.notEqual(generationPhaseText(value), '正在准备出题…')
  }
})

test('notify relay: 接上时直接转发；断开时存最近几条，下次接上补发', () => {
  const relay = createNotifyRelay()
  const first = []
  relay.set(text => first.push(text))
  relay.notify('已出好')
  assert.deepEqual(first, ['已出好'])

  relay.set(null)
  assert.equal(relay.attached(), false)
  for (const text of ['一', '二', '二', '三', '四']) relay.notify(text)
  relay.notify('')
  assert.deepEqual(relay.pending(), ['二', '三', '四'])
  assert.equal(relay.pending().length, NOTIFY_BACKLOG)
  // 已卸载组件的回调不再被调用。
  assert.deepEqual(first, ['已出好'])

  const second = []
  relay.set(text => second.push(text))
  assert.deepEqual(second, ['二', '三', '四'])
  assert.deepEqual(relay.pending(), [])
  relay.notify('五')
  assert.deepEqual(second, ['二', '三', '四', '五'])
})
