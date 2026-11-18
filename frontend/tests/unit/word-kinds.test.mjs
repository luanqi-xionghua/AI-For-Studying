import test from 'node:test'
import assert from 'node:assert/strict'
import { readsAsPdf, documentTitle, formatLabel, kindIcon, kindName, DOCUMENT_PATTERN, WORD_PATTERN, DOCUMENT_EXTENSIONS } from '../../src/library/kinds.ts'

test('Word 文档加入时已转成 PDF：阅读、页码、封面都按 PDF 走', () => {
  assert.equal(readsAsPdf('pdf'), true)
  assert.equal(readsAsPdf('word'), true)
  assert.equal(readsAsPdf('markdown'), false)
  assert.equal(readsAsPdf(undefined), false)
})

test('选择框、拖放接受 .docx 和老式 .doc', () => {
  for (const name of ['报告.docx', '旧稿.DOC', 'a.pdf', 'b.md', 'c.markdown']) assert.ok(DOCUMENT_PATTERN.test(name), name)
  for (const name of ['图.png', 'x.docm', 'docx', '表.xlsx']) assert.ok(!DOCUMENT_PATTERN.test(name), name)
  assert.ok(WORD_PATTERN.test('C:\\书\\期末.docx') && WORD_PATTERN.test('旧.doc') && !WORD_PATTERN.test('a.pdf'))
  assert.deepEqual(DOCUMENT_EXTENSIONS, ['pdf', 'md', 'markdown', 'docx', 'doc'])
})

test('卡片上注明原来是 Word', () => {
  assert.equal(documentTitle('课程报告.docx'), '课程报告')
  assert.equal(documentTitle('旧稿.doc'), '旧稿')
  assert.equal(documentTitle('v1.2 说明.pdf'), 'v1.2 说明')
  assert.equal(formatLabel({ kind: 'word', name: '课程报告.docx' }), 'DOCX')
  assert.equal(formatLabel({ kind: 'word', name: '旧稿.DOC' }), 'DOC')
  assert.equal(formatLabel({ kind: 'pdf', name: 'a.pdf' }), 'PDF')
  assert.equal(formatLabel({ kind: 'markdown', name: 'a.md' }), 'MD')
  assert.deepEqual(['word', 'pdf', 'markdown'].map(kindIcon), ['word', 'file', 'markdown'])
  assert.equal(kindName('word'), 'Word（已转为 PDF）')
})
