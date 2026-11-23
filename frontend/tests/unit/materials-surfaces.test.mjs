import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const source = relative => readFileSync(new URL('../../src/' + relative, import.meta.url), 'utf8')

const newFiles = [
  'materials/types.ts', 'materials/client.ts', 'materials/state.ts', 'materials/index.ts',
  'ai/materials.ts', 'components/materials/MaterialsPage.vue', 'components/materials/MaterialResultRow.vue',
]

test('materials surfaces: 新增代码不直连外网', () => {
  for (const file of newFiles) {
    const text = source(file)
    for (const forbidden of ['fetch(', 'XMLHttpRequest', 'new WebSocket', 'navigator.sendBeacon',
      'window.open', 'location.href']) {
      assert.ok(!text.includes(forbidden), `${file} 不应包含 ${forbidden}`)
    }
  }
})

test('materials surfaces: 资料页没有 <a> 和 v-html', () => {
  for (const file of ['components/materials/MaterialsPage.vue', 'components/materials/MaterialResultRow.vue']) {
    const text = source(file)
    assert.ok(!text.includes('<a '), `${file} 不能有 <a>，否则 WebEngine 会自己跳转`)
    assert.ok(!text.includes('v-html'), `${file} 不能有 v-html`)
  }
})

test('materials surfaces: App.vue 已接上资料检索页', () => {
  const app = source('App.vue')
  assert.ok(app.includes("'materials'"))
  assert.ok(app.includes('materials: \'资料检索\''))
  assert.ok(app.includes("showPage('materials')"))
  assert.ok(app.includes('materialsPage.value?.focusSearch?.()'))
  assert.ok(app.includes('MaterialsPage'))
})

test('materials surfaces: 通道与用量已登记', () => {
  // 资料同步的进度通道在请求结束后释放（1.2.8 起收在 PROGRESS_ONLY 里）。
  assert.match(source('sdk/python.ts'), /PROGRESS_ONLY = new Set\(\[[^\]]*'material_sync'/)
  assert.ok(source('ai/usage.ts').includes('discover: \'资料检索\''))
  assert.ok(source('components/ui/AppIcon.vue').includes('discover:'))
})

test('materials surfaces: complete.ts 保留原文并新增 systemPrefix', () => {
  const complete = source('ai/complete.ts')
  assert.ok(complete.includes('extraInstructions?: string'))
  assert.ok(complete.includes('extraInstructions: options.extraInstructions'))
  assert.ok(complete.includes('systemPrefix?: string'))
  assert.ok(complete.includes('systemPrefix: options.systemPrefix'))
})

test('materials surfaces: state.ts 不依赖 sdk / 设置 / 模型调用', () => {
  const text = source('materials/state.ts')
  for (const forbidden of ["from '../sdk", "from '../ai/settings", "from '../ai/complete", 'providers.mjs']) {
    assert.ok(!text.includes(forbidden), `state.ts 不应 import ${forbidden}`)
  }
})

test('materials surfaces: 新组件没有 :global(x) .y 写法', () => {
  const directory = new URL('../../src/components/materials/', import.meta.url)
  for (const file of readdirSync(directory)) {
    const text = readFileSync(new URL(file, directory), 'utf8')
    assert.ok(!/:global\([^)]*\)\s*\./.test(text), `${file} 使用了 :global(x) .y`)
  }
})
