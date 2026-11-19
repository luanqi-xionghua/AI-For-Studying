// @vitest-environment happy-dom
// 组件模拟测试（不在 npm test 里，依赖不写进 package.json）。在 frontend/ 下运行：
//   npm i --no-save vitest@3 @vue/test-utils happy-dom
//   npx vitest run tests/sim
import { it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

it('阅读助手输入栏：抽屉里切换预设，模型按钮与模型胶囊跟着换', async () => {
  localStorage.setItem('paperdesk.ai.settings.v1', JSON.stringify({ presets: [
    { id: 'a', name: '', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.4', effort: 'high' },
    { id: 'b', name: '深读', provider: 'anthropic', baseUrl: 'https://api.anthropic.com', protocol: 'anthropic', model: 'claude-sonnet-5-5', effort: 'max' },
  ], assistantPreset: 'a', translationPreset: 'b', explainPreset: 'b' }))
  const AiPane = (await import('../../src/components/AiPane.vue')).default
  const w = mount(AiPane, { attachTo: document.body, props: { document: { id: 'doc-1', title: '示例.pdf', kind: 'pdf' }, context: { page: 1, selection: {} } } })
  await flushPromises()
  const button = () => w.find('.model-picker')
  expect(button().text()).toContain('GPT-5.4')
  await button().trigger('click')
  await flushPromises(); await new Promise(r => setTimeout(r, 50)); await flushPromises()
  const group = w.find('[aria-label="模型预设"]')
  expect(group.exists()).toBe(true)
  const radios = group.findAll('[role="radio"]')
  expect(radios.map(r => [r.text(), r.attributes('aria-checked')])).toEqual([['GPT-5.4', 'true'], ['深读', 'false']])
  await radios[1].trigger('click')
  await flushPromises()
  expect(button().text()).toContain('Claude Sonnet 5.5')
  const stored = JSON.parse(localStorage.getItem('paperdesk.ai.settings.v1')!)
  expect([stored.assistantPreset, stored.provider, stored.model, stored.effort]).toEqual(['b', 'anthropic', 'claude-sonnet-5-5', 'max'])
  expect(w.find('.model-chips').findAll('[role="option"]').map(o => o.text())).toContain('Claude Haiku 5.5')
  // 在新预设上改模型：只改这个预设
  const haiku = w.find('.model-chips').findAll('[role="option"]').find(o => o.text() === 'Claude Haiku 5.5')!
  await haiku.trigger('click')
  const raw = JSON.parse(localStorage.getItem('paperdesk.ai.settings.v1')!)
  expect([raw.model, raw.assistantPreset]).toEqual(['claude-haiku-5-5', 'b'])
  const { loadAiSettings } = await import('../../src/ai/settings.mjs')
  const after = loadAiSettings()
  expect(after.presets.find((p: any) => p.id === 'b').model).toBe('claude-haiku-5-5')
  expect(after.presets.find((p: any) => p.id === 'a').model).toBe('gpt-5.4')
  await w.find('[aria-label="管理模型预设"]').trigger('click')
  expect(w.emitted('settings')).toHaveLength(1)
  w.unmount()
})
