import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { isChunkError, reloadOnce, lazyDecision, RELOAD_KEY, AUTO_RELOAD_WINDOW } from '../../src/ui/chunk-reload.ts'
import { sanitize, reportClientError, installErrorLog, resetErrorLogForTests } from '../../src/ui/error-log.ts'

const read = path => readFile(new URL(`../../src/${path}`, import.meta.url), 'utf8')
const app = await read('App.vue')

test('渲染进程看护重新加载后，界面提示用户（崩溃与无响应两种说法）', () => {
  // 标记由 backend/core/desktop.py 的 Watchdog 在下一次加载的页面里注入。
  assert.match(app, /window as any\)\.__KAIZHI_RECOVERED__/)
  assert.match(app, /已自动重新加载/)
  assert.match(app, /reason === 'unresponsive'/)
})

test('chunk 失败的识别：Chromium / Vite 的几种说法算，组件自身抛错不算', () => {
  assert.ok(isChunkError(new TypeError('Failed to fetch dynamically imported module: http://127.0.0.1:5/assets/SettingsDialog-Bn6Gpirt.js')))
  assert.ok(isChunkError(new Error('Unable to preload CSS for /assets/ChatModePage-x.css')))
  assert.ok(isChunkError('TypeError: error loading dynamically imported module'))
  assert.ok(!isChunkError(new TypeError("Cannot read properties of undefined (reading 'id')")))
  assert.ok(!isChunkError(undefined))
})

test('整页刷新：同一会话 60 秒内最多一次，防止刷新死循环', () => {
  const store = new Map()
  const storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) }
  let reloads = 0
  const reload = () => reloads++
  assert.equal(reloadOnce('a', { storage, now: 1_000_000, reload }), true)
  assert.equal(reloadOnce('a', { storage, now: 1_030_000, reload }), false)
  assert.equal(reloads, 1)
  assert.equal(store.get(RELOAD_KEY), '1000000')
  assert.equal(reloadOnce('a', { storage, now: 1_061_000, reload }), true)
  assert.equal(reloads, 2)
})

test('懒加载失败的决策：先重试两次；启动不久的 chunk 失败才自动刷新，其余显示错误卡片', () => {
  const chunk = new TypeError('Failed to fetch dynamically imported module: /assets/x.js')
  const other = new Error('boom')
  assert.equal(lazyDecision(chunk, 1, { retries: 2, sinceStart: 1000 }), 'retry')
  assert.equal(lazyDecision(chunk, 2, { retries: 2, sinceStart: 1000 }), 'retry')
  assert.equal(lazyDecision(chunk, 3, { retries: 2, sinceStart: 1000 }), 'reload')
  assert.equal(lazyDecision(chunk, 3, { retries: 2, sinceStart: AUTO_RELOAD_WINDOW + 1 }), 'fail', '用了一阵子再失败：不打断正在进行的操作')
  assert.equal(lazyDecision(other, 3, { retries: 2, sinceStart: 1000 }), 'fail')
})

test('错误日志：脱敏 token 与本机端口，启动前的条目补发，10 秒内同一条只记一次', async () => {
  resetErrorLogForTests()
  const token = 'A'.repeat(54)
  assert.equal(sanitize(`at http://127.0.0.1:54209/assets/a.js #desktop=${token} sk-proj-abcdef123456`), 'at /assets/a.js #desktop=<token> sk-<redacted>')
  assert.equal(sanitize('x'.repeat(50), 10), 'xxxxxxxxxx…')
  reportClientError('boot', new Error('before install'))
  const sent = []
  const handlers = {}
  const target = { addEventListener: (name, fn) => { handlers[name] = fn }, removeEventListener: name => { delete handlers[name] } }
  const dispose = installErrorLog(async entry => { sent.push(entry) }, target)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].kind, 'boot')
  assert.match(sent[0].message, /before install/)
  handlers.unhandledrejection({ reason: new Error('rejected once') })
  handlers.unhandledrejection({ reason: new Error('rejected once') })
  assert.equal(sent.filter(entry => entry.kind === 'unhandledrejection').length, 1)
  handlers['vite:preloadError']({ payload: new Error('Unable to preload CSS for /assets/y.css') })
  assert.equal(sent.at(-1).kind, 'chunk-load')
  // 发送失败不抛、不递归。
  dispose()
  installErrorLog(async () => { throw new Error('backend gone') }, target)
  assert.doesNotThrow(() => reportClientError('error', new Error('while offline')))
  resetErrorLogForTests()
})

test('所有懒加载组件都经 lazy() 包装，入口与 Vue 错误都接到本机日志', async () => {
  for (const path of ['App.vue', 'components/settings/SettingsDialog.vue', 'components/assistant/AiPane.vue']) {
    const source = await read(path)
    assert.ok(!source.includes('defineAsyncComponent'), `${path} 不应再直接用 defineAsyncComponent`)
  }
  const pages = ['PdfReader', 'MarkdownReader', 'AiPane', 'SettingsDialog', 'SplitPicker', 'UpdateCard', 'ContextMenu', 'ManifoldDoodle', 'TranslatePane', 'ImportDialog', 'ChatModePage', 'MemoryPage', 'MaterialsPage', 'ExamPage']
  for (const name of pages) assert.match(app, new RegExp(`const ${name} = lazy\\(\\(\\) => import\\(`), name)
  assert.match(app, /SettingsDialog = lazy\([^\n]*variant: 'overlay', dismiss/)
  const main = await read('main.ts')
  assert.match(main, /installErrorLog\(entry => invoke\('client_log', entry\)\)/)
  assert.match(main, /import\('\.\/desktop-app'\)\.catch\(/)
  assert.match(await read('desktop-app.ts'), /app\.config\.errorHandler = /)
})

test('新装首开（空库 + 背景动画）也显示文档库空状态与加入文档引导，不再只剩底板', () => {
  assert.doesNotMatch(app, /!documents\.value\.length[^\n]*libraryShown\.value = false/)
  assert.doesNotMatch(app, /libraryToggledByUser/)
  assert.match(app, /const libraryShown = ref\(true\)/)
  // 空状态本身仍在：空库时渲染 library-empty（含加入文档的提示）。
  assert.match(app, /v-else-if="!visibleDocuments\.length" class="library-empty"/)
})

test('关窗前的保存钩子：补发 pagehide，再写完阅读位置与存储闸门（桌面壳最多等 1.5 秒）', () => {
  assert.match(app, /\(window as any\)\.__kaizhiBeforeQuit = async \(\) => \{/)
  assert.match(app, /window\.dispatchEvent\(new Event\('pagehide'\)\)/)
  assert.match(app, /await Promise\.allSettled\(\[flushProgress\(\), flushStorage\(\)\]\)/)
})
