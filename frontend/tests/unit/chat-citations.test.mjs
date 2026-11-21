import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addEvidence, citationCount, citationGroups, collectCitations, collectSnippets, createEvidenceIndex, plainCitations, renderCitations } from '../../src/chat/citations.ts'

const docs = [
  { aid: 'a1', title: '线性代数（第 5 版）', source: 'library', ok: true },
  { aid: 'a2', title: 'MIT 18.06 讲义', source: 'library', ok: true },
]

test('citations: a PDF page renders as 〔《书名》第 N 页〕, a Markdown line as 第 N 行', () => {
  const refs = { docs, cites: [{ id: 'S1a2b3c-1', d: 0, p: 212 }, { id: 'S4d5e6f-2', d: 1, l: 120 }] }
  assert.equal(
    renderCitations('定义见 [S1a2b3c-1]，行号见 [S4d5e6f-2]。', refs),
    '定义见 〔《线性代数（第 5 版）》第 212 页〕，行号见 〔《MIT 18.06 讲义》第 120 行〕。',
  )
})

test('citations: unknown ids and malformed refs stay raw', () => {
  const refs = { docs, cites: [{ id: 'S1a2b3c-1', d: 0, p: 212 }] }
  assert.equal(renderCitations('已知 [S1a2b3c-1]，未知 [Sffffff-9]，坏 id [abc]。', refs), '已知 〔《线性代数（第 5 版）》第 212 页〕，未知 [Sffffff-9]，坏 id [abc]。')
  assert.equal(renderCitations('正文 [S1a2b3c-1]', undefined), '正文 [S1a2b3c-1]')
  assert.equal(renderCitations('', refs), '')
})

test('citations: a cite without page or line falls back to the book title', () => {
  const refs = { docs, cites: [{ id: 'S1a2b3c-1', d: 0 }] }
  assert.equal(renderCitations('[S1a2b3c-1]', refs), '〔《线性代数（第 5 版）》〕')
})

test('citations: only cited ids are collected, deduplicated and capped', () => {
  const index = createEvidenceIndex()
  addEvidence(index, 0, [
    { sourceId: 'S1a2b3c-1', page: 212, text: '特征值定义' },
    { sourceId: 'S1a2b3c-2', page: 213, text: '特征多项式' },
  ])
  addEvidence(index, 1, [{ sourceId: 'S4d5e6f-1', line: 120, text: '消元' }])
  const cites = collectCitations('见 [S1a2b3c-1] 和 [S4d5e6f-1]，重复 [S1a2b3c-1]。', index)
  assert.deepEqual(cites, [{ id: 'S1a2b3c-1', d: 0, p: 212 }, { id: 'S4d5e6f-1', d: 1, l: 120 }])
  const many = collectCitations(Array.from({ length: 60 }, (_, i) => `[S1a2b3c-${i + 10}]`).join(' '), index)
  assert.equal(many.length, 0)
  const big = createEvidenceIndex()
  for (let i = 0; i < 60; i++) addEvidence(big, 0, [{ sourceId: `S1a2b3c-${i + 1}`, page: i + 1 }])
  assert.equal(collectCitations(Array.from({ length: 60 }, (_, i) => `[S1a2b3c-${i + 1}]`).join(' '), big).length, 40)
})

test('citations: snippets only carry原文 and groups follow the attachment order', () => {
  const index = createEvidenceIndex()
  addEvidence(index, 0, [{ sourceId: 'S1a2b3c-1', page: 212, text: '特征值定义' }])
  addEvidence(index, 1, [{ sourceId: 'S4d5e6f-1', line: 120 }])
  const cites = collectCitations('[S1a2b3c-1] [S4d5e6f-1]', index)
  assert.deepEqual(collectSnippets(cites, index), [{ id: 'S1a2b3c-1', d: 0, p: 212, text: '特征值定义' }])
  const groups = citationGroups({ docs, cites, snippets: collectSnippets(cites, index) })
  assert.equal(groups.length, 2)
  assert.equal(groups[0].doc.title, '线性代数（第 5 版）')
  assert.equal(groups[0].items[0].label, '〔《线性代数（第 5 版）》第 212 页〕')
  assert.equal(groups[0].items[0].text, '特征值定义')
  assert.equal(groups[1].items[0].text, undefined)
  assert.equal(citationCount({ docs, cites }), 2)
  assert.equal(citationCount(undefined), 0)
})

test('citations: plainCitations (history) produces the same plain text', () => {
  const refs = { docs, cites: [{ id: 'S1a2b3c-1', d: 0, p: 212 }] }
  assert.equal(plainCitations('[S1a2b3c-1]', refs), '〔《线性代数（第 5 版）》第 212 页〕')
})
