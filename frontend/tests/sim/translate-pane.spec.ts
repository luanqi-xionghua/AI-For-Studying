// @vitest-environment happy-dom
// 组件模拟测试（不在 npm test 里，依赖不写进 package.json）。在 frontend/ 下运行：
//   npm i --no-save vitest@3 @vue/test-utils happy-dom
//   npx vitest run tests/sim
import { it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

it('翻译栏：只用 AI 翻译，显示所选预设，点开可换成别的预设', async () => {
  localStorage.setItem('paperdesk.ai.settings.v1', JSON.stringify({ presets: [
    { id: 'a', name: '', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.4', effort: 'high' },
    { id: 'b', name: '快译', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', effort: '' },
  ], assistantPreset: 'a', translationPreset: 'b', explainPreset: 'b' }))
  const TranslatePane = (await import('../../src/components/TranslatePane.vue')).default
  const w = mount(TranslatePane, { attachTo: document.body })
  await flushPromises()
  // 没有谷歌 / 谷歌云 / 有道可选了
  expect(w.find('[aria-label="翻译服务"]').exists()).toBe(false)
  expect(w.text()).not.toMatch(/谷歌|有道/)
  // 输入栏与阅读助手同一套：输入框 + 底部一行（翻译模式开关、预设按钮、发送）
  const actions = w.find('.composer-field .composer-actions')
  expect(actions.exists()).toBe(true)
  expect([...actions.element.children].map(node => node.classList[0])).toEqual(['tp-mode', 'composer-space', 'tp-picker-host', 'send-button'])
  expect(w.find('.composer-field textarea').attributes('placeholder')).toBe('输入文字，回车翻译')
  const chip = w.find('[aria-label="翻译用的模型预设"]')
  // 预设的强度是「模型默认」：照原样，不再换成最低一档，也不写强度
  expect(chip.find('.tp-picker-model').text()).toBe('快译 · DeepSeek Flash')
  expect(chip.find('.tp-picker-effort').exists()).toBe(false)
  // 抽屉第一次拉开前不挂载
  expect(w.find('[aria-label="模型预设"]').exists()).toBe(false)
  await chip.trigger('click')
  expect(chip.attributes('aria-expanded')).toBe('true')
  expect(w.find('.composer-drawer').classes()).toContain('open')
  const radios = w.find('[aria-label="模型预设"]').findAll('[role="radio"]')
  expect(radios.map(r => r.text())).toEqual(['GPT-5.4', '快译'])
  await radios[0].trigger('click')
  await flushPromises()
  const stored = JSON.parse(localStorage.getItem('paperdesk.ai.settings.v1')!)
  expect([stored.translationPreset, stored.assistantPreset, stored.provider]).toEqual(['a', 'a', 'openai'])
  expect(w.find('.tp-picker-model').text()).toBe('OpenAI API · GPT-5.4')
  expect(w.find('.tp-picker-effort').text()).toBe('高')
  // Esc 先收起抽屉（抽屉保持挂载，收起有动画），翻译栏不关
  await w.find('.composer-field textarea').trigger('keydown', { key: 'Escape' })
  expect(w.find('.composer-drawer').classes()).not.toContain('open')
  expect(w.emitted('close')).toBeUndefined()
  await w.find('.composer-field textarea').trigger('keydown', { key: 'Escape' })
  expect(w.emitted('close')).toHaveLength(1)
  await chip.trigger('click')
  await w.find('[aria-label="管理模型预设"]').trigger('click')
  expect(w.emitted('settings')).toHaveLength(1)
  w.unmount()
})

it('翻译栏：翻译模式开关在「文档上下文」的位置，点一下切换', async () => {
  const TranslatePane = (await import('../../src/components/TranslatePane.vue')).default
  const { translator } = await import('../../src/ai/translate')
  translator.auto = false
  const w = mount(TranslatePane, { attachTo: document.body })
  await flushPromises()
  const toggle = w.find('.tp-mode')
  const input = toggle.find('input[role="switch"]')
  expect(input.attributes('aria-label')).toBe('翻译模式')
  expect(toggle.text()).toBe('翻译模式')
  expect(toggle.classes()).not.toContain('on')
  await input.setValue(true)
  expect(translator.auto).toBe(true)
  expect(toggle.classes()).toContain('on')
  // 发送按钮：空输入时禁用，有字就可点
  const send = w.find('.send-button')
  expect(send.attributes('disabled')).toBeDefined()
  await w.find('.composer-field textarea').setValue('hello')
  expect(send.attributes('disabled')).toBeUndefined()
  translator.auto = false
  w.unmount()
})

it('翻译与快速解释照用预设的模型和思考强度，不降级', async () => {
  localStorage.setItem('paperdesk.ai.settings.v1', JSON.stringify({ presetsVersion: 2, presets: [
    { id: 'p-pro', name: '', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', protocol: 'chat', model: 'deepseek-v4-pro', effort: '', fast: false },
    { id: 'p-max', name: '', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', protocol: 'chat', model: 'deepseek-flash', effort: 'max', fast: false },
  ], assistantPreset: 'p-pro', translationPreset: 'p-pro', explainPreset: 'p-max' }))
  const { loadAiSettings, saveAiSettings } = await import('../../src/ai/settings.mjs')
  await saveAiSettings(loadAiSettings(), { deepseek: 'sk-sim' })
  const bodies: any[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (_url: any, init: any) => {
    bodies.push(JSON.parse(init.body))
    const encoder = new TextEncoder()
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'))
      controller.close()
    } })
    return { ok: true, status: 200, body, text: async () => '' }
  }) as any
  try {
    const { complete } = await import('../../src/ai/complete')
    const signal = new AbortController().signal
    expect(await complete({ kind: 'translate', messages: [{ role: 'user', content: 'hello' }], signal })).toBe('好')
    await complete({ kind: 'explain', messages: [{ role: 'user', content: 'term' }], signal })
  } finally { globalThis.fetch = realFetch }
  // 翻译：预设是 V4 Pro、强度「模型默认」→ 原样发 V4 Pro，不带任何思考参数（以前会换成最低一档「不思考」）
  expect(bodies[0].model).toBe('deepseek-v4-pro')
  expect([bodies[0].thinking, bodies[0].reasoning_effort]).toEqual([undefined, undefined])
  // 快速解释：预设强度「最高」→ 照发最高
  expect([bodies[1].model, bodies[1].reasoning_effort, bodies[1].thinking]).toEqual(['deepseek-flash', 'max', { type: 'enabled' }])
})
