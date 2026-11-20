import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = relative => readFileSync(new URL('../../src/' + relative, import.meta.url), 'utf8')

test('memory surfaces: every AI side request reads memory through the shared helper', () => {
  const workspace = source('ai/workspace.ts')
  assert.ok(workspace.includes('memoryInjection({ id: descriptor.id, title: descriptor.title }'))
  assert.ok(workspace.includes('extraInstructions: memory ?'))

  const translate = source('ai/translate.ts')
  assert.ok(translate.includes("memoryInjection(undefined, 'translate')"))
  assert.ok(translate.includes('extraInstructions: memory'))
  assert.ok(translate.includes('settings.effort, memory'), '翻译缓存要随记忆变化失效')

  const explain = source('ai/explain.ts')
  assert.ok(explain.includes("memoryInjection(undefined, 'explain')"))
  assert.ok(explain.includes('extraInstructions: memory'))

  const predict = source('ai/predict.ts')
  assert.ok(predict.includes("memoryInjection(context.document, 'predict')"))
  assert.ok(predict.includes('extraInstructions: memory'))

  const complete = source('ai/complete.ts')
  assert.ok(complete.includes('extraInstructions?: string'))
  assert.ok(complete.includes('extraInstructions: options.extraInstructions'))
})

test('memory surfaces: the shared helper falls back from the document to the global memory', () => {
  const context = source('ai/memory-context.ts')
  assert.ok(context.includes("await api.injectionFor({ kind: 'doc'"))
  assert.ok(context.includes("await api.injectionFor({ kind: 'global' }"))
  assert.ok(context.includes('return memory.text'))
  assert.ok(context.includes('} catch {'))
  assert.ok(context.includes("return ''"), '记忆异常时静默返回空串')
})

test('memory surfaces: chat places the scope picker in the composer, opening upwards', () => {
  const page = source('components/chat/ChatModePage.vue')
  assert.ok(page.includes('<template #scope>'))
  assert.ok(page.includes('<MemoryScopePicker up '))
  const header = page.slice(page.indexOf('<header'), page.indexOf('</header>'))
  assert.ok(!header.includes('MemoryScopePicker'), '页头不再放记忆范围按钮')

  const composer = source('components/chat/ChatComposer.vue')
  assert.ok(composer.includes('<slot name="scope" />'))

  const picker = source('components/chat/MemoryScopePicker.vue')
  assert.ok(picker.includes('up?: boolean'))
  assert.ok(picker.includes('.scope-pop.up'))
})
