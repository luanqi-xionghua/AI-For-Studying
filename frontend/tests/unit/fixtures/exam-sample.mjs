/**
 * 模拟测试的共享夹具：一套完整的 20 题（模板 A、5.3 的 10 个知识点）。
 *
 * 单测与 P1 的人工走查共用：把 meta / questions / answers 通过
 * `library.setSetting` 写进临时书库，再从「最近的试卷」打开即可。
 */

import { buildSlots } from '../../../src/exam/slots.ts'

export const NOW = 1_764_000_000_000
export const EXAM_ID = 'exam-1'
export const DOC_ID = 'doc-1'

/** §5.3 的 10 个知识点，顺序就是槽位的分配顺序（批 → 槽位）。 */
export const topics = [
  { name: '数列极限', pages: [12, 13] },
  { name: '无穷小比较', pages: [20] },
  { name: '函数连续性', pages: [31, 32] },
  { name: '导数定义', pages: [44] },
  { name: '洛必达法则', pages: [58, 59] },
  { name: '泰勒公式', pages: [72, 73] },
  { name: '函数单调与极值', pages: [88] },
  { name: '不定积分', pages: [101, 102] },
  { name: '定积分', pages: [120] },
  { name: '微分方程', pages: [140, 141] },
]

export const mixA = { single: 10, multiple: 4, essay: 6 }
export const slots = buildSlots(mixA, topics.map(item => item.name)).slots

const singleAnswers = ['B', 'C', 'A', 'D', 'B', 'C', 'A', 'D', 'B', 'C']
const multipleAnswers = [['A', 'C'], ['B', 'D'], ['A', 'B'], ['C', 'D']]

const evidenceId = slot => `S${slot.toString(16).padStart(6, '0')}-${slot + 1}`

function singleQuestion(slot) {
  const answer = singleAnswers[slot]
  return {
    version: 1,
    examId: EXAM_ID,
    id: `q${String(slot).padStart(2, '0')}`,
    slot,
    batch: slots[slot].batch,
    type: 'single',
    difficulty: slots[slot].difficulty,
    stem: `第 ${slot + 1} 题：关于「${slots[slot].topic}」的计算，下列哪一项成立？`,
    options: ['A', 'B', 'C', 'D'].map(key => ({ key, text: `选项 ${key}（第 ${slot + 1} 题的表述）` })),
    answer: [answer],
    rubric: [],
    explanation: `解析：把定义代入即可得到 ${answer}，注意条件的适用范围。`,
    knowledge: [slots[slot].topic],
    answerStyle: '',
    source: { docId: DOC_ID, kind: 'pdf', pages: [30 + slot], lines: [], evidenceIds: [evidenceId(slot)], quotes: [] },
    grounded: true,
    createdAt: NOW,
  }
}

function multipleQuestion(slot, index) {
  const answer = multipleAnswers[index]
  return {
    version: 1,
    examId: EXAM_ID,
    id: `q${String(slot).padStart(2, '0')}`,
    slot,
    batch: slots[slot].batch,
    type: 'multiple',
    difficulty: slots[slot].difficulty,
    stem: `第 ${slot + 1} 题：关于「${slots[slot].topic}」的结论，正确的有哪些？`,
    options: ['A', 'B', 'C', 'D'].map(key => ({ key, text: `选项 ${key}（第 ${slot + 1} 题的表述）` })),
    answer: [...answer],
    rubric: [],
    explanation: `解析：${answer.join('、')} 都能由定义推出，其余选项在端点处不成立。`,
    knowledge: [slots[slot].topic],
    answerStyle: '',
    source: { docId: DOC_ID, kind: 'pdf', pages: [30 + slot], lines: [], evidenceIds: [evidenceId(slot)], quotes: [] },
    grounded: true,
    createdAt: NOW,
  }
}

function essayQuestion(slot, index) {
  const markdown = slot === 18
  return {
    version: 1,
    examId: EXAM_ID,
    id: `q${String(slot).padStart(2, '0')}`,
    slot,
    batch: slots[slot].batch,
    type: 'essay',
    difficulty: slots[slot].difficulty,
    stem: `第 ${slot + 1} 题：说明「${slots[slot].topic}」的求法，并给出一个完整的计算过程。`,
    options: [],
    answer: index === 0
      ? '步骤一：写出定义并确定适用条件（3 分）。步骤二：代入并化简（4 分）。步骤三：得到最终答案（3 分）。最终答案：结果为 1。'
      : '要点一：写出定义（3 分）。要点二：说明关键步骤（4 分）。要点三：给出结论（3 分）。可接受表述：只要论证顺序正确即可给分。',
    rubric: [
      { point: '写出定义或适用条件', score: 3 },
      { point: '关键步骤与化简正确', score: 4 },
      { point: '结论或最终答案正确', score: 3 },
    ],
    explanation: '解析：按评分要点分步给分，最终答案与过程同等重要。',
    knowledge: [slots[slot].topic],
    answerStyle: 'stem',
    source: markdown
      ? { docId: DOC_ID, kind: 'markdown', pages: [], lines: [83, 120], evidenceIds: [evidenceId(slot)], quotes: [] }
      : { docId: DOC_ID, kind: 'pdf', pages: [30 + slot], lines: [], evidenceIds: [evidenceId(slot)], quotes: [] },
    grounded: true,
    createdAt: NOW,
  }
}

let multipleIndex = 0
let essayIndex = 0
export const questions = slots.map(slot => {
  if (slot.type === 'single') return singleQuestion(slot.slot)
  if (slot.type === 'multiple') return multipleQuestion(slot.slot, multipleIndex++)
  return essayQuestion(slot.slot, essayIndex++)
})

export const batches = [0, 1, 2, 3].map(index => ({
  index, status: 'ok', attempts: 1, error: '', finishedAt: NOW,
}))

export const meta = {
  version: 1,
  id: EXAM_ID,
  docId: DOC_ID,
  docTitle: '高等数学（上）',
  docKind: 'pdf',
  pages: 412,
  createdAt: NOW,
  updatedAt: NOW,
  requirement: '',
  subject: 'stem',
  subjectReason: '公式与计算为主',
  template: 'A',
  templateSource: 'auto',
  mix: mixA,
  topics,
  topicNote: '',
  planNote: '',
  slots,
  batches,
  grounded: true,
  degradedReason: '',
  model: { presetId: 'p-1', presetName: 'DeepSeek', provider: 'deepseek', model: 'deepseek-chat', effort: 'medium' },
  generation: { startedAt: NOW, finishedAt: NOW, calls: 5, input: 1200, output: 2400, estimated: false },
}

/** 规划阶段的模型输出（P2 的提示词与解析单测用）。 */
export const plan = {
  subject: 'stem',
  reason: '公式与计算为主',
  topics,
  mix: null,
  note: '',
}

function blankItem() {
  return { choice: [], revealed: false, revealedAt: 0, selfScore: null }
}

export function emptyAnswers() {
  const items = {}
  for (let slot = 0; slot < 20; slot++) items[String(slot)] = blankItem()
  return {
    version: 1,
    examId: EXAM_ID,
    startedAt: 0,
    elapsedMs: 0,
    updatedAt: NOW,
    items,
    submittedAt: 0,
    result: null,
    memory: { want: true, sentAt: 0, skipped: '' },
    finalizedAt: 0,
    exported: null,
  }
}

/** 3 道单选答对 + 第 15 题（槽位 14）大题自评 7 分：liveScore = 37。 */
export function answeredAnswers() {
  const answers = emptyAnswers()
  for (const slot of [0, 1, 2]) answers.items[String(slot)].choice = [...questions[slot].answer]
  answers.items['14'].revealed = true
  answers.items['14'].revealedAt = NOW
  answers.items['14'].selfScore = 7
  answers.elapsedMs = 48 * 60_000
  return answers
}

export const correctChoice = slot => [...questions[slot].answer]
