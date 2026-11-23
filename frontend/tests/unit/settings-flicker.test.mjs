import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// 1.2.8 Bug 2：打开设置后页面一直闪。实测（软件合成）设置开着时背景动画仍每帧重画全窗口画布，
// 上面再叠一层半透明遮罩，帧率从 29 掉到 5；暂停背景后回到 55。真实页面的回归在
// backend/tests/test_settings_render.py（QtWebEngine 里数 2 秒内的重画与 DOM 变更）。
const doodle = await readFile(new URL('../../src/components/layout/ManifoldDoodle.vue', import.meta.url), 'utf8')
const app = await readFile(new URL('../../src/App.vue', import.meta.url), 'utf8')
const body = name => {
  const start = doodle.indexOf(`function ${name}(`)
  assert.ok(start >= 0, name)
  const next = doodle.indexOf('\nfunction ', start + 1)
  return doodle.slice(start, next < 0 ? undefined : next)
}

test('模态窗打开时背景动画暂停：App 传入 paused，覆盖设置、加入文档与移除确认', () => {
  assert.match(app, /<ManifoldDoodle v-if="manifoldVisible" :shapes="effectiveAppearance\.manifold\.shapes" :paused="backgroundPaused" \/>/)
  assert.match(app, /const backgroundPaused = computed\(\(\) => settingsOpen\.value \|\| importOpen\.value \|\| !!removeTarget\.value \|\| !!removeBatch\.value\)/)
  assert.match(doodle, /defineProps<\{ shapes: string\[\]; preview\?: boolean; paused\?: boolean \}>\(\)/)
  assert.match(doodle, /watch\(\(\) => props\.paused, value => setPaused\(!!value\)\)/)
})

test('暂停时主循环、后台线程、换画面与旁注计时都停；恢复时时钟后移、不跳帧', () => {
  assert.match(body('tick'), /if \(document\.hidden \|\| paused\) return/)
  assert.match(body('run'), /!paused/)
  assert.match(doodle, /function syncWorker\(\) \{ worker\?\.postMessage\(\{ type: document\.hidden \|\| held \|\| paused \? 'halt' : 'run' \}\) \}/)
  const pause = body('setPaused')
  assert.match(pause, /halt\(\); clearTimeout\(switchTimer\); clearTimeout\(noteTimer\)/)
  assert.match(pause, /start \+= gap; drawnAt = Math\.min\(now, drawnAt \+ gap\)/)
  assert.match(pause, /props\.preview/, '设置里的缩略图自己不受暂停影响')
  // 背景线程的暂停 / 继续一律经 syncWorker，避免某个分支把模态暂停又放开。
  assert.equal((doodle.match(/postMessage\(\{ type: '(run|halt)' \}\)/g) || []).length, 1, '只剩 recoverWorker 里那一处 halt')
})

test('设置里的缩略图封顶 30 帧；逐帧绘制不写任何 Vue 响应式状态', () => {
  assert.match(doodle, /const PREVIEW_FRAME = 1000 \/ 30/)
  assert.match(body('tick'), /props\.preview \? PREVIEW_FRAME/)
  for (const name of ['tick', 'draw', 'drawMesh']) {
    const code = body(name).replace(/layer\.value\.style\.opacity = shown/g, '')
    assert.doesNotMatch(code, /\b\w+\.value\s*=[^=]/, `${name} 每帧执行，不能给 ref 赋值（会触发整块重渲染）`)
    assert.doesNotMatch(code, /notes\.value|current\.value\s*=|backing\.value/, name)
  }
})
