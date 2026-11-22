import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSlots, displayNumbers, mixPreview, resolveMix, topicCap } from '../../src/exam/slots.ts'
import { TEMPLATES, TYPE_LABELS } from '../../src/exam/types.ts'
import { topics as sampleTopics } from './fixtures/exam-sample.mjs'

const difficultyOf = slots => slots.reduce((acc, slot) => {
  acc[slot.difficulty] = (acc[slot.difficulty] || 0) + 1
  return acc
}, {})

test('slots: A / B / C 三个模板的题型数与难度分布', () => {
  for (const key of ['A', 'B', 'C']) {
    const { slots } = buildSlots(TEMPLATES[key].mix, ['知识点一', '知识点二', '知识点三'])
    assert.equal(slots.length, 20)
    const counts = slots.reduce((acc, slot) => {
      acc[slot.type] = (acc[slot.type] || 0) + 1
      return acc
    }, {})
    assert.deepEqual(counts, {
      single: TEMPLATES[key].mix.single,
      multiple: TEMPLATES[key].mix.multiple,
      essay: TEMPLATES[key].mix.essay,
    }, key)
    assert.deepEqual(difficultyOf(slots), { medium: 10, easy: 5, hard: 5 }, key)
    for (let batch = 0; batch < 4; batch++) {
      assert.equal(slots.filter(slot => slot.batch === batch).length, 5, `${key} 第 ${batch + 1} 批`)
    }
    for (let batch = 0; batch < 4; batch++) {
      const kinds = new Set(slots.filter(slot => slot.batch === batch).map(slot => slot.difficulty))
      assert.ok(kinds.size >= 2, `${key} 第 ${batch + 1} 批应有 ≥2 种难度`)
    }
  }
})

test('slots: 自定义全单选也保持 5 / 10 / 5', () => {
  const { slots } = buildSlots({ single: 20, multiple: 0, essay: 0 }, ['甲', '乙', '丙', '丁', '戊', '己', '庚'])
  assert.equal(slots.length, 20)
  assert.ok(slots.every(slot => slot.type === 'single'))
  assert.deepEqual(difficultyOf(slots), { medium: 10, easy: 5, hard: 5 })
})

test('slots: 知识点覆盖与 topicNote', () => {
  const ten = [...sampleTopics.map(item => item.name)]
  const countsOf = slots => slots.reduce((acc, slot) => {
    acc[slot.topic] = (acc[slot.topic] || 0) + 1
    return acc
  }, {})

  const tenSlots = buildSlots(mixOf('A'), ten).slots
  assert.deepEqual(Object.values(countsOf(tenSlots)), Array(10).fill(2))

  const seven = ten.slice(0, 7)
  const sevenSlots = buildSlots(mixOf('A'), seven).slots
  assert.ok(Math.max(...Object.values(countsOf(sevenSlots))) <= 3)
  assert.equal(topicCap(7), 3)

  const three = ten.slice(0, 3)
  const threeResult = buildSlots(mixOf('A'), three)
  assert.ok(Math.max(...Object.values(countsOf(threeResult.slots))) <= 7)
  assert.equal(threeResult.topicNote, '这本书可出题的知识点较少（3 个），部分知识点会出到 7 题。')
  assert.equal(topicCap(3), 7)
  assert.equal(topicCap(10), 3)
})

// 第 8.2 节的完整槽位表：slot / 题号 / 题型 / 难度 / 批次 / 知识点。
const TABLE = [
  [0, 1, 'single', 'medium', 1, '数列极限'],
  [1, 2, 'single', 'easy', 2, '泰勒公式'],
  [2, 3, 'single', 'medium', 3, '数列极限'],
  [3, 4, 'single', 'hard', 4, '泰勒公式'],
  [4, 5, 'single', 'easy', 1, '无穷小比较'],
  [5, 6, 'single', 'medium', 2, '函数单调与极值'],
  [6, 7, 'single', 'hard', 3, '无穷小比较'],
  [7, 8, 'single', 'medium', 4, '函数单调与极值'],
  [8, 9, 'single', 'medium', 1, '函数连续性'],
  [9, 10, 'single', 'hard', 2, '不定积分'],
  [10, 11, 'multiple', 'medium', 3, '函数连续性'],
  [11, 12, 'multiple', 'easy', 4, '不定积分'],
  [12, 13, 'multiple', 'hard', 1, '导数定义'],
  [13, 14, 'multiple', 'medium', 2, '定积分'],
  [14, 15, 'essay', 'easy', 3, '导数定义'],
  [15, 16, 'essay', 'medium', 4, '定积分'],
  [16, 17, 'essay', 'medium', 1, '洛必达法则'],
  [17, 18, 'essay', 'easy', 2, '微分方程'],
  [18, 19, 'essay', 'medium', 3, '洛必达法则'],
  [19, 20, 'essay', 'hard', 4, '微分方程'],
]

test('slots: 模板 A + 夹具知识点逐行等于第 8.2 节的表', () => {
  const { slots } = buildSlots(mixOf('A'), sampleTopics.map(item => item.name))
  const rows = slots.map(slot => [slot.slot, slot.slot + 1, slot.type, slot.difficulty, slot.batch + 1, slot.topic])
  assert.deepEqual(rows, TABLE)
})

test('slots: resolveMix 的三种来源', () => {
  assert.deepEqual(resolveMix('A', { subject: 'stem', mix: { single: 8, multiple: 6, essay: 6 } }), {
    template: 'custom',
    templateSource: 'requirement',
    mix: { single: 8, multiple: 6, essay: 6 },
  })
  assert.deepEqual(resolveMix('B', { subject: 'stem', mix: null }), {
    template: 'B',
    templateSource: 'user',
    mix: TEMPLATES.B.mix,
  })
  assert.deepEqual(resolveMix('auto', { subject: 'stem', mix: null }), {
    template: 'A',
    templateSource: 'auto',
    mix: TEMPLATES.A.mix,
  })
  assert.equal(resolveMix('auto', { subject: 'humanities', mix: null }).template, 'B')
  assert.equal(resolveMix('auto', { subject: 'mixed', mix: null }).template, 'C')
  assert.equal(resolveMix('auto', null).template, 'C')
  // 合计不是 20 的 mix 视为非法。
  assert.equal(resolveMix('auto', { subject: 'stem', mix: { single: 10, multiple: 4, essay: 5 } }).templateSource, 'auto')
})

test('slots: 第 3 批缺失时 displayNumbers 连续编号', () => {
  const { slots } = buildSlots(mixOf('A'), sampleTopics.map(item => item.name))
  const present = slots.filter(slot => slot.batch !== 2).map(slot => slot.slot)
  const numbers = displayNumbers(slots, present)
  assert.equal(Object.keys(numbers).length, 15)
  assert.deepEqual(Object.values(numbers).sort((a, b) => a - b), Array.from({ length: 15 }, (_, i) => i + 1))
  assert.equal(numbers[3], 3)
  assert.equal(numbers[1], 2)
  assert.equal(numbers[19], 15)
  assert.equal(numbers[2], undefined)
})

test('slots: mixPreview 文案', () => {
  assert.equal(mixPreview('A'), '单选 10 · 多选 4 · 大题 6 · 难度 易 5 / 中 10 / 难 5')
  assert.equal(mixPreview({ single: 20, multiple: 0, essay: 0 }), '单选 20 · 多选 0 · 大题 0 · 难度 易 5 / 中 10 / 难 5')
  assert.equal(mixPreview(null), '')
  assert.equal(TYPE_LABELS.single, '单选')
})

function mixOf(template) {
  return TEMPLATES[template].mix
}
