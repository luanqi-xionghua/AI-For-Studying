import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advanceWalk, stepsAt } from '../../src/sketch/walk.ts'

// 一个 3 顶点的循环图：next 走 b 方向，flip 走 a 方向。
const next = [1, 2, 0]
const flip = [2, 0, 1]
const seeded = (seed = 7) => () => {
  seed = (seed * 16807) % 2147483647
  return seed / 2147483647
}
const make = () => ({ walk: [0], word: [], done: 0 })

test('walk: t=0 不推进，保留起点', () => {
  const state = make()
  advanceWalk(state, stepsAt(0), next, flip, seeded())
  assert.deepEqual(state.walk, [0])
  assert.equal(state.done, 0)
})

test('walk: 正常帧按步推进（2600ms 内不动，2800ms 后走一步）', () => {
  const state = make()
  advanceWalk(state, stepsAt(2600), next, flip, seeded())
  assert.equal(state.done, 0)
  advanceWalk(state, stepsAt(2800), next, flip, seeded())
  assert.equal(state.done, 1)
  assert.equal(state.walk.length, 2)
  advanceWalk(state, stepsAt(5600), next, flip, seeded())
  assert.equal(state.done, 2)
})

test('walk: 连续正常帧与逐个推进一致（视觉不回归）', () => {
  const random = seeded(42)
  const once = make()
  advanceWalk(once, 30, next, flip, random)
  const each = make()
  const random2 = seeded(42)
  for (let step = 1; step <= 30; step++) advanceWalk(each, step, next, flip, random2)
  assert.deepEqual(each.walk, once.walk)
  assert.deepEqual(each.word, once.word)
  assert.equal(each.done, 30)
})

test('walk: 10 小时时间跳变只补最近 40 步，不会同步补跑上千步', () => {
  const state = make()
  const target = stepsAt(1_000_000) // 约 10 小时，约 357 步
  const started = Date.now()
  advanceWalk(state, target, next, flip, seeded())
  const elapsed = Date.now() - started
  assert.equal(state.done, target)
  assert.ok(state.walk.length <= 40, `walk length ${state.walk.length}`)
  assert.ok(elapsed < 50, `耗时 ${elapsed}ms`)
})

test('walk: 反复大跳变也收敛，且数组不超过 40', () => {
  const state = make()
  for (const elapsed of [1_000_000, 2_000_000, 9_999_999, 12_345_678]) {
    const started = Date.now()
    advanceWalk(state, stepsAt(elapsed), next, flip, seeded())
    assert.equal(state.done, stepsAt(elapsed))
    assert.ok(state.walk.length <= 40)
    assert.ok(Date.now() - started < 50)
  }
})

test('walk: 从长时间跳变恢复到正常帧后仍能继续推进', () => {
  const state = make()
  advanceWalk(state, stepsAt(3_600_000), next, flip, seeded())
  const before = state.done
  advanceWalk(state, before + 2, next, flip, seeded())
  assert.equal(state.done, before + 2)
  assert.ok(state.walk.length <= 40)
})
