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

// ---------------------------------------------------------------- 1.2.6

test('exam surfaces 1.2.6: 选项里的 Markdown 不放进 <button>，改用 role="button" 并支持键盘', () => {
  const text = source('components/exam/ExamQuestionCard.vue')
  const template = text.slice(text.indexOf('<template>')).replace(/<!--[\s\S]*?-->/g, '')
  for (const block of template.match(/<button[\s\S]*?<\/button>/g) || []) {
    assert.ok(!block.includes('<MarkdownAnswer'), `按钮里不能有 MarkdownAnswer：${block.slice(0, 80)}`)
  }
  const option = template.slice(template.indexOf('class="exam-option"') - 120, template.indexOf('class="exam-option"') + 400)
  assert.match(option, /<div v-for="option in question\.options"[^>]*role="button"/)
  assert.match(option, /:tabindex="interactive \? 0 : -1"/)
  assert.match(option, /:aria-disabled="!interactive"/)
  assert.match(option, /:aria-pressed="chosen\.has\(option\.key\)"/)
  assert.match(option, /@keydown="optionKey\(option\.key, \$event\)"/)
  assert.match(text, /event\.key !== 'Enter' && event\.key !== ' '/)
  assert.match(text, /closest\?\.\('a, \[data-copy\]'\)/)
  assert.ok(!text.includes('.exam-option:disabled'))
})

test('exam surfaces 1.2.6: 模拟测试的模型抽屉右下角有「确定」，其他用法不受影响', () => {
  const setup = source('components/exam/ExamSetupPanel.vue')
  assert.match(setup, /show-confirm confirm-placement="footer" :confirm-disabled="!canConfirm"/)
  assert.match(setup, /@confirm="confirmPicker"/)
  assert.match(setup, /const canConfirm = computed\(\(\) => Boolean\(resolved\.value\?\.model\) && models\.value\.length > 0\)/)
  assert.match(setup, /pickerOpen\.value = false/)

  const picker = source('components/assistant/ModelPicker.vue')
  assert.match(picker, /confirmPlacement: 'presets'/)
  assert.match(picker, /<div v-if="confirmInFooter" class="drawer-row drawer-footer">/)
  assert.match(picker, /\.drawer-footer\{justify-content:flex-end\}/)
  assert.match(picker, /<button v-if="confirmInPresets" type="button" class="drawer-confirm"/)

  // 对话模式的输入栏不显示确定；阅读助手、翻译仍把确定放在预设行（默认）。
  const composer = source('components/chat/ChatComposer.vue')
  const composerPicker = composer.slice(composer.indexOf('<ModelPicker'), composer.indexOf('/>', composer.indexOf('<ModelPicker')))
  assert.ok(!composerPicker.includes('show-confirm'))
  for (const file of ['components/assistant/AiPane.vue', 'components/translate/TranslatePane.vue']) {
    const text = source(file)
    assert.ok(text.includes('<ModelPicker v-if="drawerMounted" show-confirm'), file)
    assert.ok(!text.includes('confirm-placement'), file)
  }
})

test('exam surfaces 1.2.6: 页面卸载时断开提示；阶段文案与导出确认走纯函数', () => {
  const page = source('components/exam/ExamPage.vue')
  assert.match(page, /onBeforeUnmount\(\(\) => \{\s*setExamNotify\(null\)/)
  assert.match(page, /generationPhaseText\(generation,/)
  assert.match(page, /message: exportPendingMessage\(pending\)/)
  assert.ok(!page.includes("'正在准备出题…'"))
  assert.ok(!page.includes('还有 ${pending.unanswered} 题未作答、${pending.unscored} 道大题未自评'))
  assert.match(page, /exam\.retryBatch\(current\.id, failed\)/)
  const index = source('exam/index.ts')
  assert.match(index, /notify: text => relay\.notify\(text\)/)
  assert.ok(!index.includes('notifyHandler'))
})

test('exam surfaces 1.2.6: 结果页回看能展开答案、给大题自评（离开结果页后只读）', () => {
  const page = source('components/exam/ExamPage.vue')
  const result = page.slice(page.indexOf("v-else-if=\"view === 'result'\""), page.indexOf("v-else-if=\"view === 'broken'\""))
  const card = result.slice(result.indexOf('<ExamQuestionCard'), result.indexOf('/>', result.indexOf('<ExamQuestionCard')))
  assert.match(card, /mode="review"/)
  assert.match(card, /@reveal="exam\.reveal\(question\.slot\)"/)
  assert.match(card, /@score="exam\.selfScore\(question\.slot, \$event\)"/)
  assert.match(card, /:scorable="!answers\?\.finalizedAt && !current\?\.readOnly"/)
  const text = source('components/exam/ExamQuestionCard.vue')
  assert.match(text, /scorable\?: boolean/)
  assert.match(text, /const canScore = computed\(\(\) => interactive\.value \|\| Boolean\(props\.scorable\)\)/)
  assert.match(text, /:disabled="!canScore" @click="emit\('score', value - 1\)"/)
})

test('exam surfaces 1.2.6: 评分要点只由 <ol> 编号，不再手写「1.」造成「1. 1.」', () => {
  const text = source('components/exam/ExamQuestionCard.vue')
  assert.match(text, /<ol class="exam-rubric">/)
  assert.ok(!text.includes('{{ index + 1 }}. {{ point.point }}'))
  assert.match(text, /<li v-for="\(point, index\) in question\.rubric" :key="index">\{\{ point\.point \}\}（\{\{ point\.score \}\} 分）<\/li>/)
})
