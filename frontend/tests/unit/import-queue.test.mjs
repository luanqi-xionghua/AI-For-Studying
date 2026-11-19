import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { importer, enqueue, runQueue, clearFinished, wordProgress, stageText, failureAdvice, fileName, UNSUPPORTED } from '../../src/library/importer.ts'

beforeEach(() => { importer.items.splice(0); importer.running = false })

test('加入文档：不支持的文件直接写明原因，同一个文件排队时不重复排', () => {
  const added = enqueue(['C:\\书\\论文.pdf', 'D:/笔记/读书.md', 'C:\\书\\报告.docx', 'C:\\书\\表格.xlsx', 'C:\\书\\论文.pdf'])
  assert.deepEqual(added.map(item => [item.name, item.word, item.status]), [
    ['论文.pdf', false, 'waiting'], ['读书.md', false, 'waiting'], ['报告.docx', true, 'waiting'], ['表格.xlsx', false, 'error'],
  ])
  assert.equal(added[3].error, UNSUPPORTED)
  assert.equal(failureAdvice(added[3]), '')
  assert.deepEqual(enqueue(['C:\\书\\论文.pdf']), [], 'still waiting, not queued twice')
  assert.equal(fileName('C:\\a\\b/c.docx'), 'c.docx')
})

test('加入文档：一份一份地加，Word 记下转换步骤，一份失败不影响后面的', async () => {
  enqueue(['C:\\a.docx', 'C:\\bad.doc', 'C:\\c.pdf'])
  const seen = [], imported = []
  await runQueue(async (path, onStage) => {
    seen.push([path, typeof onStage])
    if (path.endsWith('bad.doc')) { onStage('office'); onStage('libreoffice'); throw new Error('转换失败：Word / WPS 无法打开或导出这份文档；改用 LibreOffice 也没能生成 PDF') }
    if (onStage) { onStage('office'); onStage('adding') }
    return [{ id: path, name: path }]
  }, docs => imported.push(...docs.map(doc => doc.id)))
  assert.deepEqual(seen, [['C:\\a.docx', 'function'], ['C:\\bad.doc', 'function'], ['C:\\c.pdf', 'undefined']])
  assert.deepEqual(imported, ['C:\\a.docx', 'C:\\c.pdf'])
  const [a, bad, c] = importer.items
  assert.equal(importer.running, false)
  assert.deepEqual([a.status, bad.status, c.status], ['done', 'error', 'done'])
  assert.equal(bad.stage, 'libreoffice')
  assert.match(bad.error, /LibreOffice/)
  assert.match(failureAdvice(bad), /另存为 → PDF/)
  assert.equal(wordProgress(a), 1)
  clearFinished()
  assert.equal(importer.items.length, 0)
})

test('加入文档：Word 进度条随时间逼近上限、换步骤不倒退，转换完才到 100%', () => {
  const item = { id: '1', path: 'x.docx', name: 'x.docx', word: true, status: 'working', startedAt: 0, stageAt: 0, base: 0.04, stage: 'office' }
  const samples = [0, 2000, 8000, 30000, 120000].map(t => wordProgress(item, t))
  for (let i = 1; i < samples.length; i++) assert.ok(samples[i] > samples[i - 1])
  assert.ok(samples.at(-1) < 0.93, 'never shows done before the PDF exists')
  // Word / WPS 不行，改用 LibreOffice：从当前位置接着走。
  const before = wordProgress(item, 30000)
  Object.assign(item, { base: before, stage: 'libreoffice', stageAt: 30000 })
  assert.ok(wordProgress(item, 30000) >= before)
  assert.ok(wordProgress(item, 40000) > before)
  assert.match(stageText(item), /LibreOffice/)
  assert.equal(wordProgress({ ...item, status: 'waiting' }), 0)
  assert.equal(wordProgress({ ...item, status: 'done' }), 1)
})
