import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = await readFile(new URL('../../src/App.vue', import.meta.url), 'utf8')

test('渲染进程看护重新加载后，界面提示用户（崩溃与无响应两种说法）', () => {
  // 标记由 backend/core/desktop.py 的 Watchdog 在下一次加载的页面里注入。
  assert.match(app, /window as any\)\.__KAIZHI_RECOVERED__/)
  assert.match(app, /已自动重新加载/)
  assert.match(app, /reason === 'unresponsive'/)
})
