import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  IMAGE_TYPES, addImageToDraft, imageBudget, imageBudgetText, imageFilesFrom,
} from '../../src/chat/images.ts'
import {
  IMAGE_TOKENS, PER_DOC_CHARS, attachAvailability, attachmentContextTokens, attachmentStatusText,
  docsWithinBudget, friendlyDocError, friendlyTempError, hasAttachments, perDocLimits,
} from '../../src/chat/attachments.ts'
import { CHAT_ATTACH_LIMITS } from '../../src/chat/types.ts'

const DEFAULT_LIMITS = {
  images: 5, pages: 8, characters: 24000, calls: 12, rounds: 3,
  searchPages: 120, searchMilliseconds: 10000, seedCharacters: 8000,
}

const fakeFile = (name, type, size) => ({ name, type, size })
const image = size => 'x'.repeat(size)

test('images: only bitmap types within the source limit are accepted', () => {
  const { files, rejected } = imageFilesFrom([
    fakeFile('a.png', 'image/png', 100),
    fakeFile('b.JPG', 'image/jpeg', 100),
    fakeFile('c.svg', 'image/svg+xml', 100),
    fakeFile('d.pdf', 'application/pdf', 100),
    fakeFile('big.png', 'image/png', CHAT_ATTACH_LIMITS.imageSourceBytes + 1),
  ])
  assert.deepEqual(files.map(file => file.name), ['a.png', 'b.JPG'])
  assert.deepEqual(rejected.map(item => [item.name, item.reason]), [['c.svg', 'type'], ['d.pdf', 'type'], ['big.png', 'size']])
  assert.deepEqual(IMAGE_TYPES, ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'])
})

test('images: FileList-like input and empty input are handled', () => {
  assert.deepEqual(imageFilesFrom(null), { files: [], rejected: [] })
  const list = [fakeFile('x.webp', 'image/webp', 10)]
  list.files = list
  assert.equal(imageFilesFrom(list).files.length, 1)
})

test('images: the budget caps six images and eight megabytes', () => {
  const six = Array.from({ length: CHAT_ATTACH_LIMITS.images }, () => image(100))
  assert.equal(imageBudget(six).ok, true)
  assert.equal(addImageToDraft(six, image(100)).reason, 'count')
  assert.equal(imageBudget([...six, image(100)]).reason, 'count')
  const tooBig = image(CHAT_ATTACH_LIMITS.imageTotalChars + 1)
  assert.equal(imageBudget([tooBig]).reason, 'chars')
  assert.equal(addImageToDraft([image(CHAT_ATTACH_LIMITS.imageTotalChars - 10)], image(100)).reason, 'chars')
  assert.equal(imageBudgetText(six), '图片 6/6 · 0.0 MB / 8.0 MB')
  assert.equal(imageBudgetText([image(1024 * 1024)]), '图片 1/6 · 1.0 MB / 8.0 MB')
})

test('images: adding a valid image appends without touching the original array', () => {
  const draft = [image(10)]
  const result = addImageToDraft(draft, image(20))
  assert.equal(result.images.length, 2)
  assert.equal(draft.length, 1)
  assert.equal(result.reason, undefined)
})

const base = { busy: false, hasPreset: true, vision: true, modelName: 'deepseek-flash', images: 0, docs: 0, libraryEmpty: false }

test('attachments: default tips match the plan', () => {
  const availability = attachAvailability(base)
  assert.deepEqual(availability.image, { disabled: false, tip: '添加图片（也可以 Ctrl+V 粘贴）' })
  assert.deepEqual(availability.library, { disabled: false, tip: '从文档库选择文档（本会话有效，最多 3 份）' })
  assert.deepEqual(availability.temp, { disabled: false, tip: '上传电脑上的文档（临时，不进文档库）' })
})

test('attachments: answering, no preset, no vision, full and empty library all disable with a reason', () => {
  const busy = attachAvailability({ ...base, busy: true })
  assert.equal(busy.image.disabled, true)
  assert.equal(busy.image.tip, '正在回答，结束后再添加附件')
  assert.equal(busy.library.disabled, true)
  assert.equal(busy.temp.disabled, true)

  const noPreset = attachAvailability({ ...base, hasPreset: false })
  assert.equal(noPreset.image.tip, '先在 设置 → AI 新建模型预设')

  const noVision = attachAvailability({ ...base, vision: false })
  assert.equal(noVision.image.disabled, true)
  assert.equal(noVision.image.tip, '当前模型「deepseek-flash」不支持图片，请在模型按钮里换识图模型')
  assert.equal(noVision.library.disabled, false)

  const full = attachAvailability({ ...base, images: CHAT_ATTACH_LIMITS.images, docs: CHAT_ATTACH_LIMITS.docs })
  assert.equal(full.image.tip, '一次最多 6 张图片')
  assert.equal(full.library.tip, '每段对话最多附 3 份文档')
  assert.equal(full.temp.tip, '每段对话最多附 3 份文档')

  const empty = attachAvailability({ ...base, libraryEmpty: true })
  assert.equal(empty.library.disabled, true)
  assert.equal(empty.library.tip, '文档库还是空的，先加入文档')

  const picking = attachAvailability({ ...base, picking: true })
  assert.equal(picking.temp.disabled, true)
  assert.equal(picking.temp.tip, '正在选择文件…')
})

test('attachments: hasAttachments and the context estimate', () => {
  assert.equal(hasAttachments(undefined, undefined), false)
  assert.equal(hasAttachments([], []), false)
  assert.equal(hasAttachments(['a'], []), true)
  assert.equal(hasAttachments([], [{ id: 'a' }]), true)
  assert.equal(attachmentContextTokens(2, 0), 2 * IMAGE_TOKENS)
  assert.equal(attachmentContextTokens(1, 3), IMAGE_TOKENS + 3 * PER_DOC_CHARS)
  assert.equal(attachmentContextTokens(-1, -2), 0)
})

test('attachments: per-document budgets follow the §5.3 table', () => {
  const one = perDocLimits(DEFAULT_LIMITS, 1, true)
  assert.deepEqual([one.calls, one.rounds, one.pages, one.characters, one.images], [12, 3, 8, 24000, 5])
  const two = perDocLimits(DEFAULT_LIMITS, 2, true)
  assert.deepEqual([two.calls, two.rounds, two.pages, two.characters, two.images], [6, 3, 4, 12000, 2])
  const three = perDocLimits(DEFAULT_LIMITS, 3, true)
  assert.deepEqual([three.calls, three.rounds, three.pages, three.characters, three.images], [4, 2, 3, 8000, 1])
  assert.equal(perDocLimits(DEFAULT_LIMITS, 1, false).images, 0)
  // 用户把预算调小后仍保底 3 次调用 / 3 页 / 6000 字。
  const tiny = perDocLimits({ ...DEFAULT_LIMITS, calls: 4, pages: 4, characters: 6000, rounds: 3, images: 2 }, 2, true)
  assert.deepEqual([tiny.calls, tiny.pages, tiny.characters, tiny.images], [3, 3, 6000, 1])
  assert.equal(perDocLimits(DEFAULT_LIMITS, 3, true).seedCharacters, 8000)
})

test('attachments: document errors become fixed text and never leak a path', () => {
  const password = Object.assign(new Error('No password given'), { name: 'PasswordException' })
  assert.match(friendlyDocError(password, '线代A'), /《线代A》已加密：请先在阅读器里打开并输入密码/)
  assert.match(friendlyDocError(new Error('No such file: C:\\Users\\me\\secret.pdf'), '线代A'), /原文件找不到/)
  assert.match(friendlyDocError(new Error('TEMP_MISSING'), '临时文档 1'), /原文件找不到/)
  assert.match(friendlyDocError(new Error('TimeoutError'), '线代A'), /读取超时（150 秒）/)
  assert.match(friendlyDocError(new Error('扫描件没有文字层'), '线代A'), /扫描件、没有文字层/)
  for (const error of [new Error('C:\\Users\\me\\secret.pdf 打不开'), new Error('\\\\server\\share\\x.pdf 出错'), 'oops']) {
    const text = friendlyDocError(error, '线代A')
    assert.equal(text.includes('C:\\'), false, text)
    assert.equal(text.includes('\\\\server'), false, text)
    assert.match(text, /读取失败，请稍后重试/)
  }
})

test('attachments: temporary document error codes map to fixed text', () => {
  assert.match(friendlyTempError(new Error('TEMP_LIMIT：太多了')), /最多附 3 份文档/)
  assert.match(friendlyTempError(new Error('TEMP_TYPE：只能附加 PDF')), /只能附加 PDF、Markdown 或 Word/)
  assert.match(friendlyTempError(new Error('TEMP_SIZE：太大')), /大小限制/)
  assert.match(friendlyTempError(new Error('TEMP_HEADER：坏了')), /内容与扩展名不符/)
  assert.match(friendlyTempError(new Error('TEMP_ENCODING：不是 UTF-8')), /UTF-8/)
  assert.match(friendlyTempError(new Error('TEMP_NOT_FILE：不是文件')), /不是一个普通文件/)
  assert.match(friendlyTempError(new Error('TEMP_MISSING：没了')), /移动、删除或修改/)
  assert.match(friendlyTempError(new Error('TEMP_HANDLE：失效')), /已失效/)
  assert.match(friendlyTempError(new Error('TEMP_CONVERT：Word / WPS 没能完成转换')), /Word 转换失败：Word \/ WPS 没能完成转换/)
  assert.match(friendlyTempError(new Error('TEMP_CANCELLED：取消')), /已取消/)
  assert.match(friendlyTempError(new Error('TEMP_IO：读不了')), /本机读取临时文档失败/)
  assert.match(friendlyTempError(new Error('C:\\secret\\x.doc 出错')), /本机读取临时文档失败/)
})

test('attachments: runtime status text and the document size budget', () => {
  assert.equal(attachmentStatusText('ready', '线代A'), null)
  assert.match(attachmentStatusText('preparing', '线代A'), /还在转换/)
  assert.match(attachmentStatusText('expired', '临时文档 1'), /已失效/)
  assert.match(attachmentStatusText('removed', '线代A'), /已从文档库移除/)
  assert.match(attachmentStatusText('missing', '线代A'), /原文件找不到/)
  assert.match(attachmentStatusText('error', '线代A', '《线代A》已加密'), /已加密/)
  assert.equal(docsWithinBudget([100, 200]), true)
  assert.equal(docsWithinBudget([CHAT_ATTACH_LIMITS.docBytesTotal]), true)
  assert.equal(docsWithinBudget([CHAT_ATTACH_LIMITS.docBytesTotal + 1]), false)
})
