import { test } from 'node:test'
import assert from 'node:assert/strict'
import { translationSettings, supportsFast } from '../../src/ai/settings.mjs'
import { UI_FONTS, READING_FONTS, SKETCH_ANSWER_FONTS, normalizePreferences, defaultPreferences } from '../../src/settings/model.ts'

const presets = [
  { id: 'p-main', provider: 'openai', baseUrl: '', model: 'gpt-5.5', effort: 'high', fast: false },
  { id: 'p-mini', provider: 'openai', baseUrl: '', model: 'gpt-5.4-mini', effort: 'low', fast: true },
  { id: 'p-ds', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', effort: 'none', fast: true },
]

test('translation AI: uses the preset chosen for translation, with its own model, effort and fast', () => {
  const own = translationSettings({ presets, assistantPreset: 'p-main', translationPreset: 'p-mini' })
  assert.equal(own.provider, 'openai')
  assert.deepEqual([own.model, own.effort, own.fast], ['gpt-5.4-mini', 'low', false])
  // 没单独选：和阅读助手用同一个预设
  const fallback = translationSettings({ presets, assistantPreset: 'p-main' })
  assert.deepEqual([fallback.provider, fallback.model, fallback.fast], ['openai', 'gpt-5.5', false])
  // 一个预设都没有：连接信息全空，不会悄悄用顶层的旧配置
  const none = translationSettings({ provider: 'openai', model: 'gpt-5.5' })
  assert.deepEqual([none.preset, none.provider, none.model], [null, '', ''])
})

test('translation AI: its own provider and endpoint; fast only where the provider supports it', () => {
  const own = translationSettings({ presets, assistantPreset: 'p-main', translationPreset: 'p-ds' })
  assert.deepEqual([own.provider, own.baseUrl, own.model, own.fast], ['deepseek', 'https://api.deepseek.com', 'deepseek-flash', false])
  assert.ok(!supportsFast('openai') && !supportsFast('deepseek'))
})

test('fonts: common Latin fonts are offered everywhere and survive normalization', () => {
  for (const list of [UI_FONTS, READING_FONTS, SKETCH_ANSWER_FONTS]) {
    assert.ok(list.some(item => item.label === 'Arial'), 'Arial')
    assert.ok(list.some(item => item.label === 'Times New Roman'), 'Times New Roman')
  }
  const times = READING_FONTS.find(item => item.label === 'Times New Roman')
  assert.match(times.stack, /^'Times New Roman', .*SimSun/)
  const prefs = defaultPreferences()
  prefs.appearance.uiFont = UI_FONTS.find(item => item.label === 'Arial').id
  prefs.appearance.readingFont = times.id
  prefs.appearance.sketchAnswerFont = SKETCH_ANSWER_FONTS.find(item => item.label === 'Georgia').id
  const normalized = normalizePreferences(prefs)
  assert.equal(normalized.appearance.uiFont, prefs.appearance.uiFont)
  assert.equal(normalized.appearance.readingFont, times.id)
  assert.equal(normalized.appearance.sketchAnswerFont, prefs.appearance.sketchAnswerFont)
})
