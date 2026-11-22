/** 把一套试卷导出成 Markdown（第 12.3 节）：只输出有题的题型，题号与页面一致。 */

import type { ExamAnswers, ExamMeta, ExamQuestion } from './types.ts'
import { DIFFICULTY_LABELS, SUBJECT_LABELS, TEMPLATE_LABELS, TYPE_NAMES } from './types.ts'
import { answerItem, formatElapsed, scoreExam, scoreQuestion } from './scoring.ts'
import { displayNumbers } from './slots.ts'
import { EXAM_LIMITS } from './types.ts'

const EFFORT_LABELS: Record<string, string> = {
  '': '模型默认', none: '不思考', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高', ultra: '极致',
}

const EXT = /\.(pdf|md|markdown|mdown|docx?)$/i

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function timeText(ms: number): string {
  const date = new Date(ms || Date.now())
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 行首会被 Markdown 当成标题 / 列表 / 引用的字符前加反斜杠。 */
function escapeBlock(text: string): string {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => (/^\s*(#{1,6}\s|>\s?|[-*+]\s|\d+\.\s)/.test(line) ? `\\${line}` : line))
    .join('\n')
}

function oneLine(text: string): string {
  return escapeBlock(text).replace(/\n/g, '  \n')
}

function pageText(pages: number[]): string {
  const list = [...new Set(pages.filter(page => Number.isInteger(page) && page >= 1))].sort((a, b) => a - b)
  if (!list.length) return ''
  const parts: string[] = []
  for (let index = 0; index < list.length; index++) {
    const start = list[index]
    let end = start
    while (index + 1 < list.length && list[index + 1] === end + 1) { end = list[++index] }
    parts.push(end > start ? `${start}–${end}` : String(start))
  }
  return parts.join('、')
}

export function sourceText(question: ExamQuestion): string {
  if (!question.grounded) return '未读取原文'
  const source = question.source
  if (source.kind === 'markdown' && source.lines.length) return `第 ${source.lines.join('、')} 行`
  if (source.pages.length) return `第 ${pageText(source.pages)} 页`
  return '未读取原文'
}

function answerKeys(question: ExamQuestion): string[] {
  return Array.isArray(question.answer) ? question.answer : []
}

function pickText(question: ExamQuestion, answer: ExamAnswers): string {
  const item = answerItem(answer, question.slot)
  if (!item.choice.length) return '未作答（0 分）'
  const picked = item.choice.join('、')
  const { score } = scoreQuestion(question, item, true)
  if (question.type === 'multiple') {
    if (score === EXAM_LIMITS.points) return `${picked}（${score} 分）`
    if (score > 0) return `${picked}（漏选，${score} 分）`
    return `${picked}（选了错误选项，0 分）`
  }
  return `${picked}（${score} 分）`
}

export function buildExamMarkdown(meta: ExamMeta, questions: ExamQuestion[], answers: ExamAnswers, now = Date.now()): string {
  const result = answers.result || scoreExam(questions, answers)
  const numbers = displayNumbers(meta.slots, questions.map(question => question.slot))
  const byType = {
    single: questions.filter(question => question.type === 'single'),
    multiple: questions.filter(question => question.type === 'multiple'),
    essay: questions.filter(question => question.type === 'essay'),
  }
  const title = meta.docTitle.replace(EXT, '')
  const difficulty = { easy: 0, medium: 0, hard: 0 }
  for (const question of questions) difficulty[question.difficulty] += 1
  const weak = result.weak.length
    ? result.weak.map(item => `${item.tag}（失 ${item.lost} 分）`).join('、')
    : '无明显薄弱点'
  const failed = meta.batches.filter(batch => batch.status === 'failed').map(batch => batch.index + 1)

  const note: string[] = ['单选、多选由程序判分；大题为本人对照评分要点自评。']
  if (!answers.submittedAt) note.push('本卷尚未交卷，按导出时的作答计分。')
  if (!meta.grounded) note.push('本次出题未读取原文，题目只依据书名与学习记忆，来源一栏为空。')
  if (failed.length) note.push(`第 ${failed.join('、')} 批生成失败，本卷共 ${questions.length} 题。`)

  const lines: string[] = [
    `# 模拟测试：${title}`,
    '',
    `> 生成时间：${timeText(meta.generation.finishedAt || meta.updatedAt || now)} ｜ 模型：${meta.model.model || '未知模型'}（${EFFORT_LABELS[meta.model.effort] || meta.model.effort || '模型默认'}） ｜ 题量：${questions.length} 题 ｜ 满分 ${result.max} ｜ 得分 ${result.total}（含大题自评）`,
    `> 学科判定：${SUBJECT_LABELS[meta.subject]}（${TEMPLATE_LABELS[meta.template]}：单选 ${meta.mix.single} · 多选 ${meta.mix.multiple} · 大题 ${meta.mix.essay}） ｜ 难度：易 ${difficulty.easy} · 中 ${difficulty.medium} · 难 ${difficulty.hard}`,
    `> 出题要求：${meta.requirement ? escapeBlock(meta.requirement).replace(/\n/g, ' ') : '无'}`,
    `> 说明：${note.join('')}`,
    '',
    '## 成绩概览',
    '',
    '| 题型 | 题数 | 得分 | 满分 |',
    '| --- | --- | --- | --- |',
    `| 单选题 | ${result.byType.single.count} | ${result.byType.single.score} | ${result.byType.single.max} |`,
    `| 多选题 | ${result.byType.multiple.count} | ${result.byType.multiple.score} | ${result.byType.multiple.max} |`,
    `| 大题（自评） | ${result.byType.essay.count} | ${result.byType.essay.score} | ${result.byType.essay.max} |`,
    `| 合计 | ${result.count} | ${result.total} | ${result.max} |`,
    '',
    `用时：${formatElapsed(result.elapsedMs)} ｜ 薄弱知识点：${weak}`,
    '',
  ]

  const sections: { type: 'single' | 'multiple' | 'essay'; heading: string }[] = []
  if (byType.single.length) sections.push({ type: 'single', heading: '## 一、单选题（每题 10 分）' })
  if (byType.multiple.length) {
    sections.push({ type: 'multiple', heading: `## ${byType.single.length ? '二' : '一'}、多选题（每题 10 分：全部选对 10 分，漏选 5 分，选了错误选项 0 分）` })
  }
  if (byType.essay.length) {
    const index = (byType.single.length ? 1 : 0) + (byType.multiple.length ? 1 : 0) + 1
    sections.push({ type: 'essay', heading: `## ${['一', '二', '三'][index - 1] || '三'}、大题（每题 10 分，自评）` })
  }

  for (const section of sections) {
    lines.push(section.heading, '')
    for (const question of byType[section.type]) {
      const number = numbers[question.slot] ?? question.slot + 1
      const item = answerItem(answers, question.slot)
      lines.push(`### ${number}. ${oneLine(question.stem)}`, '')
      if (section.type !== 'essay') {
        for (const option of question.options) lines.push(`- ${option.key}. ${escapeBlock(option.text)}`)
        lines.push('', `**答案：** ${answerKeys(question).join('、')}　**我的作答：** ${pickText(question, answers)}`, '')
        lines.push(`**解析：** ${escapeBlock(question.explanation)}`, '')
      } else {
        lines.push('**参考答案：**', '', escapeBlock(String(question.answer)), '')
        lines.push('**评分要点：**', '')
        question.rubric.forEach((point, index) => lines.push(`${index + 1}. ${escapeBlock(point.point)} ${point.score} 分`))
        lines.push('')
        if (item.text) lines.push('**我的解答：**', '', escapeBlock(item.text), '')
        lines.push(`**我的自评：** ${typeof item.selfScore === 'number' ? `${item.selfScore} / 10` : '未自评（按 0 分计）'}`, '')
        if (question.explanation) lines.push(`**评分提示：** ${escapeBlock(question.explanation)}`, '')
      }
      lines.push(
        `**考点：** ${question.knowledge.join('、')}　**难度：** ${DIFFICULTY_LABELS[question.difficulty]}　**来源：** ${sourceText(question)}`,
        '',
      )
    }
  }

  lines.push('---', '', '*由阅迁星穹「模拟测试」导出。题目由模型依据原文生成，可能有错误，请以原书为准。*', '')
  return lines.join('\n')
}

export function typeName(type: 'single' | 'multiple' | 'essay'): string {
  return TYPE_NAMES[type]
}
