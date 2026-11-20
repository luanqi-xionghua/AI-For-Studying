import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadAiSettings, normalizeAiSettings, saveTaskPreset, memoryEffortOptions, memoryModelOf, memorySettings, recommendedMemoryEffort, isHighMemoryEffort, PRESETS_VERSION } from '../../src/ai/settings.mjs'

const KEY = 'paperdesk.ai.settings.v1'
let store
beforeEach(() => { store = new Map(); globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) } })
afterEach(() => { delete globalThis.localStorage })
const write = value => store.set(KEY, JSON.stringify(value))
const mine = (id, provider, model, extra = {}) => ({ id, name: '', provider, baseUrl: { openai: 'https://api.openai.com/v1', deepseek: 'https://api.deepseek.com', kimi: 'https://api.moonshot.cn/v1', glm: 'https://open.bigmodel.cn/api/paas/v4' }[provider] || '', protocol: 'chat', model, effort: '', fast: false, ...extra })
const settingsWith = (presets, extra = {}) => normalizeAiSettings({ presetsVersion: PRESETS_VERSION, presets, ...extra })

test('memory: old settings without memory fields follow the assistant preset and get a recommended effort', () => {
  const settings = settingsWith([mine('a', 'deepseek', 'deepseek-flash'), mine('b', 'glm', 'glm-4.6')], { assistantPreset: 'a' })
  assert.equal(settings.memoryPreset, 'a')
  assert.equal(settings.memoryEffort, 'low')
})

test('memory: without an assistant choice it uses the first preset', () => {
  const settings = settingsWith([mine('x', 'deepseek', 'deepseek-flash'), mine('y', 'glm', 'glm-4.6')])
  assert.equal(settings.memoryPreset, 'x')
  assert.equal(settings.memoryEffort, 'low')
})

test('memory: a stale preset id falls back and does not keep an effort the new model cannot use', () => {
  const settings = settingsWith([mine('a', 'deepseek', 'deepseek-flash'), mine('b', 'glm', 'glm-4.6')], { assistantPreset: 'b', memoryPreset: 'gone', memoryEffort: 'high' })
  assert.equal(settings.memoryPreset, 'b')
  assert.equal(settings.memoryEffort, '')
})

test('memory: no presets at all leaves both fields empty', () => {
  const settings = normalizeAiSettings({ presets: [], memoryPreset: 'x', memoryEffort: 'high' })
  assert.deepEqual([settings.memoryPreset, settings.memoryEffort], ['', ''])
})

test('memory: valid values are kept', () => {
  const settings = settingsWith([mine('a', 'deepseek', 'deepseek-v4-pro')], { assistantPreset: 'a', memoryPreset: 'a', memoryEffort: 'max' })
  assert.equal(settings.memoryPreset, 'a')
  assert.equal(settings.memoryEffort, 'max')
})

test('memory: an explicit model-default choice is not replaced by the recommendation', () => {
  const settings = settingsWith([mine('a', 'deepseek', 'deepseek-flash')], { assistantPreset: 'a', memoryPreset: 'a', memoryEffort: '' })
  assert.equal(settings.memoryEffort, '')
})

test('memory: an effort the model does not support falls back to the recommendation', () => {
  const gpt = settingsWith([mine('a', 'openai', 'gpt-5.4-mini')], { assistantPreset: 'a', memoryPreset: 'a', memoryEffort: 'max' })
  assert.equal(gpt.memoryEffort, 'low')
  const kimi = settingsWith([mine('a', 'kimi', 'kimi-k2-turbo-preview')], { assistantPreset: 'a', memoryPreset: 'a', memoryEffort: 'low' })
  assert.equal(kimi.memoryEffort, '')
  const glm = settingsWith([mine('a', 'glm', 'glm-4.6')], { assistantPreset: 'a', memoryPreset: 'a' })
  assert.equal(glm.memoryEffort, '')
})

test('memory: custom models get the fallback ladder and keep a fallback effort', () => {
  const preset = mine('a', 'custom', 'my-model')
  const defaults = settingsWith([preset], { assistantPreset: 'a', memoryPreset: 'a' })
  assert.equal(defaults.memoryEffort, '')
  assert.deepEqual(memoryEffortOptions(defaults.presets[0]), ['none', 'low', 'medium', 'high', 'xhigh'])
  const chosen = settingsWith([preset], { assistantPreset: 'a', memoryPreset: 'a', memoryEffort: 'medium' })
  assert.equal(chosen.memoryEffort, 'medium')
})

test('memory: a non-string effort is discarded', () => {
  for (const bad of [3, null, {}]) {
    const settings = settingsWith([mine('a', 'deepseek', 'deepseek-flash')], { assistantPreset: 'a', memoryPreset: 'a', memoryEffort: bad })
    assert.equal(settings.memoryEffort, 'low')
  }
})

test('memory: switching to a preset whose model cannot use the stored effort falls back', () => {
  const written = { presetsVersion: PRESETS_VERSION, presets: [mine('a', 'deepseek', 'deepseek-v4-pro'), mine('b', 'openai', 'gpt-5.4-mini')], assistantPreset: 'a', memoryPreset: 'a', memoryEffort: 'max' }
  assert.equal(normalizeAiSettings(written).memoryEffort, 'max')
  assert.equal(normalizeAiSettings({ ...written, memoryPreset: 'b' }).memoryEffort, 'low')
})

test('memory: recommendedMemoryEffort picks low only when the model lists it', () => {
  assert.equal(recommendedMemoryEffort({ efforts: ['none', 'low', 'high', 'max'] }), 'low')
  assert.equal(recommendedMemoryEffort({ efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }), 'low')
  assert.equal(recommendedMemoryEffort({ efforts: ['none', 'high'] }), '')
  assert.equal(recommendedMemoryEffort({ efforts: [] }), '')
  assert.equal(recommendedMemoryEffort({}), '')
  assert.equal(recommendedMemoryEffort(undefined), '')
  assert.equal(recommendedMemoryEffort(null), '')
})

test('memory: isHighMemoryEffort only counts the four high ladders', () => {
  for (const value of ['high', 'xhigh', 'max', 'ultra']) assert.equal(isHighMemoryEffort(value), true, value)
  for (const value of ['', 'none', 'minimal', 'low', 'medium', undefined, 'HIGH']) assert.equal(isHighMemoryEffort(value), false, String(value))
})

test('memory: memoryEffortOptions handles undefined and unknown models', () => {
  assert.deepEqual(memoryEffortOptions(undefined), [])
  assert.deepEqual(memoryEffortOptions(null), [])
  assert.deepEqual(memoryEffortOptions(mine('a', 'deepseek', 'deepseek-flash')), ['none', 'low', 'high', 'max'])
  assert.deepEqual(memoryEffortOptions(mine('a', 'deepseek', 'custom-model')), ['none', 'low', 'medium', 'high', 'xhigh'])
  assert.equal(memoryModelOf(mine('a', 'deepseek', 'deepseek-flash')).name, 'DeepSeek Flash')
  assert.equal(memoryModelOf(mine('a', 'deepseek', 'custom-model')), undefined)
  assert.equal(memoryModelOf(undefined), undefined)
})

test('memory: memorySettings resolves the memory preset connection', () => {
  write({ presetsVersion: PRESETS_VERSION, presets: [mine('a', 'openai', 'gpt-5.4'), mine('b', 'deepseek', 'deepseek-flash')], assistantPreset: 'a', translationPreset: 'b', explainPreset: 'b', memoryPreset: 'b', memoryEffort: 'low' })
  const config = memorySettings(loadAiSettings())
  assert.equal(config.provider, 'deepseek')
  assert.equal(config.model, 'deepseek-flash')
  assert.equal(config.effort, 'low')
  assert.equal(config.preset.id, 'b')
  assert.equal(config.fast, false)
  // 传入未归一化、但带 presets 的对象时，强度还会再过一遍可选档位。
  const raw = { presets: [mine('k', 'kimi', 'kimi-k2-turbo-preview')], memoryPreset: 'k', memoryEffort: 'high' }
  assert.equal(memorySettings(raw).effort, '')
  const none = memorySettings({ presets: [] })
  assert.deepEqual([none.preset, none.provider, none.model], [null, '', ''])
})

test('memory: saveTaskPreset(memory) only moves the memory field', () => {
  write({ presetsVersion: PRESETS_VERSION, presets: [mine('a', 'deepseek', 'deepseek-flash', { effort: 'high' }), mine('b', 'kimi', 'kimi-latest')], assistantPreset: 'a', translationPreset: 'a', explainPreset: 'a' })
  const returned = saveTaskPreset('memory', 'b')
  assert.equal(returned.memoryPreset, 'b')
  const settings = loadAiSettings()
  assert.equal(settings.memoryPreset, 'b')
  assert.deepEqual([settings.provider, settings.model, settings.effort, settings.assistantPreset], ['deepseek', 'deepseek-flash', 'high', 'a'])
  assert.throws(() => saveTaskPreset('memory', 'missing'), /找不到/)
})
