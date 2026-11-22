import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const source = relative => readFileSync(new URL('../../src/' + relative, import.meta.url), 'utf8')
const examSources = readdirSync(new URL('../../src/exam/', import.meta.url)).filter(name => name.endsWith('.ts'))
const examComponents = readdirSync(new URL('../../src/components/exam/', import.meta.url)).filter(name => name.endsWith('.vue'))

const newFiles = [
  ...examSources.map(name => `exam/${name}`),
  'ai/exam.ts',
  ...examComponents.map(name => `components/exam/${name}`),
]

test('exam surfaces: 新增代码不直连外网', () => {
  for (const file of newFiles) {
    const text = source(file)
    for (const forbidden of ['fetch(', 'XMLHttpRequest', 'new WebSocket', 'navigator.sendBeacon', 'window.open', 'location.href']) {
      assert.ok(!text.includes(forbidden), `${file} 不应包含 ${forbidden}`)
    }
  }
})

test('exam surfaces: state.ts 不依赖 sdk / 设置 / 模型调用 / 文档管道', () => {
  const text = source('exam/state.ts')
  for (const forbidden of ["from '../sdk", "from '../ai/settings", "from '../ai/complete", 'providers.mjs', "from '../document"]) {
    assert.ok(!text.includes(forbidden), `state.ts 不应 import ${forbidden}`)
  }
})

test('exam surfaces: 新组件没有 <a>、v-html、:global(x) .y', () => {
  for (const name of examComponents) {
    const text = source(`components/exam/${name}`)
    assert.ok(!text.includes('<a '), `${name} 不能有 <a>`)
    assert.ok(!text.includes('v-html'), `${name} 不能有 v-html`)
    assert.doesNotMatch(text, /:global\([^)]*\)\s*[.#:[a-z]/i, `${name} 禁止 :global(x) .y 写法`)
  }
})

test('exam surfaces: ExamPage.vue 不超过 350 行', () => {
  const lines = source('components/exam/ExamPage.vue').split('\n').length
  assert.ok(lines <= 350, `ExamPage.vue 有 ${lines} 行，超过 350`)
})

test('exam surfaces: App.vue 已接上模拟测试页', () => {
  const app = source('App.vue')
  assert.ok(app.includes("'exam'"))
  assert.ok(app.includes("exam: '模拟测试'"))
  assert.ok(app.includes("showPage('exam')"))
  assert.ok(app.includes('examPage.value?.focusSearch?.()'))
  assert.ok(app.includes('ExamPage'))
  assert.ok(app.includes('examBusy()'))
  assert.ok(app.includes('@import="openImport"'))
})

test('exam surfaces: 图标与用量类型已登记', () => {
  assert.ok(source('components/ui/AppIcon.vue').includes('exam:'))
  assert.ok(source('ai/usage.ts').includes("exam: '模拟测试'"))
})

test('exam surfaces: 默认装配接上记忆注入与存储闸门', () => {
  const index = source('exam/index.ts')
  assert.ok(index.includes('memoryInjection('))
  assert.ok(index.includes("'exam'"))
  assert.ok(index.includes('joinStorageGate('))
  assert.ok(index.includes('createExamStore('))
})
