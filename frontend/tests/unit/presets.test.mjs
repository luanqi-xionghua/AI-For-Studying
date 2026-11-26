import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadAiSettings, normalizeAiSettings, saveAiSettings, saveModelChoice, saveTranslationChoice, saveTaskPreset, translationSettings, explainSettings, presetFor, credentialSlot, hasPresets, MAX_PRESETS, PRESETS_VERSION, memorySettings } from '../../src/ai/settings.mjs'
import { normalizeDocumentLimits } from '../../src/shared/document-limits.mjs'
import { normalizeRequestLimits } from '../../src/shared/request-queue.mjs'
import { presetTitle, presetDetail } from '../../src/ai/presets.ts'

const KEY = 'paperdesk.ai.settings.v1'
let store
beforeEach(() => { store = new Map(); globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) } })
afterEach(() => { delete globalThis.localStorage })
const stored = () => JSON.parse(store.get(KEY) || '{}')
const write = value => store.set(KEY, JSON.stringify(value))
const mine = (id, provider, model, extra = {}) => ({ id, name: '', provider, baseUrl: { openai: 'https://api.openai.com/v1', deepseek: 'https://api.deepseek.com', kimi: 'https://api.moonshot.cn/v1' }[provider] || '', protocol: 'chat', model, effort: '', fast: false, ...extra })

test('presets: a fresh install has no presets — nothing is built in or generated', () => {
  const settings = loadAiSettings()
  assert.deepEqual(settings.presets, [])
  assert.deepEqual([settings.assistantPreset, settings.translationPreset, settings.explainPreset], ['', '', ''])
  assert.deepEqual([settings.memoryPreset, settings.memoryEffort], ['', ''])
  assert.equal(memorySettings(settings).preset, null)
  assert.equal(settings.presetsVersion, PRESETS_VERSION)
  assert.equal(hasPresets(settings), false)
  assert.equal(presetFor(settings, 'assistant'), undefined)
  // 翻译、快速解释拿到的是空连接，不会悄悄用上顶层的默认服务商。
  assert.deepEqual([translationSettings(settings).preset, translationSettings(settings).provider, explainSettings(settings).model], [null, '', ''])
  assert.equal(store.has(KEY), false, 'loading never writes')
})

test('presets: old settings are not turned into presets; the ones the first preset version generated are cleared once', () => {
  // 预设出现之前的旧设置：不再自动生成预设，旧的翻译 / 快速解释配置也丢掉。
  write({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.4', translation: { share: false, provider: 'deepseek' }, explain: { share: 'own' } })
  const legacy = loadAiSettings()
  assert.deepEqual(legacy.presets, [])
  assert.equal('translation' in legacy || 'explain' in legacy, false)
  // 第 1 版自动生成了 assistant / translation / explain 三个预设，用户自己又建了一个：只留用户建的，三处都改用它，且不被顶层的旧值改写。
  write({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro', effort: 'max', presets: [
    mine('assistant', 'deepseek', 'deepseek-v4-pro', { effort: 'max' }), mine('translation', 'deepseek', 'deepseek-flash', { name: '翻译' }), mine('explain', 'deepseek', 'deepseek-flash', { name: '快速解释' }),
    mine('p-kimi01', 'kimi', 'kimi-latest', { name: '月之暗面' }),
  ], assistantPreset: 'assistant', translationPreset: 'p-kimi01', explainPreset: 'explain' })
  const cleaned = loadAiSettings()
  assert.deepEqual(cleaned.presets.map(item => item.id), ['p-kimi01'])
  assert.deepEqual([cleaned.assistantPreset, cleaned.translationPreset, cleaned.explainPreset], ['p-kimi01', 'p-kimi01', 'p-kimi01'])
  assert.deepEqual([cleaned.presets[0].model, cleaned.provider, cleaned.model], ['kimi-latest', 'kimi', 'kimi-latest'])
  // 只剩自动生成的：清完就是空的。
  write({ presets: [mine('assistant', 'deepseek', 'deepseek-v4-pro'), mine('translation', 'deepseek', 'deepseek-flash')], assistantPreset: 'assistant' })
  assert.deepEqual(loadAiSettings().presets, [])
  // 升级过（第 2 版）以后只清这一次：同名 id 不再动。
  write({ presetsVersion: PRESETS_VERSION, presets: [mine('assistant', 'kimi', 'kimi-latest')], assistantPreset: 'assistant' })
  assert.deepEqual(loadAiSettings().presets.map(item => item.id), ['assistant'])
})

test('presets: top-level fields always mirror the assistant preset; outside edits to them win', () => {
  const presets = [
    { id: 'a', name: '主力', provider: 'openai', baseUrl: 'https://api.openai.com/v1', protocol: 'chat', model: 'gpt-5.4', effort: 'high', fast: false },
    { id: 'b', name: '', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', protocol: 'chat', model: 'deepseek-flash', effort: 'none', fast: false },
  ]
  write({ presets, assistantPreset: 'a', translationPreset: 'b', explainPreset: 'b' })
  const settings = loadAiSettings()
  assert.deepEqual([settings.provider, settings.model, settings.effort], ['openai', 'gpt-5.4', 'high'])
  // 旧版本或测试脚本直接改顶层：阅读助手的预设跟着改，别的预设不动。
  write({ ...settings, provider: 'qwen', model: 'gpt-6', effort: 'max' })
  const edited = loadAiSettings()
  assert.deepEqual([edited.presets[0].provider, edited.presets[0].model, edited.presets[0].effort, edited.presets[0].name], ['qwen', 'gpt-6', 'max', '主力'])
  assert.deepEqual(edited.presets[1], presets[1])
})

test('presets: the composer picker edits the assistant preset only', () => {
  write({ presetsVersion: PRESETS_VERSION, presets: [mine('p-a', 'deepseek', 'deepseek-flash', { effort: 'high' }), mine('p-b', 'deepseek', 'deepseek-flash', { effort: 'none' })], assistantPreset: 'p-a', translationPreset: 'p-b', explainPreset: 'p-b' })
  const settings = loadAiSettings()
  saveModelChoice('deepseek-v4-pro', 'max', true)
  const after = loadAiSettings()
  assert.deepEqual([after.model, after.effort, after.fast], ['deepseek-v4-pro', 'max', true])
  assert.deepEqual(after.presets.find(item => item.id === 'p-a').model, 'deepseek-v4-pro')
  assert.deepEqual(after.presets.find(item => item.id === 'p-b'), settings.presets.find(item => item.id === 'p-b'))
  assert.equal(stored().model, 'deepseek-v4-pro')
})

test('translation picker: choices persist per preset without editing shared assistant or explain presets', async () => {
  const presets = [mine('a', 'openai', 'gpt-5.4', { effort: 'high' }), mine('b', 'deepseek', 'deepseek-flash')]
  write({ presets, assistantPreset: 'a', translationPreset: 'a', explainPreset: 'a' })
  saveTranslationChoice('a', 'gpt-5.4-mini', '')
  assert.deepEqual([translationSettings().model, translationSettings().effort], ['gpt-5.4-mini', ''])
  assert.deepEqual([loadAiSettings().model, explainSettings().effort], ['gpt-5.4', 'high'])
  saveTranslationChoice('b', 'deepseek-v4-pro', 'max')
  assert.deepEqual([translationSettings().model, translationSettings().effort], ['deepseek-v4-pro', 'max'])
  saveTaskPreset('translate', 'a')
  assert.deepEqual([translationSettings().model, translationSettings().effort], ['gpt-5.4-mini', ''])
  saveTranslationChoice('a', presets[0].model, presets[0].effort)
  assert.equal(Object.hasOwn(loadAiSettings().translationChoices, 'a'), false)
  const cfg = loadAiSettings(); cfg.presets[1].baseUrl = 'https://new.example/v1'
  await saveAiSettings(cfg)
  assert.equal(translationSettings(loadAiSettings(), 'b').model, 'deepseek-flash')
  assert.throws(() => saveTranslationChoice('unknown', 'm', ''), /找不到/)
})

test('presets: each feature switches to another preset; only the assistant moves the top-level fields', () => {
  write({ presets: [
    { id: 'a', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.4', effort: 'high' },
    { id: 'b', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', effort: 'none' },
    { id: 'c', provider: 'qwen', baseUrl: '', model: '', effort: '', fast: true },
  ], assistantPreset: 'a', translationPreset: 'b', explainPreset: 'b' })
  let settings = saveTaskPreset('translate', 'c')
  assert.equal(settings.provider, 'openai')
  assert.deepEqual([translationSettings(settings).provider, translationSettings(settings).fast], ['qwen', false])
  assert.equal(explainSettings(settings).provider, 'deepseek')
  settings = saveTaskPreset('assistant', 'b')
  assert.deepEqual([settings.provider, settings.model, settings.effort], ['deepseek', 'deepseek-flash', 'none'])
  assert.deepEqual([loadAiSettings().provider, stored().assistantPreset], ['deepseek', 'b'])
  assert.throws(() => saveTaskPreset('assistant', 'missing'), /找不到/)
  assert.throws(() => saveTaskPreset('nonsense', 'a'), /用途/)
})

test('presets: missing choices fall back (assistant → first, translation → assistant, explain → translation)', () => {
  const settings = normalizeAiSettings({ presets: [{ id: 'x', provider: 'kimi', model: 'kimi-latest' }, { id: 'y', provider: 'glm', model: 'glm-4.6' }], assistantPreset: 'gone', translationPreset: 'y', explainPreset: 'gone' })
  assert.deepEqual([settings.assistantPreset, settings.translationPreset, settings.explainPreset], ['x', 'y', 'y'])
  assert.equal(settings.memoryPreset, 'x')
  assert.equal(presetFor(settings, 'explain').provider, 'glm')
  // 一个预设都不剩：三处都是空的。
  const empty = normalizeAiSettings({ presets: [], assistantPreset: 'x', translationPreset: 'y' })
  assert.deepEqual([empty.assistantPreset, empty.translationPreset, empty.explainPreset, hasPresets(empty)], ['', '', '', false])
})

test('presets: ids are cleaned and de-duplicated, and the list is capped', () => {
  const many = Array.from({ length: MAX_PRESETS + 5 }, (_, index) => ({ id: index === 3 ? 'p-1' : `p-${index}`, provider: 'deepseek', model: 'deepseek-flash' }))
  many.push({ id: 'bad id!', provider: 'kimi' })
  const settings = normalizeAiSettings({ presets: many })
  assert.equal(settings.presets.length, MAX_PRESETS)
  assert.equal(new Set(settings.presets.map(item => item.id)).size, MAX_PRESETS)
  assert.ok(settings.presets.every(item => /^[\w-]+$/.test(item.id)))
  assert.equal(normalizeAiSettings({ presets: [{ id: 'bad id!', provider: 'kimi', name: 'x'.repeat(40) }] }).presets[0].name.length, 24)
})

test('credential identity includes the full API endpoint; secrets do not enter preferences', async () => {
  assert.notEqual(credentialSlot({provider:'custom',baseUrl:'https://a.test/v1'}),credentialSlot({provider:'custom',baseUrl:'https://b.test/v1'}))
  await saveAiSettings({...loadAiSettings(),apiKey:'not-saved'},[{provider:'custom',baseUrl:'https://a.test/v1',key:'not-saved'}]);assert.ok(!store.get(KEY).includes('not-saved'))
})
test('retired Codex login is not a selectable preset; existing API presets survive',()=>{
 const s=normalizeAiSettings({presets:[mine('old','codex','old'),mine('api','openai','test')],assistantPreset:'old',provider:'codex'});
 assert.deepEqual(s.presets.map(p=>p.id),['api']);assert.equal(s.assistantPreset,'api');assert.equal(s.provider,'openai');
 assert.equal(presetTitle(mine('c','custom','custom-model')),'自定义 · custom-model')
})

// ---- 预算默认值（计划 §3）：九项默认取字段上限；有效旧值保留；局部重置只在保存后落盘 ----
const DOCUMENT_KEYS = ['images', 'pages', 'characters', 'calls', 'rounds', 'searchPages', 'searchMilliseconds']
const DOCUMENT_DEFAULTS = { images: 10, pages: 40, characters: 120000, calls: 60, rounds: 8, searchPages: 500, searchMilliseconds: 30000 }
const REQUEST_DEFAULTS = { concurrent: 4, queued: 16 }
const OLD_DOCUMENT = { images: 5, pages: 8, characters: 24000, calls: 12, rounds: 3, searchPages: 120, searchMilliseconds: 10000 }
const budgetPresets = () => [mine('p-a', 'deepseek', 'deepseek-flash'), mine('p-b', 'kimi', 'kimi-latest')]
const withBudgets = (documentLimits, requestLimits) => ({ presetsVersion: PRESETS_VERSION, presets: budgetPresets(), assistantPreset: 'p-a', translationPreset: 'p-b', explainPreset: 'p-b', documentLimits, requestLimits })
const pickDocument = limits => Object.fromEntries(DOCUMENT_KEYS.map(key => [key, limits[key]]))

test('budgets: a fresh install starts at the new maxima and saving then reloading keeps them', async () => {
  const fresh = loadAiSettings()
  assert.deepEqual(pickDocument(fresh.documentLimits), DOCUMENT_DEFAULTS)
  assert.deepEqual(fresh.requestLimits, REQUEST_DEFAULTS)
  assert.equal(store.has(KEY), false, '加载不写存储')
  await saveAiSettings(fresh)
  const reopened = loadAiSettings()
  assert.deepEqual(pickDocument(reopened.documentLimits), DOCUMENT_DEFAULTS)
  assert.deepEqual(reopened.requestLimits, REQUEST_DEFAULTS)
  assert.equal(store.has(KEY), true)
})

test('budgets: an old 7+2 configuration keeps every value through save and reload, instead of being maxed out', async () => {
  write(withBudgets({ ...OLD_DOCUMENT }, { concurrent: 1, queued: 2 }))
  const loaded = loadAiSettings()
  assert.deepEqual(pickDocument(loaded.documentLimits), OLD_DOCUMENT)
  assert.deepEqual(loaded.requestLimits, { concurrent: 1, queued: 2 })
  await saveAiSettings(loaded)
  const reopened = loadAiSettings()
  assert.deepEqual(pickDocument(reopened.documentLimits), OLD_DOCUMENT)
  assert.deepEqual(reopened.requestLimits, { concurrent: 1, queued: 2 })
  // 离步进格点的有效旧值也保留。
  write(withBudgets({ ...OLD_DOCUMENT, characters: 24567 }, { concurrent: 1, queued: 0 }))
  const offGrid = loadAiSettings()
  assert.equal(offGrid.documentLimits.characters, 24567)
  assert.equal(offGrid.requestLimits.queued, 0)
  await saveAiSettings(offGrid)
  assert.equal(loadAiSettings().documentLimits.characters, 24567)
  assert.equal(loadAiSettings().requestLimits.queued, 0)
})

test('budgets: only the missing keys are filled from the new defaults', () => {
  write({ presetsVersion: PRESETS_VERSION, presets: budgetPresets(), assistantPreset: 'p-a', documentLimits: { images: 3, searchMilliseconds: 10025 }, requestLimits: { concurrent: 1 } })
  const loaded = loadAiSettings()
  assert.deepEqual(pickDocument(loaded.documentLimits), { ...DOCUMENT_DEFAULTS, images: 3, searchMilliseconds: 10025 })
  assert.deepEqual(loaded.requestLimits, { concurrent: 1, queued: 16 })
})

test('budgets: resetting only one group and saving keeps the other group and the model presets', async () => {
  write(withBudgets({ ...OLD_DOCUMENT, images: 2 }, { concurrent: 1, queued: 2 }))
  // 只点「多文件提问」的恢复本组默认，再保存。
  const onlyRequest = loadAiSettings()
  onlyRequest.requestLimits = normalizeRequestLimits()
  await saveAiSettings(onlyRequest)
  let after = loadAiSettings()
  assert.deepEqual(after.requestLimits, REQUEST_DEFAULTS)
  assert.deepEqual(pickDocument(after.documentLimits), { ...OLD_DOCUMENT, images: 2 })
  assert.deepEqual(after.presets.map(item => item.id), ['p-a', 'p-b'])
  // 只点「阅读助手每次对话」的恢复本组默认，再保存。
  after.documentLimits = normalizeDocumentLimits()
  await saveAiSettings(after)
  const reopened = loadAiSettings()
  assert.deepEqual(pickDocument(reopened.documentLimits), DOCUMENT_DEFAULTS)
  assert.deepEqual(reopened.requestLimits, REQUEST_DEFAULTS)
  assert.deepEqual(reopened.presets.map(item => item.id), ['p-a', 'p-b'])
  assert.deepEqual([reopened.assistantPreset, reopened.translationPreset], ['p-a', 'p-b'])
})

test('budgets: a local reset abandoned before saving leaves storage untouched', () => {
  write(withBudgets({ ...OLD_DOCUMENT }, { concurrent: 1, queued: 2 }))
  const before = store.get(KEY)
  // 「恢复本组默认」只改内存草稿；不点保存就关闭设置，存储应保持原值。
  const draft = loadAiSettings()
  draft.documentLimits = normalizeDocumentLimits()
  draft.requestLimits = normalizeRequestLimits()
  assert.equal(store.get(KEY), before)
  const reopened = loadAiSettings()
  assert.deepEqual(pickDocument(reopened.documentLimits), OLD_DOCUMENT)
  assert.deepEqual(reopened.requestLimits, { concurrent: 1, queued: 2 })
})
