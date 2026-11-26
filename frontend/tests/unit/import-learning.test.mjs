import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  importer, learning, learningReady, currentLearningAnswers, markLearningRecorded,
  setLearningEnabled, resetLearningAnswers, enqueue, runQueue, firstMissingLearningField,
  admitImport, finishImportAdmission, importFeedback, IMPORT_INCOMPLETE_MESSAGE,
} from '../../src/library/importer.ts'
import { chooseLibraryPaths } from '../../src/library/import-flow.ts'

let store
beforeEach(() => {
  store = new Map()
  globalThis.localStorage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
  }
  importer.items.length = 0
  importer.running = false
  setLearningEnabled(false)
  resetLearningAnswers()
  importFeedback.seq = 0
  importFeedback.intent = 'library'
})
afterEach(() => {
  delete globalThis.localStorage
  importer.items.length = 0
  importer.running = false
  learning.recorded = 0
  resetLearningAnswers()
})
const answers = (docLevel = 2, fieldLevel = 3, note = '', goal = '准备课程汇报', preference = '') => ({ docLevel, fieldLevel, goal, preference, note, answeredAt: 42, source: 'import' })
/** 打开学习模式并填好草稿；返回后学习模式处于「可以入队」的状态。 */
function fillLearning(docLevel = 2, fieldLevel = 3, goal = '准备课程汇报', extra = {}) {
  setLearningEnabled(true)
  learning.docLevel = docLevel
  learning.fieldLevel = fieldLevel
  learning.goal = goal
  learning.preference = extra.preference ?? ''
  learning.note = extra.note ?? ''
}

test('import learning: ready when the switch is off', () => {
  assert.equal(learning.enabled, false)
  assert.equal(learningReady(), true)
  assert.equal(firstMissingLearningField(), null)
  assert.equal(currentLearningAnswers(), null)
  assert.equal(admitImport('library').ok, true)
  assert.equal(importFeedback.seq, 0, '放行时不发拒绝通知')
})

test('import learning: not ready while a question or the goal is unanswered', () => {
  setLearningEnabled(true)
  assert.equal(firstMissingLearningField(), 'docLevel')
  learning.docLevel = 2
  assert.equal(learningReady(), false)
  assert.equal(firstMissingLearningField(), 'fieldLevel')
  assert.equal(currentLearningAnswers(), null)
  learning.fieldLevel = 3
  assert.equal(learningReady(), false, '少了学习目标也不能开始')
  learning.goal = '  '
  assert.equal(learningReady(), false, '只有空白的目标不算填写')
  assert.equal(firstMissingLearningField(), 'goal')
  learning.goal = '通过考试'
  assert.equal(learningReady(), true)
  assert.equal(firstMissingLearningField(), null)
})

test('import learning: programmatic out-of-range levels still count as missing that question', () => {
  setLearningEnabled(true)
  learning.docLevel = 5
  learning.fieldLevel = 3
  learning.goal = '通过考试'
  assert.equal(firstMissingLearningField(), 'docLevel')
  learning.docLevel = 2
  learning.fieldLevel = 0
  assert.equal(firstMissingLearningField(), 'fieldLevel')
})

test('import learning: both answers and the goal make a ready payload', () => {
  fillLearning(2, 3, '  通过考试  ', { preference: '  多举例子  ', note: '  备注  ' })
  const payload = currentLearningAnswers(1234)
  assert.deepEqual(payload, {
    docLevel: 2, fieldLevel: 3, goal: '通过考试', preference: '多举例子', note: '备注',
    answeredAt: 1234, source: 'import',
  })
})

test('import learning: goal / preference / note are clamped to their limits', () => {
  fillLearning(1, 1, '目'.repeat(300), { preference: '偏'.repeat(300), note: '字'.repeat(300) })
  const payload = currentLearningAnswers(1)
  assert.equal(payload.goal.length, 100)
  assert.equal(payload.preference.length, 200)
  assert.equal(payload.note.length, 200)
})

test('import learning: every queued item gets its own copy of the answers, then the draft is consumed once', () => {
  fillLearning(2, 3, '准备课程汇报')
  const added = enqueue(['C:\\a.pdf', 'C:\\b.md', 'C:\\c.docx'])
  assert.equal(added.length, 3)
  assert.ok(added.every(item => item.onboarding))
  assert.deepEqual(added.map(item => item.onboarding.docLevel), [2, 2, 2])
  assert.notEqual(added[0].onboarding, added[1].onboarding)
  assert.notEqual(added[1].onboarding, added[2].onboarding, '每份是独立快照')
  // 合法批次只消费一次：草稿清空、「已记下」记下份数；同一批已拿到的快照不受影响。
  assert.deepEqual([learning.docLevel, learning.fieldLevel, learning.goal, learning.recorded], [0, 0, '', 3])
  assert.equal(added[0].onboarding.goal, '准备课程汇报')
  assert.deepEqual(enqueue(['C:\\late.pdf']), [], '消费后没重新作答，再排必须被拒')
  assert.equal(importer.items.length, 3, '被拒的第二批没有加进队列')
})

test('import learning: unsupported files never carry answers; the batch still consumes the draft', () => {
  fillLearning(2, 3)
  const added = enqueue(['C:\\a.pdf', 'C:\\x.xlsx'])
  assert.ok(added[0].onboarding)
  assert.equal(added[1].status, 'error')
  assert.equal(added[1].onboarding, undefined)
  assert.equal(learning.recorded, 1, '只按带快照的受支持条目计数')
})

test('import learning: when the form is incomplete nothing is enqueued — not even unsupported rows', () => {
  setLearningEnabled(true)
  learning.docLevel = 2
  const added = enqueue(['C:\\a.pdf', 'C:\\x.xlsx'])
  assert.deepEqual(added, [])
  assert.equal(importer.items.length, 0)
  assert.equal(importFeedback.seq, 1)
  assert.equal(importFeedback.intent, 'library')
})

test('import learning: a fake old snapshot passed as a second argument cannot bypass the gate', () => {
  setLearningEnabled(true)
  // JS 调用者多传的旧快照会被忽略：enqueue 只看当前草稿。
  const added = enqueue(['C:\\a.pdf'], answers())
  assert.deepEqual(added, [])
  assert.equal(importer.items.length, 0)
})

test('import learning: a whitespace-only goal is still missing', () => {
  setLearningEnabled(true)
  learning.docLevel = 1
  learning.fieldLevel = 1
  learning.goal = '   \t '
  assert.deepEqual(enqueue(['C:\\a.pdf']), [])
  assert.equal(importer.items.length, 0)
})

test('import learning: without the switch nothing is attached; an extra snapshot argument is ignored', () => {
  assert.equal(enqueue(['C:\\a.pdf'])[0].onboarding, undefined)
  assert.equal(enqueue(['C:\\b.pdf'], answers())[0].onboarding, undefined, '学习模式关着时不带答案，也不能被参数绕过')
  assert.equal(learning.recorded, 0)
})

test('import learning: the answers travel with each item to the import callback', async () => {
  importer.items.length = 0
  fillLearning(4, 1)
  enqueue(['C:\\a.pdf', 'C:\\b.pdf'])
  const seen = []
  await runQueue(async path => [{ id: path, name: path }], (docs, item) => seen.push([docs[0].id, item.onboarding?.docLevel]))
  assert.deepEqual(seen, [['C:\\a.pdf', 4], ['C:\\b.pdf', 4]])
})

test('import learning: failed imports never reach the callback', async () => {
  importer.items.length = 0
  fillLearning(2)
  enqueue(['C:\\ok.pdf', 'C:\\bad.pdf'])
  const seen = []
  await runQueue(async path => {
    if (path.includes('bad')) throw new Error('nope')
    return [{ id: path, name: path }]
  }, (docs, item) => seen.push([docs[0].id, item.onboarding?.docLevel]))
  assert.deepEqual(seen, [['C:\\ok.pdf', 2]])
  assert.equal(importer.items.find(item => item.path.includes('bad')).status, 'error')
})

test('import learning: a second batch queued while running needs its own new answers and keeps its own snapshot', async () => {
  importer.items.length = 0
  let release
  const gate = new Promise(resolve => { release = resolve })
  const seen = []
  fillLearning(1, 1)
  enqueue(['C:\\first.pdf'])
  const running = runQueue(async path => { await gate; return [{ id: path, name: path }] }, (docs, item) => seen.push([docs[0].id, item.onboarding?.docLevel]))
  // 第一批已消费草稿；第二批要重新作答后才能追加。
  assert.deepEqual(enqueue(['C:\\second.pdf']), [], 'running 中也不能用旧草稿追加')
  fillLearning(4, 3)
  enqueue(['C:\\second.pdf'])
  release()
  await running
  assert.deepEqual(seen, [['C:\\first.pdf', 1], ['C:\\second.pdf', 4]])
})

test('import learning: recording a batch clears the answers but remembers the count', () => {
  fillLearning(3, 2, '通过考试', { preference: '多举例子', note: '备注' })
  markLearningRecorded(3)
  assert.deepEqual([learning.docLevel, learning.fieldLevel, learning.goal, learning.preference, learning.note, learning.recorded], [0, 0, '', '', '', 3])
  assert.equal(learning.enabled, true)
})

test('import learning: the switch remembers itself and keeps the draft when turned off', () => {
  fillLearning(2, 2, '通过考试')
  learning.preference = '多举例子'
  learning.note = '备注'
  learning.recorded = 2
  assert.equal(store.get('kaizhi.import.learning.v1'), '1')
  setLearningEnabled(false)
  assert.equal(store.get('kaizhi.import.learning.v1'), '0')
  // 关开关只停用这组回答：清提示状态，草稿保留，重开接着用。
  assert.deepEqual([learning.docLevel, learning.fieldLevel, learning.goal, learning.preference, learning.note, learning.recorded], [2, 2, '通过考试', '多举例子', '备注', 0])
  assert.equal(learningReady(), true, '关掉学习模式后加入文档不受影响')
  setLearningEnabled(true)
  assert.equal(learningReady(), true, '重开学习模式后草稿还在')
})

test('import learning: no localStorage does not throw', () => {
  delete globalThis.localStorage
  assert.doesNotThrow(() => setLearningEnabled(true))
  setLearningEnabled(false)
})

test('import learning: admitImport reports the intent and finishImportAdmission only consumes a still-current revision', () => {
  setLearningEnabled(true)
  learning.docLevel = 2
  const denied = admitImport('exam-export')
  assert.equal(denied.ok, false)
  assert.equal(importFeedback.seq, 1)
  assert.equal(importFeedback.intent, 'exam-export')

  learning.fieldLevel = 2
  learning.goal = '通过考试'
  const gate = admitImport('library')
  assert.equal(gate.ok, true)
  assert.equal(typeof gate.revision, 'number')
  // 放行后草稿又改了：旧凭据不能再消费新草稿。
  learning.goal = '改成另一个目标'
  finishImportAdmission(gate, 1)
  assert.equal(learning.recorded, 0)
  assert.equal(learning.goal, '改成另一个目标')
  // 当前凭据、n > 0 才消费；n = 0（全是重复/不支持）不消费。
  const fresh = admitImport('library')
  finishImportAdmission(fresh, 0)
  assert.equal(learning.recorded, 0)
  finishImportAdmission(fresh, 1)
  assert.equal(learning.recorded, 1)
  assert.equal(learning.goal, '')
})

test('import learning: the denial message is the single unified sentence', () => {
  assert.equal(IMPORT_INCOMPLETE_MESSAGE, '学习模式已开启：请先完成两道自评并填写学习目标，再加入文档。')
})

test('import flow: a denied choose never opens the picker', async () => {
  setLearningEnabled(true)
  let picked = 0
  const paths = await chooseLibraryPaths(async () => { picked++; return ['C:\\a.pdf'] })
  assert.equal(paths, null)
  assert.equal(picked, 0, '被拒时 selectDocuments 一次都不应被调用')
  assert.equal(importFeedback.seq, 1)
})

test('import flow: a ready choose opens the picker once and drops empty entries', async () => {
  fillLearning()
  let picked = 0
  const paths = await chooseLibraryPaths(async () => { picked++; return ['C:\\a.pdf', '', null] })
  assert.deepEqual(paths, ['C:\\a.pdf'])
  assert.equal(picked, 1)
})

test('import flow: clearing the draft while the picker is open still results in zero enqueues', async () => {
  fillLearning()
  const paths = await chooseLibraryPaths(async () => {
    // 原生选择框打开期间用户清掉了学习目标（或程序改了状态）。
    learning.goal = ''
    return ['C:\\a.pdf']
  })
  assert.deepEqual(paths, ['C:\\a.pdf'])
  assert.deepEqual(enqueue(paths), [], 'enqueue 的第二次检查必须拒绝')
  assert.equal(importer.items.length, 0)
})
