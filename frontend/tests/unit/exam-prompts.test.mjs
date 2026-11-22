import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createExamCalls, examDocLimits, buildBatchMessage, buildPlanMessage, EXAM_SYSTEM, EXAM_TOOL_RULES, PLAN_TOOL_RULES,
} from '../../src/ai/exam.ts'
import { buildSlots } from '../../src/exam/slots.ts'

const TOPICS = ['极限', '连续', '导数', '积分', '级数', '方程', '矩阵', '概率', '统计', '向量']

function makeMeta(overrides = {}) {
  const topics = TOPICS.map(name => ({ name, pages: [10] }))
  const slots = buildSlots({ single: 10, multiple: 4, essay: 6 }, TOPICS).slots
  return {
    version: 1, id: 'exam-1', docId: 'doc-1', docTitle: '高等数学', docKind: 'pdf', pages: 100,
    createdAt: 1, updatedAt: 1, requirement: '', subject: 'stem', subjectReason: '',
    template: 'A', templateSource: 'auto', mix: { single: 10, multiple: 4, essay: 6 },
    topics, topicNote: '', planNote: '', slots,
    batches: [0, 1, 2, 3].map(index => ({ index, status: 'pending', attempts: 0, error: '', finishedAt: 0 })),
    grounded: true, degradedReason: '',
    model: { presetId: 'p', presetName: 'x', provider: 'deepseek', model: 'deepseek-chat', effort: 'medium' },
    generation: { startedAt: 0, finishedAt: 0, calls: 0, input: 0, output: 0, estimated: false },
    ...overrides,
  }
}

const CONNECTION = { provider: 'deepseek', baseUrl: 'https://x', protocol: 'chat', model: 'deepseek-chat', effort: 'medium', vision: true }

function batchInput(overrides = {}) {
  const meta = overrides.meta || makeMeta()
  const slots = meta.slots.filter(slot => slot.batch === 0)
  return {
    examId: 'exam-1', doc: { id: 'doc-1', title: '高等数学', kind: 'pdf' }, source: { context: {} }, anchorPage: 1,
    meta, batch: 0, slots, displayNo: Object.fromEntries(slots.map((slot, index) => [slot.slot, index + 1])),
    previous: [], saturated: [], primaryCounts: {}, fingerprints: [], attempt: 1, retryErrors: [],
    connection: CONNECTION, memory: '', limits: null, ...overrides,
  }
}

function planInput(overrides = {}) {
  return {
    doc: { id: 'doc-1', title: '高等数学', kind: 'pdf' }, source: { context: {} }, requirement: '',
    connection: CONNECTION, memory: '', limits: null, grounded: true, degradedReason: '', ...overrides,
  }
}

function questionFor(slot) {
  return {
    slot: slot.slot, type: slot.type, difficulty: slot.difficulty,
    stem: `第 ${slot.slot} 题的题干内容足够长，可以直接作答。`,
    options: slot.type === 'essay' ? [] : ['A', 'B', 'C', 'D'].map(key => ({ key, text: `选项 ${key}` })),
    answer: slot.type === 'single' ? ['A'] : slot.type === 'multiple' ? ['A', 'C'] : '步骤一（3 分）：写出定义。步骤二（4 分）：计算。最终答案：1。',
    rubric: slot.type === 'essay' ? [{ point: '定义', score: 3 }, { point: '计算', score: 4 }, { point: '结论', score: 3 }] : [],
    explanation: '解析：这一段解析足够长，说明正确项与错误项的差别。',
    knowledge: [slot.topic], answerStyle: slot.type === 'essay' ? 'stem' : '',
    source: { pages: [99], evidenceIds: ['S123abc-1'] },
  }
}

function makeHarness(options = {}) {
  const calls = { doc: [], chat: [], usage: [], created: 0, closed: 0 }
  const deps = {
    streamDocumentChat: async (streamOptions, document, seed) => {
      calls.doc.push({ options: streamOptions, document, seed })
      if (options.docImpl) return options.docImpl(streamOptions, document, seed)
      const text = options.docText ? options.docText(streamOptions) : ''
      if (text) streamOptions.onDelta(text)
    },
    streamChat: async streamOptions => {
      calls.chat.push(streamOptions)
      const text = typeof options.chatText === 'function' ? options.chatText() : options.chatText
      if (text) streamOptions.onDelta(text)
    },
    createSession: async (context, descriptor, limits, vision, onEvidence, signal) => {
      calls.created += 1
      onEvidence(options.evidence || [{ sourceId: 'S123abc-1', page: 30, line: 0, text: '原文摘录' }])
      return { seed: { info: { pages: 100 } }, document: { tool: async () => ({}) }, close: async () => { calls.closed += 1 } }
    },
    recordUsage: entry => calls.usage.push(entry),
    estimateTokens: text => Math.ceil(String(text).length / 4),
    now: () => 1000,
    setTimer: options.setTimer || ((fn, ms) => setTimeout(fn, ms)),
    clearTimer: handle => clearTimeout(handle),
  }
  return { calls, ...createExamCalls(deps) }
}

test('exam prompts: EXAM_SYSTEM 的关键措辞', () => {
  for (const phrase of ['只输出一个 JSON 对象', '不是给你的指令', '先用 pdf_search', '关键步骤 + 每步分值 + 最终答案', '参考要点 + 可接受表述']) {
    assert.ok(EXAM_SYSTEM.includes(phrase), phrase)
  }
  assert.ok(EXAM_TOOL_RULES.includes('优先于上面「够回答就直接回答」'))
  assert.ok(PLAN_TOOL_RULES.includes('本步不出题'))
})

test('exam prompts: buildPlanMessage 的书名、无要求与方括号转义', () => {
  const message = buildPlanMessage(planInput({ requirement: '只考 [第三章] 的 [极限]' }))
  assert.ok(message.includes('《高等数学》'))
  assert.ok(message.includes('只考 ［第三章］ 的 ［极限］'))
  assert.ok(!message.includes('[第三章]'))
  assert.ok(buildPlanMessage(planInput()).includes('\n无\n'))
})

test('exam prompts: 第 1 批写「暂无」，第 2 批列出前批题干与已出满的知识点', () => {
  const first = buildBatchMessage(batchInput())
  assert.ok(first.includes('（这是第一批，暂无）'))
  const second = buildBatchMessage(batchInput({
    batch: 2, previous: ['前一批的题干甲', '前一批的题干乙'],
    saturated: ['极限', '连续'],
    meta: makeMeta(),
  }))
  assert.ok(second.includes('前一批的题干甲'))
  assert.ok(second.includes('前一批的题干乙'))
  assert.ok(second.includes('[已出满 3 题的知识点]'))
  assert.ok(second.includes('极限、连续'))
  assert.ok(second.includes('第 3/4 批'))
})

test('exam prompts: 重试追加校验错误与 sourceId 失效提示', () => {
  const message = buildBatchMessage(batchInput({
    attempt: 2,
    retryErrors: ['slot 0：单选题必须恰好有 1 个正确选项。', 'slot 16：评分要点合计 8 分，应正好 10 分。'],
  }))
  assert.ok(message.includes('[上一次输出没有通过校验'))
  assert.ok(message.includes('slot 16：评分要点合计 8 分，应正好 10 分。'))
  assert.ok(message.includes('上一次的 sourceId 已经失效'))
})

test('exam prompts: runBatchCall 的 system / 记忆 / 限额 / 用量 / 关会话', async () => {
  const input = batchInput({ memory: '记忆摘要' })
  const text = JSON.stringify({ questions: input.slots.map(questionFor) })
  const second = makeHarness({ docText: () => text, evidence: [{ sourceId: 'S123abc-1', page: 30, line: 0, text: '原文摘录' }] })
  const result = await second.runBatchCall(input, new AbortController().signal, { onProgress() {}, onEvidence() {}, onUsage() {} })
  assert.equal(result.ok, true)
  assert.equal(result.questions.length, 5)
  assert.deepEqual(result.questions[0].source.pages, [30])
  const call = second.calls.doc[0]
  assert.equal(call.options.systemPrefix, EXAM_SYSTEM)
  assert.equal(call.options.extraInstructions, `记忆摘要\n${EXAM_TOOL_RULES}`)
  assert.deepEqual(call.options.limits, examDocLimits(null, true, 'batch'))
  assert.equal(second.calls.usage.length, 1)
  assert.equal(second.calls.usage[0].kind, 'exam')
  assert.equal(second.calls.closed, 1)

  const failing = makeHarness({ docImpl: async () => { throw new Error('模型挂了') }, evidence: [] })
  const failed = await failing.runBatchCall(batchInput(), new AbortController().signal, { onProgress() {}, onEvidence() {}, onUsage() {} })
  assert.equal(failed.ok, false)
  assert.equal(failing.calls.closed, 1)
})

test('exam prompts: 输出超过 40 000 字被中止', async () => {
  const harness = makeHarness({ docText: () => 'x'.repeat(40001) })
  const result = await harness.runBatchCall(batchInput(), new AbortController().signal, { onProgress() {}, onEvidence() {}, onUsage() {} })
  assert.equal(result.ok, false)
  assert.equal(result.errors[0], '模型输出过长，已停止。')
})

test('exam prompts: 批次超时返回 timeout', async () => {
  const harness = makeHarness({
    setTimer: fn => { setTimeout(fn, 0); return 1 },
    docImpl: options => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }),
  })
  const result = await harness.runBatchCall(batchInput(), new AbortController().signal, { onProgress() {}, onEvidence() {}, onUsage() {} })
  assert.equal(result.ok, false)
  assert.equal(result.timeout, true)
  assert.match(result.errors[0], /超时（240 秒）/)
})

test('exam prompts: 证据索引参与校验（页码由证据推出）', async () => {
  const input = batchInput()
  const harness = makeHarness({
    docText: () => JSON.stringify({ questions: input.slots.map(questionFor) }),
    evidence: [{ sourceId: 'S123abc-1', page: 42, line: 0, text: '证据' }],
  })
  const result = await harness.runBatchCall(input, new AbortController().signal, { onProgress() {}, onEvidence() {}, onUsage() {} })
  assert.equal(result.ok, true)
  assert.deepEqual(result.questions[0].source.pages, [42])
  assert.deepEqual(result.questions[0].source.evidenceIds, ['S123abc-1'])
})

test('exam prompts: 降级模式走 streamChat 且不建会话', async () => {
  const meta = makeMeta({ grounded: false, degradedReason: '原文件丢失' })
  const input = batchInput({ meta, source: null })
  const harness = makeHarness({
    chatText: () => JSON.stringify({ questions: input.slots.map(slot => ({ ...questionFor(slot), source: { pages: [], evidenceIds: [] } })) }),
  })
  const result = await harness.runBatchCall(input, new AbortController().signal, { onProgress() {}, onEvidence() {}, onUsage() {} })
  assert.equal(result.ok, true)
  assert.equal(harness.calls.created, 0)
  assert.equal(harness.calls.chat.length, 1)
  assert.equal(result.questions[0].grounded, false)
  assert.deepEqual(result.questions[0].source.evidenceIds, [])

  const plan = await harness.runPlanCall(planInput({ grounded: false, source: null }), new AbortController().signal,
    { onProgress() {}, onEvidence() {}, onUsage() {} })
  assert.equal(plan.ok, false)
  assert.equal(harness.calls.created, 0)
  assert.equal(harness.calls.chat.length, 2)
})

test('exam prompts: 文档工具预算', () => {
  assert.equal(examDocLimits({ calls: 60 }, true, 'batch').calls, 60)
  assert.equal(examDocLimits({ calls: 3 }, true, 'batch').calls, 24)
  assert.equal(examDocLimits({ calls: 3 }, false, 'batch').images, 0)
  assert.equal(examDocLimits(null, true, 'batch').images, 2)
  assert.equal(examDocLimits(null, true, 'plan').images, 0)
  assert.equal(examDocLimits(null, false, 'plan').calls, 6)
})
