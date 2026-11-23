import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = await readFile(new URL('../../src/App.vue', import.meta.url), 'utf8')
const fn = name => { const start = app.indexOf(`function ${name}(`); assert.ok(start >= 0, name); return app.slice(start, app.indexOf('\nfunction ', start + 1)) }

test('划词翻译：换选区或关掉浮层时停掉上一条还在跑的翻译，不占满 AI 请求名额（1.2.8）', () => {
  assert.match(fn('stopHoverTranslation'), /item\?\.status === 'running'\) stopTranslation\(item\.id\)/)
  const auto = fn('autoTranslate')
  assert.ok(auto.indexOf('stopHoverTranslation()') >= 0 && auto.indexOf('stopHoverTranslation()') < auto.indexOf('void translate('), '先停旧的再开新的')
  assert.match(fn('closeHoverTranslation'), /stopHoverTranslation\(\)/)
})
