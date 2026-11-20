// @vitest-environment happy-dom
// 组件模拟测试（不在 npm test 里，依赖不写进 package.json）。在 frontend/ 下运行：
//   npm i --no-save vitest@3 @vue/test-utils happy-dom
//   $env:NODE_OPTIONS="--no-experimental-webstorage"  # Node 26: use the DOM test environment
//   npx vitest run tests/sim
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AiSettings from '../../src/components/settings/AiSettings.vue'
import ModelPicker from '../../src/components/assistant/ModelPicker.vue'

const KEY = 'paperdesk.ai.settings.v1'
const stored = () => JSON.parse(localStorage.getItem(KEY) || '{}')
const rows = (w: any) => w.findAll('.preset-row')
const byLabel = (w: any, label: string) => w.find(`[aria-label="${label}"]`)
const val = (w: any, label: string) => (byLabel(w, label).element as HTMLInputElement).value
const button = (w: any, text: string) => w.findAll('button').find((b: any) => b.text() === text)
const formOpen = (w: any) => w.find('.preset-form').exists() && (w.find('dialog.preset-dialog').element as HTMLDialogElement).hasAttribute('open')
const settle = async () => { for (let i = 0; i < 6; i++) { await flushPromises(); await new Promise(r => setTimeout(r, 5)) } }
// 两个用户自己建的预设（以前的版本会自动生成类似的两个，现在不再自带）。
const SEED = { presetsVersion: 2, presets: [
  { id: 'p-main', name: '', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', protocol: 'chat', model: 'deepseek-flash', effort: 'high', fast: false },
  { id: 'p-fast', name: '翻译', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', protocol: 'chat', model: 'deepseek-flash', effort: 'none', fast: false },
], assistantPreset: 'p-main', translationPreset: 'p-fast', explainPreset: 'p-fast' }
const seed = () => localStorage.setItem(KEY, JSON.stringify(SEED))
// Simulate only the desktop RPC. Protocol bytes and real credential storage are tested in Python.
const keys = new Map<string,string>()
const calls: any[] = []
let respond: (request:any)=>any
vi.mock('../../src/sdk/python', async (original) => ({ ...await original<typeof import('../../src/sdk/python')>(),
  invoke: async (cmd:string, a:any={}) => {
    const slot = `${a.provider}|${a.baseUrl}`
    if (cmd === 'ai_set_key') { if ('key' in a) keys.set(slot,a.key); return }
    if (cmd === 'ai_has_key') return keys.has(slot)
    if (cmd === 'ai_start') {
      if (!a.request.apiKey && !keys.has(`${a.request.provider}|${a.request.baseUrl}`)) throw Error('请在 AI 设置中填写 API Key')
      calls.push(a.request)
      setTimeout(()=>{ try { a.channel.onmessage({type:'end',value:respond(a.request)}) } catch (error:any) { a.channel.onmessage({type:'error',message:error.message}) } },5)
    }
  },
}))
beforeEach(()=>{localStorage.clear();keys.clear();calls.length=0;respond=()=>({});vi.stubGlobal('__KAIZHI_PYTHON__',true)})
afterEach(()=>vi.unstubAllGlobals())
describe('设置 → AI：模型预设（弹出窗口）', () => {
  it('没有预设时列表是空的、不自带预设；新建的第一个预设三处都先用它', async () => {
    const w = mount(AiSettings, { props: { embedded: true }, attachTo: document.body })
    await flushPromises()
    expect(rows(w)).toHaveLength(0)
    expect(w.find('.preset-empty').text()).toContain('还没有模型预设')
    expect(byLabel(w, '阅读助手用的预设').exists()).toBe(false)
    await button(w, '＋ 新建预设').trigger('click'); await flushPromises()
    expect(w.find('.form-title').text()).toBe('新建预设')
    expect([val(w, '服务商'), val(w, '模型')]).toEqual(['deepseek', 'deepseek-flash'])
    await byLabel(w, '服务商').setValue('kimi')
    await byLabel(w, 'API Key').setValue('kimi-first')
    await button(w, '添加').trigger('submit'); await flushPromises()
    expect(rows(w)).toHaveLength(1)
    expect(rows(w)[0].attributes('data-uses')).toBe('assistant translate explain memory')
    expect(w.find('.settings-status').text()).toContain('阅读助手、翻译、快速解释和记忆管理先都用它')
    expect(await (w.vm as any).save()).toBeTruthy()
    const id = stored().presets[0].id
    expect(id).toMatch(/^p-/)
    expect([stored().assistantPreset, stored().translationPreset, stored().explainPreset, stored().memoryPreset, stored().provider, stored().presetsVersion]).toEqual([id, id, id, id, 'kimi', 2])
    expect(keys.get('kimi|https://api.moonshot.cn/v1')).toBe('kimi-first')
    w.unmount()
  })

  it('以前自动生成的预设（assistant / translation / explain）打开设置时已经不在了', async () => {
    localStorage.setItem(KEY, JSON.stringify({ provider: 'deepseek', model: 'deepseek-v4-pro', effort: 'max', presets: [
      { id: 'assistant', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro', effort: 'max' },
      { id: 'translation', name: '翻译', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', effort: 'none' },
      { id: 'explain', name: '快速解释', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', effort: 'none' },
    ], assistantPreset: 'assistant', translationPreset: 'translation', explainPreset: 'explain' }))
    const w = mount(AiSettings, { props: { embedded: true }, attachTo: document.body })
    await flushPromises()
    expect(rows(w)).toHaveLength(0)
    expect(w.find('.preset-empty').exists()).toBe(true)
    w.unmount()
  })

  it('列表每行右边是「编辑预设」「测试连接」「删除预设」；点编辑弹出编辑窗口，取消不改动', async () => {
    seed()
    const w = mount(AiSettings, { props: { embedded: true }, attachTo: document.body })
    await flushPromises()
    expect(rows(w).map((r: any) => r.find('.preset-title').text())).toEqual(['DeepSeek Flash', '翻译'])
    expect(w.findAll('.preset-item').map((item: any) => item.findAll('button').slice(1).map((b: any) => b.text()))).toEqual([['编辑预设', '测试连接', '删除预设'], ['编辑预设', '测试连接', '删除预设']])
    expect(rows(w).map((r: any) => r.attributes('data-uses'))).toEqual(['assistant memory', 'translate explain'])
    expect(formOpen(w)).toBe(false)
    await w.findAll('.preset-edit')[1].trigger('click'); await flushPromises()
    expect(formOpen(w)).toBe(true)
    expect(w.find('.form-title').text()).toBe('编辑「翻译」')
    expect(w.find('dialog.preset-dialog').attributes('aria-label')).toBe('编辑预设')
    expect([val(w, '服务商'), val(w, '模型')]).toEqual(['deepseek', 'deepseek-flash'])
    expect(byLabel(w, '思考强度').exists()).toBe(false) // 预设里不设思考强度
    await byLabel(w, '模型').setValue('deepseek-v4-pro')
    await button(w, '取消').trigger('click'); await flushPromises()
    expect(formOpen(w)).toBe(false)
    expect(rows(w)[1].find('.preset-detail').text()).toContain('DeepSeek Flash')
    expect((w.vm as any).hasChanges()).toBe(false)
    w.unmount()
  })

  it('新建预设弹出空白窗口；取消丢弃，添加才进入列表；密钥随整页保存', async () => {
    seed()
    const w = mount(AiSettings, { props: { embedded: true }, attachTo: document.body })
    await flushPromises()
    await button(w, '＋ 新建预设').trigger('click'); await flushPromises()
    expect(formOpen(w)).toBe(true)
    expect(w.find('.form-title').text()).toBe('新建预设')
    expect([val(w, '预设名称'), val(w, '服务商'), val(w, '模型')]).toEqual(['', 'deepseek', 'deepseek-flash'])
    await button(w, '取消').trigger('click'); await flushPromises()
    expect(rows(w)).toHaveLength(2)
    await button(w, '＋ 新建预设').trigger('click'); await flushPromises()
    await byLabel(w, '服务商').setValue('kimi')
    await byLabel(w, '预设名称').setValue('月之暗面')
    await byLabel(w, 'API Key').setValue('kimi-key')
    await button(w, '添加').trigger('submit'); await flushPromises()
    expect(formOpen(w)).toBe(false)
    expect(rows(w).map((r: any) => r.find('.preset-title').text())).toEqual(['DeepSeek Flash', '翻译', '月之暗面'])
    expect(w.find('.settings-status').text()).toContain('已添加「月之暗面」')
    const id = (byLabel(w, '翻译用的预设').findAll('option')[2].element as HTMLOptionElement).value
    await byLabel(w, '翻译用的预设').setValue(id)
    expect(await (w.vm as any).save()).toBeTruthy()
    expect(stored().presets[2]).toMatchObject({ id, name: '月之暗面', provider: 'kimi' })
    expect(stored().translationPreset).toBe(id)
    expect(keys.get('kimi|https://api.moonshot.cn/v1')).toBe('kimi-key')
    w.unmount()
  })

  it('修改阅读助手的预设：确定后写回，保存后顶层一致；取消的密钥不会被保存', async () => {
    seed()
    const w = mount(AiSettings, { props: { embedded: true }, attachTo: document.body })
    await flushPromises()
    await w.find('.preset-row[data-uses~="assistant"]').trigger('click'); await flushPromises()
    await byLabel(w, 'API Key').setValue('should-not-save')
    await button(w, '取消').trigger('click'); await flushPromises()
    await w.find('.preset-row[data-uses~="assistant"]').trigger('click'); await flushPromises()
    expect(val(w, 'API Key')).toBe('')
    await byLabel(w, '服务商').setValue('openai')
    expect([val(w, 'API 地址'), val(w, '模型')]).toEqual(['https://api.openai.com/v1', 'gpt-5.4-mini'])
    await byLabel(w, 'API Key').setValue('sk-openai-test')
    await button(w, '确定').trigger('submit'); await flushPromises()
    expect(formOpen(w)).toBe(false)
    expect(await (w.vm as any).save()).toBeTruthy()
    expect([stored().provider, stored().presets[0].provider]).toEqual(['openai', 'openai'])
    expect(keys.get('openai|https://api.openai.com/v1')).toBe('sk-openai-test')
    expect(keys.has('deepseek|https://api.deepseek.com')).toBe(false)
    w.unmount()
  })

  it('窗口里填得不对：提示留在窗口里，不关闭；Esc 只关预设窗口', async () => {
    seed()
    const outer: string[] = []
    const w = mount(AiSettings, { props: { embedded: true }, attachTo: document.body })
    document.body.addEventListener('keydown', event => outer.push(event.key))
    await flushPromises()
    await button(w, '＋ 新建预设').trigger('click'); await flushPromises()
    await byLabel(w, '服务商').setValue('custom')
    await button(w, '添加').trigger('submit'); await flushPromises()
    expect(formOpen(w)).toBe(true)
    expect(w.find('.preset-form .settings-status').classes()).toContain('error')
    expect(w.findAll('.settings-status')).toHaveLength(1)
    expect(await (w.vm as any).save()).toBeNull()
    expect(formOpen(w)).toBe(true)
    await w.find('dialog.preset-dialog').trigger('keydown', { key: 'Escape' }); await flushPromises()
    expect(formOpen(w)).toBe(false)
    expect(outer).not.toContain('Escape')
    expect(rows(w)).toHaveLength(2)
    w.unmount()
  })

  it('删除正在用的预设：用到它的地方改用前一个；可以删到一个不剩', async () => {
    seed()
    const w = mount(AiSettings, { props: { embedded: true }, attachTo: document.body })
    await flushPromises()
    await w.findAll('.preset-delete')[1].trigger('click')
    expect(rows(w)).toHaveLength(1)
    expect(w.find('.settings-status').text()).toContain('翻译、快速解释改用「DeepSeek Flash」')
    expect((w.find('.preset-delete').element as HTMLButtonElement).disabled).toBe(false)
    await w.find('.preset-delete').trigger('click')
    expect(rows(w)).toHaveLength(0)
    expect(w.find('.preset-empty').exists()).toBe(true)
    expect(w.find('.settings-status').text()).toContain('现在没有模型预设了')
    expect(await (w.vm as any).save()).toBeTruthy()
    expect([stored().presets, stored().assistantPreset, stored().translationPreset, stored().explainPreset, stored().memoryPreset]).toEqual([[], '', '', '', ''])
    w.unmount()
  })
})

describe('设置 → AI：测试连接与获取模型列表', () => {
  it('测试连接：用预设（含还没保存的密钥）发一句极短的消息，等待 Harness 完成；失败写明原因', async () => {
    seed()
    const w = mount(AiSettings, { props: { embedded: true }, attachTo: document.body })
    await flushPromises()
    await rows(w)[0].trigger('click'); await flushPromises()
    await byLabel(w, 'API Key').setValue('sk-draft')
    await button(w, '确定').trigger('submit'); await flushPromises()
    const test = () => w.findAll('.preset-test')[0]
    await test().trigger('click')
    expect(test().text()).toBe('测试中…')
    await settle()
    expect(w.find('.preset-test-result').classes()).toContain('ok')
    expect(w.find('.preset-test-result').text()).toMatch(/^连接正常 · DeepSeek Harness · 用时 /)
    expect(calls[0]).toMatchObject({kind:'ping',baseUrl:'https://api.deepseek.com',apiKey:'sk-draft',model:'deepseek-flash',effort:'high'})
    respond=()=>{throw Error('HTTP 401: invalid key [redacted]')}
    await w.findAll('.preset-test')[1].trigger('click'); await settle()
    const failed = w.findAll('.preset-test-result')[1]
    expect(failed.classes()).toContain('fail')
    expect(failed.text()).toBe('连接失败：HTTP 401: invalid key [redacted]')
    // 改了预设，原来的结果不再作数。
    await rows(w)[0].trigger('click'); await flushPromises()
    await button(w, '确定').trigger('submit'); await flushPromises()
    expect(w.findAll('.preset-test-result')).toHaveLength(1)
    w.unmount()
  })

  it('获取模型列表：模型框右边的按钮读出服务商的模型，框下展开可搜索的列表，点一个填入', async () => {
    seed()
    const ids = ['deepseek-chat', 'deepseek-reasoner', 'deepseek-flash', 'deepseek-v4-pro', 'deepseek-coder', 'text-embedding-x', ...Array.from({ length: 6 }, (_, i) => `ds-extra-${i}`)]
    respond=()=>({models:ids.map(id=>({id})),hidden:0})
    const w = mount(AiSettings, { props: { embedded: true }, attachTo: document.body })
    await flushPromises()
    await button(w, '＋ 新建预设').trigger('click'); await flushPromises()
    const fetchButton = () => w.find('.fetch-models')
    expect(fetchButton().text()).toBe('获取模型列表')
    // 没填密钥：提示在模型框下面，窗口不关
    await fetchButton().trigger('click'); await settle()
    expect(w.find('.list-status').text()).toContain('API Key')
    expect(calls).toHaveLength(0)
    await byLabel(w, 'API Key').setValue('sk-list')
    await fetchButton().trigger('click'); await settle()
    expect(calls[0]).toMatchObject({kind:'models',apiKey:'sk-list'})
    expect(w.find('.model-pick').exists()).toBe(true)
    expect(w.find('.model-pick-head').text()).toContain('读到 11 个模型（略去 1 个向量、语音等非对话模型）')
    const options = () => w.findAll('.model-options [role="option"]')
    expect(options().find((o: any) => o.attributes('aria-selected') === 'true')?.text()).toContain('deepseek-flash')
    // 读到的模型也进了输入框的建议列表
    expect(w.findAll('#ai-model-list option').map((o: any) => o.attributes('value'))).toContain('deepseek-reasoner')
    await byLabel(w, '搜索模型').setValue('reason')
    expect(options().map((o: any) => o.text())).toEqual(['deepseek-reasoner'])
    await byLabel(w, '搜索模型').trigger('keydown', { key: 'Enter' }); await flushPromises()
    expect(val(w, '模型')).toBe('deepseek-reasoner')
    expect(w.find('.model-pick').exists()).toBe(false)
    expect(formOpen(w)).toBe(true)
    // 再读一次，列表里按 Esc 只收起列表，不关窗口
    await fetchButton().trigger('click'); await settle()
    await options()[3].trigger('keydown', { key: 'Escape' }); await flushPromises()
    expect(w.find('.model-pick').exists()).toBe(false)
    expect(formOpen(w)).toBe(true)
    // 读不到列表：说明原因
    respond=()=>{throw Error('HTTP 404 Not Found')}
    await fetchButton().trigger('click'); await settle()
    expect(w.find('.list-status').classes()).toContain('error')
    expect(w.find('.list-status').text()).toContain('HTTP 404')
    w.unmount()
  })
})

describe('没有预设时的阅读助手输入栏与翻译栏', () => {
  it('模型按钮写「未设置模型」，点了直接打开设置，不拉开抽屉', async () => {
    const AiPane = (await import('../../src/components/assistant/AiPane.vue')).default
    const w = mount(AiPane, { attachTo: document.body, props: { document: { id: 'doc-empty', title: '示例.pdf', kind: 'pdf' }, context: { page: 1, selection: {} } } })
    await flushPromises()
    expect(w.find('.model-picker').text()).toContain('未设置模型')
    await w.find('.model-picker').trigger('click'); await flushPromises()
    expect(w.emitted('settings')).toHaveLength(1)
    expect(w.find('.model-drawer').exists()).toBe(false)
    w.unmount()
  })
  it('翻译栏的 AI 标签写「未设置模型预设」，点了打开设置', async () => {
    const TranslatePane = (await import('../../src/components/translate/TranslatePane.vue')).default
    const w = mount(TranslatePane, { attachTo: document.body })
    await flushPromises()
    const chip = w.find('[aria-label="翻译用的模型预设"]')
    expect(chip.text()).toContain('未设置模型预设')
    await chip.trigger('click')
    expect(w.emitted('settings')).toHaveLength(1)
    expect(w.find('[aria-label="模型预设"]').exists()).toBe(false)
    w.unmount()
  })
})

describe('输入栏 / 翻译栏的预设抽屉', () => {
  const models = [{ id: 'm1', name: 'M1', efforts: ['low', 'high'] }]
  const presets = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', detail: 'Kimi · 模型默认' }]
  it('两个以上预设时多一行单选；模型胶囊仍只有一行', async () => {
    const w = mount(ModelPicker, { props: { model: 'm1', effort: 'low', models, presets, preset: 'a' } })
    expect(w.findAll('.model-chips')).toHaveLength(1)
    const radios = w.find('[aria-label="模型预设"]').findAll('[role="radio"]')
    await radios[1].trigger('click')
    expect(w.emitted('preset')).toEqual([['b']])
  })
  it('预设超出可视宽度时把竖向滚轮转为横滚，不拦截原生横滚或边界滚动', () => {
    const w = mount(ModelPicker, { props: { model: 'm1', effort: '', models, presets, preset: 'a' } })
    const strip = w.get('[aria-label="模型预设"]').element as HTMLElement
    Object.defineProperties(strip, { clientWidth: { value: 100 }, scrollWidth: { value: 300 } })
    const scroll = vi.spyOn(strip, 'scrollBy').mockImplementation(() => {})
    const wheel = (deltaX: number, deltaY: number) => strip.dispatchEvent(new WheelEvent('wheel', { deltaX, deltaY, cancelable: true }))
    expect(wheel(0, 40)).toBe(false)
    expect(scroll).toHaveBeenCalledWith({ left: 40, behavior: 'instant' })
    expect(wheel(40, 0)).toBe(true)
    strip.scrollLeft = 200
    expect(wheel(0, 40)).toBe(true)
    expect(scroll).toHaveBeenCalledTimes(1)
    w.unmount()
  })
})
