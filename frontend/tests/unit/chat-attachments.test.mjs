import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  IMAGE_TYPES, addImageToDraft, imageBudget, imageBudgetText, imageFilesFrom,
} from '../../src/chat/images.ts'
import { IMAGE_TOKENS, PER_DOC_CHARS, attachAvailability, attachmentContextTokens, hasAttachments } from '../../src/chat/attachments.ts'
import { CHAT_ATTACH_LIMITS } from '../../src/chat/types.ts'

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
  assert.equal(imageBudgetText(six), '6/6 · 0.0 MB / 8.0 MB')
  assert.equal(imageBudgetText([image(1024 * 1024)]), '1/6 · 1.0 MB / 8.0 MB')
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
