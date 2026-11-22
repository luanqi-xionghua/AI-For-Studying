import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildExamMarkdown, sourceText } from '../../src/exam/markdown.ts'
import { emptyAnswers, answeredAnswers, questions, meta, NOW } from './fixtures/exam-sample.mjs'

test('markdown: 已交卷的夹具导出结构', () => {
  const md = buildExamMarkdown(meta, questions, answeredAnswers())
  assert.ok(md.startsWith('# 模拟测试：高等数学（上）'))
  assert.ok(md.includes('> 生成时间：'))
  assert.ok(md.includes('> 学科判定：理工类（A 计算/推导型：单选 10 · 多选 4 · 大题 6）'))
  assert.ok(md.includes('## 成绩概览'))
  assert.ok(md.includes('## 一、单选题（每题 10 分）'))
  assert.ok(md.includes('## 二、多选题（每题 10 分：全部选对 10 分，漏选 5 分，选了错误选项 0 分）'))
  assert.ok(md.includes('## 三、大题（每题 10 分，自评）'))
  assert.ok(md.includes('**我的作答：** B（10 分）'))
  assert.ok(md.includes('**我的自评：** 7 / 10'))
  assert.ok(md.includes('| 合计 | 20 | 37 | 200 |'))
  assert.ok(md.includes('*由阅迁星穹「模拟测试」导出。'))
})

test('markdown: 未作答与未自评的写法', () => {
  const answers = emptyAnswers()
  const md = buildExamMarkdown(meta, questions, answers, NOW)
  assert.ok(md.includes('**我的作答：** 未作答（0 分）'))
  assert.ok(md.includes('**我的自评：** 未自评（按 0 分计）'))
  assert.ok(md.includes('本卷尚未交卷，按导出时的作答计分。'))
})

test('markdown: 题干行首的 Markdown 记号被转义', () => {
  const custom = { ...questions[0], stem: '# 这是一道标题式题干' }
  const md = buildExamMarkdown(meta, [custom], emptyAnswers(), NOW)
  assert.ok(md.includes('### 1. \\# 这是一道标题式题干'))
  assert.ok(!md.includes('\n# 这是一道标题式题干'))
})

test('markdown: Markdown 来源写行号，降级写未读取原文', () => {
  const markdownQuestion = questions.find(question => question.source.kind === 'markdown')
  assert.ok(markdownQuestion)
  assert.equal(sourceText(markdownQuestion), '第 83、120 行')
  assert.equal(sourceText({ ...markdownQuestion, grounded: false }), '未读取原文')
  assert.equal(sourceText({ ...markdownQuestion, source: { ...markdownQuestion.source, pages: [40, 41, 42], kind: 'pdf' } }), '第 40–42 页')
})

test('markdown: 页码连续时写成区间', () => {
  const question = { ...questions[0], source: { ...questions[0].source, pages: [40, 41, 42, 45], kind: 'pdf' } }
  assert.equal(sourceText(question), '第 40–42、45 页')
})

test('markdown: 只输出有题的题型，题号连续', () => {
  const singleOnly = questions.filter(question => question.type === 'single').slice(0, 2)
  const md = buildExamMarkdown({ ...meta, mix: { single: 2, multiple: 0, essay: 0 } }, singleOnly, emptyAnswers(), NOW)
  assert.ok(md.includes('## 一、单选题'))
  assert.ok(!md.includes('多选题（每题'))
  assert.ok(!md.includes('大题（每题 10 分，自评）'))
  assert.ok(md.includes('### 1. '))
  assert.ok(md.includes('### 2. '))
})

test('markdown: 多选的漏选与错选文案', () => {
  const multiple = questions.filter(question => question.type === 'multiple').slice(0, 2)
  const answers = emptyAnswers()
  answers.items[String(multiple[0].slot)] = { choice: [multiple[0].answer[0]], revealed: false, revealedAt: 0, selfScore: null }
  answers.items[String(multiple[1].slot)] = { choice: ['A', 'B'], revealed: false, revealedAt: 0, selfScore: null }
  const md = buildExamMarkdown(meta, multiple, answers, NOW)
  assert.ok(md.includes('（漏选，5 分）'))
  assert.ok(md.includes('（选了错误选项，0 分）'))
})
