import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { learning, setLearningEnabled, resetLearningAnswers, learningReady, importFeedback } from '../../src/library/importer.ts'
import { createLibraryExport } from '../../src/exam/library-export.ts'

const source = relative => readFileSync(new URL('../../src/' + relative, import.meta.url), 'utf8')
const app = source('App.vue')
const dialog = source('components/library/ImportDialog.vue')
const flow = source('library/import-flow.ts')
const onboard = source('components/memory/OnboardingFields.vue')
const examIndex = source('exam/index.ts')
const libraryExport = source('exam/library-export.ts')

// ---------------------------------------------------------------- 源码接线

test('import surfaces: 加入文档窗口由父级传入拒绝 ticket 与来源，并回传交互版本', () => {
  const tag = app.slice(app.indexOf('<ImportDialog'), app.indexOf('/>', app.indexOf('<ImportDialog')))
  assert.match(tag, /:validation-ticket="validationTicket"/)
  assert.match(tag, /:intent="importIntent"/)
  assert.match(tag, /@interact="interactionEpoch\+\+"/)
  assert.match(tag, /@close="closeImport"/)
  assert.match(tag, /@add="addPaths"/)
  // 懒加载失败卡片的 dismiss 也走同一清理函数，而不是只把窗口藏起来。
  assert.match(app, /dismiss: \(\) => \{ closeImport\(\) \}/)
})

test('import surfaces: App 只监听 importFeedback.seq，同步记录开窗意图并清 ticket', () => {
  assert.match(app, /watch\(\(\) => importFeedback\.seq, seq => \{ if \(seq && !disposed\) presentImportFeedback\(\) \}, \{ flush: 'sync' \}\)/)
  assert.match(app, /function presentImportFeedback\(\)/)
  assert.match(app, /importIntent\.value = importFeedback\.intent/)
  assert.match(app, /validationTicket\.value = importFeedback\.seq/)
  assert.match(app, /watch\(learningReady, ready => \{ if \(ready\) validationTicket\.value = 0 \}/)
  assert.match(app, /function closeImport\(\)[\s\S]*?validationTicket\.value = 0/)
  // 已有设置/删除确认挡着时不叠一张被盖住的表单。
  assert.match(app, /function modalCoversImport\(\)/)
  assert.match(app, /importPending = true/)
})

test('import surfaces: App 的入库路径统一经 enqueue，不再有第二个参数或 fromDialog 旁路', () => {
  assert.match(app, /async function addPaths\(paths: string\[\]\) \{\s*const added = enqueue\(paths\)/)
  assert.ok(!app.includes('fromDialog'), '旧的 fromDialog 分支必须移除')
  assert.ok(!/enqueue\(paths,/.test(app), 'enqueue 不得再接收答案快照参数')
  assert.ok(!app.includes('markLearningRecorded'), '消费草稿已移进 enqueue')
  // 低层 importDocument 只作为 runQueue 的执行器，新界面不能直接调用。
  assert.match(app, /runQueue\(importDocument,/)
  assert.ok(!/await importDocument\(/.test(app), 'App 不能绕过 runQueue 直接调 importDocument')
  assert.ok(!dialog.includes('importDocument'), '导入窗口不能直接调后端导入')
})

test('import surfaces: 600ms 收尾同时核对运行代次、交互版本、ticket 与 disposed', () => {
  const tail = app.slice(app.indexOf('await new Promise(resolve => setTimeout(resolve, 600))'))
  assert.match(tail, /disposed \|\| runId !== importRun \|\| interactionEpoch\.value !== epoch \|\| validationTicket\.value !== ticket/)
  assert.match(app, /let importRun = 0/)
  assert.match(app, /const epoch = interactionEpoch\.value/)
})

test('import surfaces: 拖放遮罩待填写时显示「先填写学习模式必填项」，不承诺松开即可加入', () => {
  const overlay = app.slice(app.indexOf('class="file-drop-overlay"'), app.indexOf('</div></div>', app.indexOf('class="file-drop-overlay"')))
  assert.match(overlay, /'is-blocked': !learningReady\(\)/)
  assert.match(overlay, /learningReady\(\) \? '加入文档库' : '先填写学习模式必填项'/)
  assert.match(overlay, /松开后会打开表单/)
  assert.ok(!overlay.includes('<span>松开以加入 PDF / Markdown / Word 文档</span>'), '待填写时不显示「松开即可加入」')
  // 拖入只改外观；真正校验发生在 drop → addPaths → enqueue。
  assert.match(app, /else void dropDocuments\(value\.paths\)/)
})

test('import surfaces: 选择文件前先过门禁，独立成可注入 picker 的流程', () => {
  assert.match(flow, /export async function chooseLibraryPaths\(pick: PickPaths\)/)
  assert.match(flow, /const gate = admitImport\('library'\)/)
  assert.match(flow, /if \(!gate\.ok\) return null/)
  const pickIndex = flow.indexOf('await pick()')
  assert.ok(flow.indexOf("admitImport('library')") < pickIndex, 'admitImport 必须早于 pick()')
  assert.match(dialog, /chooseLibraryPaths\(\(\) => selectDocuments\(\)\)/)
  // selectDocuments 只在受保护的 choose 流程里出现一次。
  assert.equal((dialog.match(/selectDocuments\(/g) || []).length, 1)
})

test('import surfaces: 弹窗有常驻 live 区、挂载/已挂载两条聚焦路径与试卷导出模式', () => {
  assert.match(dialog, /id="import-validation"[^>]*role="status" aria-live="polite" aria-atomic="true"/)
  assert.match(dialog, /async function present\(id: number\)/)
  assert.match(dialog, /onMounted\(\(\) => \{\s*if \(ticket\(\)\) void present\(ticket\(\)\)/)
  assert.match(dialog, /watch\(\(\) => props\.validationTicket, id => void present\(id\), \{ flush: 'post' \}\)/)
  assert.match(dialog, /learnFields\.value\?\.focusFirstUnanswered\?\.\(\)/)
  assert.match(dialog, /const examExport = computed\(\(\) => props\.intent === 'exam-export'\)/)
  assert.match(dialog, /回到试卷结果页，再点「导出并加入文档库」/)
  assert.match(dialog, /<button type="button" @click="emit\('close'\)">返回试卷<\/button>/)
  // 卸载不再清草稿；每次作答只通知父级交互版本。
  assert.ok(!dialog.includes('resetLearningAnswers'), '卸载时清草稿的旧逻辑必须移除')
  assert.match(dialog, /emit\('interact'\)/)
})

test('import surfaces: OnboardingFields 支持 invalidField/validationId 并优先聚焦缺失项', () => {
  assert.match(onboard, /invalidField\?: 'docLevel' \| 'fieldLevel' \| 'goal'/)
  assert.match(onboard, /validationId\?: string/)
  assert.match(onboard, /props\.invalidField === 'docLevel'\) docField\.value\?\.querySelector/)
  assert.match(onboard, /:aria-invalid="props\.invalidField === 'goal' \? true : undefined"/)
  assert.match(onboard, /:aria-describedby="props\.invalidField === 'goal' \? props\.validationId : undefined"/)
})

test('import surfaces: 试卷导出的默认装配经 library-export 门禁，且适配器不 import sdk', () => {
  assert.match(examIndex, /createLibraryExport\(/)
  assert.match(examIndex, /exportMarkdown: libraryExport/)
  assert.match(libraryExport, /admitImport\('exam-export'\)/)
  const gateIndex = libraryExport.indexOf("admitImport('exam-export')")
  const callIndex = libraryExport.indexOf('deps.exportMarkdown(markdown, title)')
  assert.ok(gateIndex > 0 && callIndex > gateIndex, 'admitImport 必须早于原生命令调用')
  assert.ok(!libraryExport.includes("from '../sdk"), '适配器不能 import sdk，测试不应加载 PySide')
  assert.ok(!libraryExport.includes('enqueue('), '导出成功后不能再次 enqueue，避免重复入库')
})

// ---------------------------------------------------------------- 试卷导出（假 client）

let store
beforeEach(() => {
  store = new Map()
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) }
  setLearningEnabled(false)
  resetLearningAnswers()
  importFeedback.seq = 0
  importFeedback.intent = 'library'
})
afterEach(() => { delete globalThis.localStorage; learning.recorded = 0; resetLearningAnswers() })
function fillLearning(goal = '准备考试') {
  setLearningEnabled(true)
  learning.docLevel = 2
  learning.fieldLevel = 3
  learning.goal = goal
}
const exportOutcome = { cancelled: false, document: { id: 'doc-1' }, name: '试卷-高数.md', bytes: 2048 }
function adapter(overrides = {}) {
  const calls = [], events = []
  const run = createLibraryExport({
    exportMarkdown: async (markdown, title) => { calls.push([markdown, title]); return (overrides.outcome ?? exportOutcome) },
    emit: event => events.push(event),
    now: () => 777,
    uuid: () => 'import-1',
    ...overrides.deps,
  })
  return { run, calls, events }
}

test('exam export: 学习模式没填完时取消，不发原生命令、不发记忆事件', async () => {
  setLearningEnabled(true)
  learning.docLevel = 2
  const { run, calls, events } = adapter()
  const outcome = await run('# 试卷', '高数')
  assert.deepEqual(outcome, { cancelled: true })
  assert.equal(calls.length, 0, '被拒时不能弹「另存为」、不能写文件')
  assert.equal(events.length, 0)
  assert.equal(learning.docLevel, 2, '取消不消耗草稿')
  assert.equal(importFeedback.seq, 1)
  assert.equal(importFeedback.intent, 'exam-export')
})

test('exam export: 学习模式关着时直接放行，成功也不记录学习事件', async () => {
  const { run, calls, events } = adapter()
  const outcome = await run('# 试卷', '高数')
  assert.deepEqual(outcome, exportOutcome)
  assert.equal(calls.length, 1)
  assert.equal(events.length, 0)
  assert.equal(learning.recorded, 0)
})

test('exam export: 放行后导出成功才发一条 onboarding 事件，并关联新文档 id、消费一次草稿', async () => {
  fillLearning('原目标')
  const { run, calls, events } = adapter()
  const outcome = await run('# 试卷', '高数')
  assert.deepEqual(outcome, exportOutcome)
  assert.deepEqual(calls, [['# 试卷', '高数']])
  assert.equal(events.length, 1)
  assert.deepEqual(events[0], {
    type: 'onboarding', docId: 'doc-1', title: '试卷-高数.md',
    answers: { docLevel: 2, fieldLevel: 3, goal: '原目标', preference: '', note: '', answeredAt: events[0].answers.answeredAt, source: 'import' },
    importId: 'import-1', at: 777,
  })
  assert.equal(learning.recorded, 1)
  assert.equal(learning.goal, '')
})

test('exam export: 用户在另存为期间取消时既不记录也不消费草稿', async () => {
  fillLearning('原目标')
  const { run, events } = adapter({ outcome: { cancelled: true } })
  const outcome = await run('# 试卷', '高数')
  assert.deepEqual(outcome, { cancelled: true })
  assert.equal(events.length, 0)
  assert.equal(learning.recorded, 0)
  assert.equal(learning.goal, '原目标')
})

test('exam export: 导出异步期间改了草稿时只消费原快照，新草稿保留', async () => {
  fillLearning('原目标')
  let release
  const gate = new Promise(resolve => { release = resolve })
  const calls = [], events = []
  const run = createLibraryExport({
    exportMarkdown: async () => { await gate; return exportOutcome },
    emit: event => events.push(event),
    now: () => 1,
    uuid: () => 'import-2',
  })
  const running = run('# 试卷', '高数')
  learning.goal = '异步期间改的目标'
  release()
  await running
  assert.equal(events.length, 1)
  assert.equal(events[0].answers.goal, '原目标', '事件用放行时的快照')
  assert.equal(learning.goal, '异步期间改的目标', '新草稿保留')
  assert.equal(learning.recorded, 0, '修订号对不上，不消费新草稿')
})

test('exam export: 原生命令失败时向上抛，不发事件也不消费草稿', async () => {
  fillLearning('原目标')
  const calls = [], events = []
  const run = createLibraryExport({
    exportMarkdown: async () => { calls.push(1); throw new Error('EXAM_WRITE：写入文件失败') },
    emit: event => events.push(event),
  })
  await assert.rejects(run('# 试卷', '高数'), /EXAM_WRITE/)
  assert.equal(calls.length, 1)
  assert.equal(events.length, 0)
  assert.equal(learning.recorded, 0)
  assert.equal(learning.goal, '原目标')
})
