import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadAiSettings, normalizeAiSettings, saveAiSettings, saveModelChoice, saveTaskPreset, translationSettings, explainSettings, presetFor, loadApiKey, hasPresets, MAX_PRESETS, PRESETS_VERSION } from '../../src/ai/settings.mjs'
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
  write({ ...settings, provider: 'codex', model: 'gpt-6', effort: 'max' })
  const edited = loadAiSettings()
  assert.deepEqual([edited.presets[0].provider, edited.presets[0].model, edited.presets[0].effort, edited.presets[0].name], ['codex', 'gpt-6', 'max', '主力'])
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

test('presets: each feature switches to another preset; only the assistant moves the top-level fields', () => {
  write({ presets: [
    { id: 'a', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.4', effort: 'high' },
    { id: 'b', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', effort: 'none' },
    { id: 'c', provider: 'codex', baseUrl: '', model: '', effort: '', fast: true },
  ], assistantPreset: 'a', translationPreset: 'b', explainPreset: 'b' })
  let settings = saveTaskPreset('translate', 'c')
  assert.equal(settings.provider, 'openai')
  assert.deepEqual([translationSettings(settings).provider, translationSettings(settings).fast], ['codex', true])
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

test('presets: saving writes only the keys it is given, and never puts them in localStorage', async () => {
  const settings = loadAiSettings()
  await saveAiSettings({ ...settings, rememberKey: true }, { kimi: 'kimi-secret', glm: 'glm-secret' })
  assert.equal(await loadApiKey('kimi'), 'kimi-secret')
  assert.equal(await loadApiKey('glm'), 'glm-secret')
  assert.ok(!store.get(KEY).includes('secret'))
  assert.deepEqual([stored().presets, stored().presetsVersion], [[], PRESETS_VERSION])
  // 旧的调用方式：字符串就是阅读助手所用服务商的密钥。
  write({ presetsVersion: PRESETS_VERSION, presets: [mine('p-main', 'deepseek', 'deepseek-flash')], assistantPreset: 'p-main' })
  await saveAiSettings({ ...loadAiSettings(), provider: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' }, 'qwen-secret')
  assert.equal(await loadApiKey('qwen'), 'qwen-secret')
  assert.equal(loadAiSettings().presets.find(item => item.id === 'p-main').provider, 'qwen')
})

test('presets: titles fall back to the model name and say where Codex / custom models come from', () => {
  const base = { id: 'a', name: '', baseUrl: '', protocol: 'chat', effort: 'low', fast: false }
  assert.equal(presetTitle({ ...base, provider: 'deepseek', model: 'deepseek-flash' }), 'DeepSeek Flash')
  assert.equal(presetTitle({ ...base, provider: 'codex', model: '' }), 'Codex · 模型默认')
  assert.equal(presetTitle({ ...base, provider: 'custom', model: 'llama3' }), '自定义 · llama3')
  assert.equal(presetTitle({ ...base, name: '快译', provider: 'deepseek', model: 'deepseek-flash' }), '快译')
  assert.equal(presetDetail({ ...base, name: '快译', provider: 'openai', model: 'gpt-5.4-mini', fast: true }), 'OpenAI API · GPT-5.4 Mini · Fast') // 思考强度不算预设的一部分
  assert.equal(presetDetail({ ...base, provider: 'deepseek', model: 'deepseek-flash', effort: 'max', fast: true }), 'DeepSeek')
})
