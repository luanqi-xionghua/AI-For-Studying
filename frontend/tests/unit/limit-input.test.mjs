import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DOCUMENT_LIMIT_FIELDS, DOCUMENT_LIMITS, MODEL_STATE_CHARACTERS, normalizeDocumentLimits } from '../../src/shared/document-limits.mjs'
import { REQUEST_LIMIT_FIELDS, normalizeRequestLimits } from '../../src/shared/request-queue.mjs'
import { displayDraft, displayStep, displayValue, parseDraft, parseLimit } from '../../src/settings/limit-input.ts'
import { loadAiSettings, saveAiSettings, PRESETS_VERSION } from '../../src/ai/settings.mjs'

const KEY = 'paperdesk.ai.settings.v1'
const settingsSource = readFileSync(new URL('../../src/components/settings/AiSettings.vue', import.meta.url), 'utf8')
let store
beforeEach(() => { store = new Map(); globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) } })
afterEach(() => { delete globalThis.localStorage })
const stored = () => JSON.parse(store.get(KEY) || '{}')
const write = value => store.set(KEY, JSON.stringify(value))
const field = key => DOCUMENT_LIMIT_FIELDS.find(item => item.key === key)
const requestField = key => REQUEST_LIMIT_FIELDS.find(item => item.key === key)
const pick = (limits, keys) => Object.fromEntries(keys.map(key => [key, limits[key]]))

const DOCUMENT_KEYS = ['images', 'pages', 'characters', 'calls', 'rounds', 'searchPages', 'searchMilliseconds']
/** 计划 §3 表里的九个新默认值：显式写出来，不以读取同一个 .default 作为唯一预期。 */
const DOCUMENT_DEFAULTS = { images: 10, pages: 40, characters: 120000, calls: 60, rounds: 8, searchPages: 500, searchMilliseconds: 30000 }
const REQUEST_DEFAULTS = { concurrent: 4, queued: 16 }
/** 计划 §3 表要求的合法内部范围与换算元数据。 */
const DOCUMENT_FIELD_SHAPE = [
  { key: 'images', min: 1, max: 10, default: 10 },
  { key: 'pages', min: 1, max: 40, default: 40 },
  { key: 'characters', min: 1000, max: 120000, default: 120000, step: 1000 },
  { key: 'calls', min: 1, max: 60, default: 60 },
  { key: 'rounds', min: 1, max: 8, default: 8 },
  { key: 'searchPages', min: 10, max: 500, default: 500 },
  { key: 'searchMilliseconds', min: 1000, max: 30000, default: 30000, scale: 1000 },
]
const REQUEST_FIELD_SHAPE = [
  { key: 'concurrent', min: 1, max: 4, default: 4 },
  { key: 'queued', min: 0, max: 16, default: 16 },
]
const OLD_DOCUMENT = { images: 5, pages: 8, characters: 24000, calls: 12, rounds: 3, searchPages: 120, searchMilliseconds: 10000 }
const preset = id => ({ id, name: '', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', protocol: 'chat', model: 'deepseek-flash', effort: '', fast: false })
const legacySettings = (presets, documentLimits, requestLimits) => ({ presetsVersion: PRESETS_VERSION, presets, assistantPreset: presets[0]?.id || '', translationPreset: presets[0]?.id || '', explainPreset: presets[0]?.id || '', memoryPreset: presets[0]?.id || '', documentLimits, requestLimits })

test('budgets: the nine defaults are the plan maxima, equal to each field max, and keep their ranges', () => {
  assert.deepEqual(DOCUMENT_LIMITS, { ...DOCUMENT_DEFAULTS, seedCharacters: 8000, pageBatch: 3 })
  for (const item of DOCUMENT_FIELD_SHAPE) {
    assert.equal(item.default, item.max, `${item.key} 的新默认值应等于字段上限`)
    assert.deepEqual({ ...field(item.key), label: undefined }, { ...item, label: undefined })
  }
  assert.deepEqual(REQUEST_DEFAULTS, Object.fromEntries(REQUEST_LIMIT_FIELDS.map(item => [item.key, item.default])))
  for (const item of REQUEST_FIELD_SHAPE) {
    assert.equal(item.default, item.max, `${item.key} 的新默认值应等于字段上限`)
    assert.deepEqual({ ...requestField(item.key), label: undefined }, { ...item, label: undefined })
  }
  // 不是这九个控件的东西保持原值。
  assert.equal(DOCUMENT_LIMITS.seedCharacters, 8000)
  assert.equal(DOCUMENT_LIMITS.pageBatch, 3)
  assert.equal(MODEL_STATE_CHARACTERS, 16 * 1024 * 1024)
  assert.deepEqual(normalizeDocumentLimits(), DOCUMENT_LIMITS)
  assert.deepEqual(normalizeRequestLimits(), REQUEST_DEFAULTS)
})

test('normalize: missing keys, wrong types and non-finite numbers fall back to the new defaults', () => {
  const emptyDocument = { ...DOCUMENT_DEFAULTS, seedCharacters: 8000, pageBatch: 3 }
  for (const value of [undefined, null, 'images', 5, [], { images: '10', pages: '40', calls: '60' }, { images: NaN, pages: Infinity, characters: -Infinity }]) {
    assert.deepEqual(normalizeDocumentLimits(value), emptyDocument)
  }
  for (const value of [undefined, null, 'queued', 0, [], { concurrent: '4', queued: '16' }, { concurrent: NaN, queued: Infinity }]) {
    assert.deepEqual(normalizeRequestLimits(value), REQUEST_DEFAULTS)
  }
  // 缺的键取新默认，给了的有限值保留。
  assert.deepEqual(pick(normalizeDocumentLimits({ images: 3 }), DOCUMENT_KEYS), { ...DOCUMENT_DEFAULTS, images: 3 })
  assert.deepEqual(normalizeRequestLimits({ concurrent: 1 }), { concurrent: 1, queued: 16 })
})

test('normalize: finite out-of-range values are clamped instead of being forced to the max', () => {
  assert.deepEqual(pick(normalizeDocumentLimits({ images: 0, pages: 999, characters: 5, calls: -3, rounds: 1e9, searchPages: 0, searchMilliseconds: 999999 }), DOCUMENT_KEYS),
    { images: 1, pages: 40, characters: 1000, calls: 1, rounds: 8, searchPages: 10, searchMilliseconds: 30000 })
  assert.equal(normalizeDocumentLimits({ images: 7.9 }).images, 7)
  assert.deepEqual(normalizeRequestLimits({ concurrent: 0, queued: 99 }), { concurrent: 1, queued: 16 })
  assert.deepEqual(normalizeRequestLimits({ concurrent: 3.8, queued: -2 }), { concurrent: 3, queued: 0 })
})

test('normalize: a queued limit of zero is a valid configuration', () => {
  assert.deepEqual(normalizeRequestLimits({ queued: 0 }), { concurrent: 4, queued: 0 })
  assert.deepEqual(normalizeRequestLimits({ concurrent: 1, queued: 0 }), { concurrent: 1, queued: 0 })
})

test('normalize: old defaults and custom values survive untouched; the max is not written over them', () => {
  const old = normalizeDocumentLimits({ ...OLD_DOCUMENT, seedCharacters: 8000 })
  assert.deepEqual(pick(old, DOCUMENT_KEYS), OLD_DOCUMENT)
  for (const key of DOCUMENT_KEYS) assert.notEqual(old[key], DOCUMENT_DEFAULTS[key])
  const custom = normalizeDocumentLimits({ ...OLD_DOCUMENT, images: 2, pages: 3, characters: 24567 })
  assert.deepEqual(pick(custom, DOCUMENT_KEYS), { ...OLD_DOCUMENT, images: 2, pages: 3, characters: 24567 })
  assert.deepEqual(normalizeRequestLimits({ concurrent: 1, queued: 2 }), { concurrent: 1, queued: 2 })
})

test('settings: a fresh install starts at the maxima and saving then reloading keeps them', async () => {
  const fresh = loadAiSettings()
  assert.deepEqual(pick(fresh.documentLimits, DOCUMENT_KEYS), DOCUMENT_DEFAULTS)
  assert.deepEqual(fresh.requestLimits, REQUEST_DEFAULTS)
  assert.equal(store.has(KEY), false, '加载不会写存储')
  const saved = await saveAiSettings(fresh)
  assert.deepEqual(pick(saved.documentLimits, DOCUMENT_KEYS), DOCUMENT_DEFAULTS)
  assert.deepEqual(saved.requestLimits, REQUEST_DEFAULTS)
  const reopened = loadAiSettings()
  assert.deepEqual(pick(reopened.documentLimits, DOCUMENT_KEYS), DOCUMENT_DEFAULTS)
  assert.deepEqual(reopened.requestLimits, REQUEST_DEFAULTS)
})

test('settings: resetting only one group and saving preserves the other group and the model presets', async () => {
  const presets = [preset('p-a'), preset('p-b')]
  write(legacySettings(presets, { ...OLD_DOCUMENT, images: 2 }, { concurrent: 1, queued: 2 }))
  // 只恢复「多文件提问」：阅读预算与模型预设原样保留。
  const onlyRequest = loadAiSettings()
  onlyRequest.requestLimits = normalizeRequestLimits()
  await saveAiSettings(onlyRequest)
  let after = loadAiSettings()
  assert.deepEqual(after.requestLimits, REQUEST_DEFAULTS)
  assert.deepEqual(pick(after.documentLimits, DOCUMENT_KEYS), { ...OLD_DOCUMENT, images: 2 })
  assert.deepEqual(after.presets.map(item => item.id), ['p-a', 'p-b'])
  // 再只恢复「阅读助手每次对话」：刚才恢复的请求预算保持不动。
  after.documentLimits = normalizeDocumentLimits()
  await saveAiSettings(after)
  const reopened = loadAiSettings()
  assert.deepEqual(pick(reopened.documentLimits, DOCUMENT_KEYS), DOCUMENT_DEFAULTS)
  assert.deepEqual(reopened.requestLimits, REQUEST_DEFAULTS)
  assert.deepEqual(reopened.presets.map(item => item.id), ['p-a', 'p-b'])
  assert.equal(reopened.provider, 'deepseek')
})

test('settings: a local reset that is abandoned is never written to storage', () => {
  write(legacySettings([preset('p-a')], { ...OLD_DOCUMENT }, { concurrent: 1, queued: 2 }))
  const before = store.get(KEY)
  const draft = loadAiSettings()
  draft.documentLimits = normalizeDocumentLimits()
  draft.requestLimits = normalizeRequestLimits()
  assert.equal(store.get(KEY), before, '只改内存、不保存时存储不变')
  const reopened = loadAiSettings()
  assert.deepEqual(pick(reopened.documentLimits, DOCUMENT_KEYS), OLD_DOCUMENT)
  assert.deepEqual(reopened.requestLimits, { concurrent: 1, queued: 2 })
  assert.equal(reopened.presets.length, 1)
})

test('time: seconds display round-trips to integer milliseconds without float truncation', () => {
  const seconds = field('searchMilliseconds')
  for (const [milliseconds, shown] of [[1000, '1'], [10000, '10'], [10025, '10.025'], [30000, '30']]) {
    assert.equal(displayValue(seconds, milliseconds), shown)
    assert.equal(parseLimit(seconds, shown), milliseconds)
  }
  // 1000–30000 的每个整数毫秒都能无损往返。
  for (let milliseconds = 1000; milliseconds <= 30000; milliseconds++) {
    assert.equal(parseLimit(seconds, displayValue(seconds, milliseconds)), milliseconds, `${milliseconds} 毫秒往返丢失`)
  }
  assert.equal(displayStep(seconds, '10.025'), 0.001)
  assert.equal(seconds.min / (seconds.scale ?? 1), 1)
  assert.equal(seconds.max / (seconds.scale ?? 1), 30)
})

test('settings: a draft rejected on parse never reaches storage; the failing key is reportable', () => {
  write(legacySettings([preset('p-a')], { ...OLD_DOCUMENT }, { concurrent: 1, queued: 2 }))
  const before = store.get(KEY)
  const loaded = loadAiSettings()
  const draft = displayDraft(DOCUMENT_LIMIT_FIELDS, loaded.documentLimits)
  draft.searchMilliseconds = '10.0251'
  const parsed = parseDraft(DOCUMENT_LIMIT_FIELDS, draft)
  assert.equal(parsed.ok, false)
  assert.equal(parsed.key, 'searchMilliseconds', '失败字段可定位，供展开 details / aria-invalid / 聚焦')
  assert.equal(store.get(KEY), before, '解析失败不调用保存，旧存储不变')
  // 也不合法时不能先把旧存储写成新默认。
  assert.deepEqual(pick(loadAiSettings().documentLimits, DOCUMENT_KEYS), OLD_DOCUMENT)
  assert.notDeepEqual(pick(loadAiSettings().documentLimits, DOCUMENT_KEYS), DOCUMENT_DEFAULTS)
})

test('time: invalid seconds are rejected with the 1-30 / three-decimal message', () => {
  const seconds = field('searchMilliseconds')
  for (const raw of ['', '   ', '0.999', '30.001', '10.0251', 'abc', '10.', '.5', '-1', '1e3', '10,025', 'NaN', 'Infinity']) {
    assert.throws(() => parseLimit(seconds, raw), /须为 1–30 秒，最多 3 位小数。/, `应拒绝 ${JSON.stringify(raw)}`)
  }
  assert.equal(parseLimit(seconds, ' 10.025 '), 10025)
  assert.equal(parseLimit(seconds, '10.02'), 10020)
  assert.equal(parseLimit(seconds, '1'), 1000)
})

test('characters: an off-grid stored value such as 24567 stays valid and uses step 1', () => {
  const characters = field('characters')
  assert.equal(parseLimit(characters, '24567'), 24567)
  assert.equal(displayValue(characters, 24567), '24567')
  assert.equal(displayStep(characters, '24567'), 1)
  assert.equal(displayStep(characters, '24000'), 1000)
  assert.equal(displayStep(characters, ''), 1000)
  assert.equal(displayStep(field('images'), '10'), 1)
  assert.throws(() => parseLimit(characters, '999'), /1000–120000 的整数/)
  assert.throws(() => parseLimit(characters, '120001'), /1000–120000 的整数/)
  assert.throws(() => parseLimit(characters, '24567.5'), /1000–120000 的整数/)
  assert.equal(parseLimit(characters, '120000'), 120000)
})

test('form draft: parseDraft aborts on the first invalid field and reports its key', () => {
  const valid = displayDraft(DOCUMENT_LIMIT_FIELDS, { ...DOCUMENT_DEFAULTS, searchMilliseconds: 10025 })
  assert.deepEqual(valid, { images: '10', pages: '40', characters: '120000', calls: '60', rounds: '8', searchPages: '500', searchMilliseconds: '10.025' })
  assert.deepEqual(parseDraft(DOCUMENT_LIMIT_FIELDS, valid), { ok: true, values: { ...DOCUMENT_DEFAULTS, searchMilliseconds: 10025 } })
  const invalid = { ...valid, images: '', searchMilliseconds: '10.0251' }
  assert.deepEqual(parseDraft(DOCUMENT_LIMIT_FIELDS, invalid), { ok: false, key: 'images', message: '页图次数 / 每次对话须为 1–10 的整数。' })
  const secondsInvalid = { ...valid, searchMilliseconds: '10.0251' }
  assert.deepEqual(parseDraft(DOCUMENT_LIMIT_FIELDS, secondsInvalid), { ok: false, key: 'searchMilliseconds', message: '搜索时间须为 1–30 秒，最多 3 位小数。' })
})

test('labels: the seven reading labels match the plan table exactly and stay unique', () => {
  const labels = Object.fromEntries(DOCUMENT_LIMIT_FIELDS.map(item => [item.key, item.label]))
  assert.deepEqual(labels, {
    images: '页图次数 / 每次对话',
    pages: '证据页数 / 每次对话',
    characters: '证据文字 / 每次对话（字符）',
    calls: 'PDF 读取次数 / 每次对话',
    rounds: 'API 检索轮次 / 每次对话',
    searchPages: '搜索扫描页数 / 每次对话（按单次搜索）',
    searchMilliseconds: '搜索时间 / 每次对话（按单次搜索，秒）',
  })
  assert.equal(new Set(Object.values(labels)).size, 7)
  for (const label of Object.values(labels)) {
    assert.match(label, /每次对话/)
    assert.doesNotMatch(label, /每题/)
  }
  // 两个搜索项注明按单次搜索；页数/时间只描述单次调用，不说成整轮总额。
  assert.match(labels.searchPages, /按单次搜索/)
  assert.match(labels.searchPages, /页/)
  assert.match(labels.searchMilliseconds, /按单次搜索/)
  assert.match(labels.searchMilliseconds, /秒/)
  // 请求组只保留界面短标签；完整字段说明仍在字段表里。
  for (const [key, label] of [['concurrent', '同时运行的提问'], ['queued', '最多等待的提问']]) {
    assert.ok(settingsSource.includes(`'${label}'`), `AiSettings 应保留短标签 ${label}`)
    assert.ok(requestField(key).label.includes('全部窗口'))
  }
})

test('settings surface: seconds are projected to min=1 max=30 step=0.001 and errors expand, mark and focus', () => {
  // 显示边界：搜索时间输入框用秒，范围 1–30，步长 0.001；characters 离格值时 step=1。
  assert.match(settingsSource, /:min="field\.min \/ \(field\.scale \?\? 1\)"/)
  assert.match(settingsSource, /:max="field\.max \/ \(field\.scale \?\? 1\)"/)
  assert.match(settingsSource, /:step="displayStep\(field, docDraft\[field\.key\]\)"/)
  assert.match(settingsSource, /:value="docDraft\[field\.key\]"/)
  assert.match(settingsSource, /<summary>阅读助手每次对话<\/summary>/)
  assert.match(settingsSource, /阅读助手每次提问使用这组预算。搜索页数和时间按单次搜索计算。模拟测试的规划和出题使用独立预算。/)
  assert.match(settingsSource, /id="doc-limit-help"/)
  // 七项草稿的渲染来自字段表，请求组的范围/默认值也从字段表派生。
  assert.match(settingsSource, /<label v-for="field in docFields"/)
  assert.match(settingsSource, /const requestFields = REQUEST_LIMIT_FIELDS\.map\(field => \(\{ key: field\.key, label: .*min: field\.min, max: field\.max, default: field\.default \}\)\)/)
  // 编辑中允许空串：输入直接写草稿，没有 watcher 归一化归零。
  assert.match(settingsSource, /docDraft\[key\] = \(event\.target as HTMLInputElement\)\.value/)
  assert.doesNotMatch(settingsSource, /watch\(docDraft/)
  // 保存：先 parse 全部 → 再 normalize → 再 saveAiSettings；成功后按返回值刷新草稿并 emit。
  const saveBody = settingsSource.slice(settingsSource.indexOf('async function save()'), settingsSource.indexOf('defineExpose'))
  assert.ok(saveBody.indexOf('readDocumentLimits()') >= 0 && saveBody.indexOf('readRequestLimits()') > saveBody.indexOf('readDocumentLimits()'))
  assert.ok(saveBody.indexOf('normalizeDocumentLimits(documentLimits)') > saveBody.indexOf('readDocumentLimits()'))
  assert.ok(saveBody.indexOf('normalizeRequestLimits(requestLimits)') > saveBody.indexOf('readRequestLimits()'))
  assert.ok(saveBody.indexOf('saveAiSettings(') > saveBody.indexOf('normalizeRequestLimits(requestLimits)'))
  assert.ok(saveBody.indexOf('refreshDocDraft(saved.documentLimits)') > saveBody.indexOf('saveAiSettings('))
  assert.ok(saveBody.indexOf("emit('saved', saved)") > saveBody.indexOf('saveAiSettings('))
  // 校验失败：抛出前展开分组、标 aria-invalid、聚焦 data-limit-key 对应的输入。
  assert.match(settingsSource, /invalid\[key\] = message/)
  assert.match(settingsSource, /details\.open = true/)
  assert.match(settingsSource, /querySelector<HTMLInputElement>\(`\[data-limit-key="\$\{key\}"\]`\)\?\.focus\(\)/)
  assert.match(settingsSource, /:aria-invalid="invalid\[field\.key\] \? 'true' : undefined"/)
  assert.equal((settingsSource.match(/:data-limit-key="field\.key"/g) || []).length, 2)
  // 两组各一个 type=button 的「恢复本组默认」，分别只动本组并 markEdited。
  assert.equal((settingsSource.match(/>恢复本组默认<\/button>/g) || []).length, 2)
  assert.match(settingsSource, /<button type="button" class="text-button" @click="resetBudget\('document'\)">恢复本组默认<\/button>/)
  assert.match(settingsSource, /<button type="button" class="text-button" @click="resetBudget\('request'\)">恢复本组默认<\/button>/)
  const resetBody = settingsSource.slice(settingsSource.indexOf('function resetBudget'), settingsSource.indexOf('// 四处用途各选一个预设'))
  assert.match(resetBody, /refreshDocDraft\(normalizeDocumentLimits\(\)\)/)
  assert.match(resetBody, /settings\.value\.requestLimits = normalizeRequestLimits\(\)/)
  assert.match(resetBody, /markEdited\(\)/)
})
