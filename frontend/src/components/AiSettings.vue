<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { PROVIDERS, PROTOCOLS, getProvider, getNativeModels, getNativeStatus } from '../ai/providers.mjs'
import { nativeModelInventory, registerNativeModelInventory } from '../ai/native-models'
import { loadAiSettings, loadApiKey, saveAiSettings, supportsFast, newPresetId, presetConnection, MAX_PRESETS, PRESET_NAME_LIMIT } from '../ai/settings.mjs'
import { listModels, testConnection } from '../ai/connection.mjs'
import { presetTitle, presetDetail, type Preset } from '../ai/presets'
import { DOCUMENT_LIMIT_FIELDS } from '../../../extension/src/common/document-limits.mjs'
import { apiOrigin } from '../../../extension/src/common/settings.js'
import { normalizeRequestLimits } from '../../../extension/src/common/request-queue.mjs'

withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })
const emit = defineEmits<{ saved: [value: any]; close: [] }>()
const tauri = Boolean((globalThis as any).__TAURI_INTERNALS__)
const settings = ref<any>(loadAiSettings())
let rememberedAtLoad = Boolean(settings.value.rememberKey)
const status = ref('')
const error = ref(false)
const saving = ref(false)
const refreshing = ref(false)
const edited = ref(false)
function markEdited() { edited.value = true }
const nativeModels = nativeModelInventory
const requestFields = [
  { key: 'concurrent', label: '同时运行的提问', min: 1, max: 4 },
  { key: 'codex', label: '其中 Codex 同时运行数', min: 1, max: 2 },
  { key: 'queued', label: '最多等待的提问', min: 0, max: 16 },
]
// 三处用途各选一个预设。
const TASKS = [
  { field: 'assistantPreset', key: 'assistant', label: '阅读助手', aria: '阅读助手用的预设' },
  { field: 'translationPreset', key: 'translate', label: '翻译', aria: '翻译用的预设' },
  { field: 'explainPreset', key: 'explain', label: '快速解释', aria: '快速解释用的预设' },
] as const
/** 列表行上记着哪些用途在用它（不显示，供脚本定位，例如 [data-uses~="assistant"]）。 */
const usesOf = (id: string) => TASKS.filter(task => settings.value[task.field] === id).map(task => task.key).join(' ')

// ---- 预设列表 ----
const presets = computed<Preset[]>(() => settings.value.presets)
// 以前的版本留下的预设可能没写模型：填上该服务商的默认模型（思考强度不动，在输入栏里选）。
for (const preset of presets.value) {
  if (preset.model || preset.provider === 'codex') continue
  const known: any = getProvider(preset.provider)
  if (known?.defaultModel) preset.model = known.defaultModel
}

// ---- 弹出的预设窗口：新建与修改共用；改的是一份副本，点「添加 / 确定」才写回列表，「取消」就丢弃 ----
type PresetForm = { preset: Preset; isNew: boolean }
const form = ref<PresetForm | null>(null)
const formDialog = ref<HTMLDialogElement>()
const current = computed<Preset | undefined>(() => form.value?.preset)
const provider = computed<any>(() => current.value && getProvider(current.value.provider))

// ---- 获取模型列表：从服务商读到的模型按「服务商 + 协议 + 地址」记下，这次打开设置期间一直可选 ----
type ListedModel = { id: string; name?: string }
type Listed = { models: ListedModel[]; hidden: number }
const listedModels = reactive(new Map<string, Listed>())
const listKey = (preset: Preset) => [preset.provider, preset.protocol, preset.baseUrl.trim().replace(/\/+$/, '')].join('|')
const listed = computed<Listed | undefined>(() => current.value ? listedModels.get(listKey(current.value)) : undefined)
const models = computed<any[]>(() => {
  if (!current.value) return []
  if (current.value.provider === 'codex') return nativeModels.value
  const builtIn: any[] = provider.value?.models || []
  return [...builtIn, ...(listed.value?.models || []).filter(item => !builtIn.some(known => known.id === item.id))]
})
const model = computed<any>(() => models.value.find(item => item.id === current.value?.model))
const hasStoredModel = computed(() => Boolean(current.value?.model) && !models.value.some(item => item.id === current.value?.model))
// 预设里不设思考强度：用的时候在输入栏的模型按钮里选（选过的会记在当前这个预设上）。
const autoTitle = computed(() => current.value ? presetTitle({ ...current.value, name: '' }) : '')

// ---- API Key：按服务商存，同一服务商的预设共用；保存时只写改动过的 ----
const keyDrafts = reactive<Record<string, string>>({})
const keyOriginal: Record<string, string | undefined> = {}
const keyLoading = ref(0)
const keyRequests = new Map<string, Promise<void>>()
let disposed = false
/** 读出某个服务商已存的密钥（每个服务商只读一次；同时来的几处等同一次读取）。 */
function ensureKey(id: string): Promise<void> {
  if (!id || id === 'codex') return Promise.resolve()
  let pending = keyRequests.get(id)
  if (!pending) { pending = readKey(id); keyRequests.set(id, pending) }
  return pending
}
async function readKey(id: string) {
  keyOriginal[id] = undefined
  keyLoading.value++
  try {
    const value = (await loadApiKey(id)) || ''
    if (disposed) return
    keyOriginal[id] = value
    if (!(id in keyDrafts)) keyDrafts[id] = value
  } catch (cause: any) { delete keyOriginal[id]; keyRequests.delete(id); status.value = cause?.message || String(cause); error.value = true }
  finally { keyLoading.value-- }
}
for (const preset of presets.value) void ensureKey(preset.provider)
// 窗口里的密钥也是副本：没改过就跟着所选服务商显示已存的那把，改过的在「确定」时才记下。
const formKey = ref('')
const formKeyTouched = ref(false)
const key = computed({ get: () => formKey.value, set: (value: string) => { formKey.value = value; formKeyTouched.value = true } })
const sharers = computed(() => { const preset = current.value; return preset ? presets.value.filter(item => item.id !== preset.id && item.provider === preset.provider) : [] })
async function showStoredKey() {
  const id = current.value?.provider
  formKeyTouched.value = false
  formKey.value = id && id in keyDrafts ? keyDrafts[id]! : ''
  if (!id || id === 'codex' || id in keyDrafts) return
  await ensureKey(id)
  if (current.value?.provider === id && !formKeyTouched.value) formKey.value = keyDrafts[id] ?? ''
}

// ---- Codex：检查登录并读取本机模型 ----
let modelRequest: AbortController | undefined
const CHECKING = '正在检查本机 Codex…'
async function refreshNative() {
  if (refreshing.value || disposed) return
  const request = new AbortController()
  modelRequest = request
  refreshing.value = true; error.value = false; status.value = CHECKING
  try {
    const info: any = await getNativeStatus(request.signal)
    if (!info.compatible || !info.loggedIn) throw new Error(info.diagnostic || (info.loggedIn === false ? 'Codex 尚未登录。请先在 Codex 中登录。' : '未找到可用 Codex。'))
    const list: any[] = await getNativeModels(request.signal)
    if (disposed || request.signal.aborted) return
    registerNativeModelInventory(list)
    const preset = current.value
    if (preset?.provider === 'codex') {
      if (!preset.model && list.length) preset.model = list[0].id
      status.value = `Codex ${info.version} · 已登录 · ${list.length} 个模型`
    } else if (status.value === CHECKING) status.value = ''
  } catch (cause: any) {
    if (disposed || request.signal.aborted) return
    if (current.value?.provider === 'codex') { status.value = cause?.message || String(cause); error.value = true }
    else if (status.value === CHECKING) status.value = ''
  } finally { if (modelRequest === request) { modelRequest = undefined; refreshing.value = false } }
}
if (tauri && !nativeModels.value.length && presets.value.some(item => item.provider === 'codex')) void refreshNative()

// ---- 模型框右边的「获取模型列表」：向服务商要模型列表，框下展开一个可搜索的列表，点一个填入 ----
const listOpen = ref(false)
const listQuery = ref('')
const listStatus = ref('')
const listError = ref(false)
const listing = ref(false)
const modelInput = ref<HTMLInputElement>()
const modelOptions = ref<HTMLElement>()
let listRequest: AbortController | undefined
const listShown = computed<ListedModel[]>(() => {
  const all = listed.value?.models || []
  const query = listQuery.value.trim().toLowerCase()
  return query ? all.filter(item => item.id.toLowerCase().includes(query) || Boolean(item.name?.toLowerCase().includes(query))) : all
})
function resetList() { listRequest?.abort(); listRequest = undefined; listing.value = false; listOpen.value = false; listQuery.value = ''; listStatus.value = ''; listError.value = false }
// 换了服务商、协议或地址：原来那份列表不再对应，收起。
watch(() => current.value && listKey(current.value), (now, before) => { if (now && before && now !== before) resetList() })
async function fetchModels() {
  const preset = current.value
  if (!preset || listing.value) return
  // Codex：检查本机登录并读取模型，模型框（下拉）里直接就是完整列表。
  if (preset.provider === 'codex') { await refreshNative(); return }
  listRequest?.abort()
  const request = new AbortController()
  listRequest = request
  listing.value = true; listError.value = false; listOpen.value = false; listStatus.value = '正在读取模型列表…'
  try {
    if (!formKeyTouched.value) await showStoredKey()
    const result: Listed = await listModels({ provider: preset.provider, protocol: preset.protocol, baseUrl: preset.baseUrl, apiKey: formKey.value.trim(), signal: request.signal })
    if (disposed || request.signal.aborted || current.value !== preset) return
    listedModels.set(listKey(preset), result)
    const skipped = result.hidden ? `（略去 ${result.hidden} 个向量、语音等非对话模型）` : ''
    if (result.models.length) {
      listQuery.value = ''
      listOpen.value = true
      listStatus.value = `读到 ${result.models.length} 个模型${skipped}，点一个填入。`
      // 列表在窗口靠下的地方展开：整块滚进视野，再把当前选中的模型滚到眼前。
      void nextTick(() => { modelOptions.value?.parentElement?.scrollIntoView({ block: 'nearest' }); modelOptions.value?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) })
    } else {
      listStatus.value = result.hidden ? `只读到 ${result.hidden} 个向量、语音等非对话模型，请直接填写模型名称。` : '服务没有返回任何模型，请直接填写模型名称。'
      listError.value = true
    }
  } catch (cause: any) {
    if (disposed || request.signal.aborted) return
    listStatus.value = cause?.message || String(cause); listError.value = true
  } finally { if (listRequest === request) { listRequest = undefined; listing.value = false } }
}
function pickModel(id: string) {
  if (!current.value) return
  current.value.model = id
  resetList()
  void nextTick(() => modelInput.value?.focus())
}
function closeList() { resetList(); void nextTick(() => modelInput.value?.focus()) }
/** 列表里：上下键在模型之间移动，Home / End 到头尾。 */
function optionKey(event: KeyboardEvent) {
  const buttons = [...(modelOptions.value?.querySelectorAll<HTMLButtonElement>('[role="option"]') || [])]
  if (!buttons.length) return
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next = event.key === 'ArrowDown' ? at + 1 : event.key === 'ArrowUp' ? at - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null
  if (next === null) return
  event.preventDefault()
  if (next < 0) { modelOptions.value?.parentElement?.querySelector<HTMLInputElement>('.model-search')?.focus(); return }
  buttons[Math.min(buttons.length - 1, next)]?.focus()
}
/** 搜索框里：回车直接选第一个匹配的（不提交整个窗口），下键进入列表。 */
function searchKey(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'Enter') { event.preventDefault(); if (listShown.value[0]) pickModel(listShown.value[0].id) }
  else if (event.key === 'ArrowDown') { event.preventDefault(); modelOptions.value?.querySelector<HTMLElement>('[role="option"]')?.focus() }
}

// ---- 列表每一行的「测试连接」：用这个预设（含窗口里改过、还没保存的内容和密钥）发一句极短的消息 ----
type TestResult = { state: 'testing' | 'ok' | 'fail'; message: string }
const tests = reactive<Record<string, TestResult>>({})
const testRequests = new Map<string, AbortController>()
const seconds = (ms: number) => ms < 1000 ? `${Math.max(1, Math.round(ms))} 毫秒` : `${(ms / 1000).toFixed(1)} 秒`
function forgetTest(id: string) { testRequests.get(id)?.abort(); testRequests.delete(id); delete tests[id] }
async function testPreset(preset: Preset) {
  forgetTest(preset.id)
  const request = new AbortController()
  testRequests.set(preset.id, request)
  tests[preset.id] = { state: 'testing', message: '' }
  try {
    check(preset, false)
    await ensureKey(preset.provider)
    const result: any = await testConnection({ ...preset }, preset.provider === 'codex' ? '' : (keyDrafts[preset.provider] || '').trim(), request.signal)
    if (disposed || request.signal.aborted) return
    tests[preset.id] = { state: 'ok', message: ['连接正常', result.note, `用时 ${seconds(result.ms)}`].filter(Boolean).join(' · ') }
  } catch (cause: any) {
    if (disposed || request.signal.aborted) return
    tests[preset.id] = { state: 'fail', message: '连接失败：' + (cause?.message || String(cause)) }
  } finally { if (testRequests.get(preset.id) === request) testRequests.delete(preset.id) }
}
onBeforeUnmount(() => { disposed = true; modelRequest?.abort(); listRequest?.abort(); for (const request of testRequests.values()) request.abort() })

// 在窗口里换了服务商：地址、模型换成新服务商的默认值，思考强度回到「模型默认」（用的时候在输入栏里选），密钥换成这家服务商已存的那把。
function providerChanged() {
  const preset = current.value
  if (!preset) return
  const next: any = getProvider(preset.provider)
  preset.baseUrl = next?.baseUrl || ''
  preset.model = next?.defaultModel || next?.models[0]?.id || ''
  preset.effort = ''
  if (next?.custom) preset.protocol ||= 'chat'
  if (!supportsFast(preset.provider)) preset.fast = false
  void showStoredKey()
  if (preset.provider === 'codex' && !nativeModels.value.length && tauri) void refreshNative()
}
// 同一个预设里换了模型（或 Codex 的模型列表刚读到）：输入栏里选过的强度这个模型不支持时，回到「模型默认」。刚打开窗口不算。
watch([() => current.value?.id, model], ([id, value], [previousId]) => {
  const preset = current.value
  if (preset && id === previousId && preset.effort && value?.efforts && !value.efforts.includes(preset.effort)) preset.effort = ''
})

/** 新预设的初始值：沿用阅读助手所用的服务商（多半已经填过密钥；还没有预设时用上次的连接设置），模型取该服务商的默认；思考强度不在预设里设。 */
function freshPreset(): Preset {
  const base: any = presets.value.find(item => item.id === settings.value.assistantPreset) || presets.value[0] || settings.value
  const id = getProvider(base.provider) ? base.provider : 'deepseek'
  const known: any = getProvider(id)
  const list: any[] = id === 'codex' ? nativeModels.value : known?.models || []
  const model = known?.defaultModel || list[0]?.id || ''
  return { id: newPresetId(), name: '', provider: id, baseUrl: known?.custom ? String(base.baseUrl || '') : known?.baseUrl || '', protocol: known?.custom ? String(base.protocol || 'chat') : 'chat',
    model, effort: '', fast: false }
}
/** 检查一个预设能不能用；named：提示里带上预设名。 */
function check(preset: Preset, named: boolean) {
  if (preset.provider === 'codex') return
  const which = named ? `预设「${presetTitle(preset)}」：` : ''
  try { apiOrigin(preset.baseUrl) } catch (cause: any) { throw new Error(which + (cause?.message || String(cause))) }
  if (!preset.model.trim()) throw new Error(which + '请填写模型名称。')
}
function openForm(preset: Preset, isNew: boolean) {
  form.value = { preset: { ...preset }, isNew }
  status.value = ''; error.value = false
  resetList()
  void showStoredKey()
  void nextTick(() => {
    const dialog = formDialog.value
    if (!dialog || dialog.open) return
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '')
  })
}
function addPreset() { if (presets.value.length < MAX_PRESETS && !form.value) openForm(freshPreset(), true) }
function editPreset(id: string) { const preset = presets.value.find(item => item.id === id); if (preset) openForm(preset, false) }
function closeForm() {
  form.value = null
  status.value = ''; error.value = false
  resetList()
  const dialog = formDialog.value
  if (dialog?.open) { if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open') }
}
/** 「添加 / 确定」：检查后写回列表；密钥改过的记下，等整页保存时一起写入。 */
function confirmForm() {
  const value = form.value
  if (!value) return true
  const preset = { ...value.preset, name: value.preset.name.trim() }
  try { check(preset, false) } catch (cause: any) { status.value = cause?.message || String(cause); error.value = true; return false }
  const list: Preset[] = settings.value.presets
  // 改过的预设、以及密钥改过的同一服务商的预设：原来的测试结果不再作数。
  for (const item of list) if (item.id === preset.id || (formKeyTouched.value && item.provider === preset.provider)) forgetTest(item.id)
  if (formKeyTouched.value && preset.provider !== 'codex') keyDrafts[preset.provider] = formKey.value
  const index = list.findIndex(item => item.id === preset.id)
  // 还没给某处选预设（例如这是第一个预设）：新加的这个直接用上。
  const unassigned = value.isNew || index < 0 ? TASKS.filter(task => !list.some(item => item.id === settings.value[task.field])) : []
  if (value.isNew || index < 0) list.push(preset); else list[index] = preset
  for (const task of unassigned) settings.value[task.field] = preset.id
  closeForm()
  if (value.isNew) status.value = `已添加「${presetTitle(preset)}」，` + (unassigned.length === TASKS.length ? '阅读助手、翻译和快速解释先都用它；可以在下面「各处默认预设」里再换。' : unassigned.length ? `${unassigned.map(task => task.label).join('、')}先用它。` : '可以在下面「各处默认预设」里选用它。')
  markEdited()
  return true
}
// 窗口里的按键不往外传：Esc 只关这个窗口（在模型列表里按 Esc 只收起列表），Tab 也不会被设置窗口拉回去。
function formKeydown(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  if (listOpen.value && (event.target as HTMLElement | null)?.closest?.('.model-pick')) closeList()
  else closeForm()
}
function removePreset(id: string) {
  const list: Preset[] = settings.value.presets
  const index = list.findIndex(item => item.id === id)
  if (index < 0) return
  const [gone] = list.splice(index, 1)
  forgetTest(id)
  const fallback = list[Math.max(0, index - 1)]
  const moved = TASKS.filter(task => settings.value[task.field] === gone!.id)
  for (const task of moved) settings.value[task.field] = fallback?.id || ''
  if (form.value?.preset.id === id) closeForm()
  error.value = false
  status.value = `已删除「${presetTitle(gone!)}」` + (!list.length ? '。现在没有模型预设了，阅读助手、翻译和快速解释要先新建一个才能用。'
    : moved.length ? `；${moved.map(task => task.label).join('、')}改用「${presetTitle(fallback!)}」。` : '。')
  markEdited()
}

async function save() {
  saving.value = true; error.value = false
  try {
    if (keyLoading.value) throw new Error('正在读取 AI 配置，请稍后保存。')
    // 预设窗口还开着就保存：先按「确定」处理，填得不对就停在窗口里。
    if (form.value && !confirmForm()) return null
    status.value = ''
    for (const preset of presets.value) {
      // 有问题的预设打开它的窗口，提示里写明是哪一个。
      try { check(preset, presets.value.length > 1) } catch (cause: any) { editPreset(preset.id); status.value = cause?.message || String(cause); error.value = true; return null }
    }
    for (const field of requestFields) {
      const value = settings.value.requestLimits[field.key]
      if (!Number.isInteger(value) || value < field.min || value > field.max) throw new Error(`${field.label}须为 ${field.min}–${field.max} 的整数。`)
    }
    settings.value.requestLimits = normalizeRequestLimits(settings.value.requestLimits)
    // 只写改动过的密钥；「记住密钥」改了的话，已读到的每把密钥都按新的选择重新写入或清除。
    const rememberChanged = Boolean(settings.value.rememberKey) !== rememberedAtLoad
    const changedKeys: Record<string, string> = {}
    for (const [id, value] of Object.entries(keyDrafts)) if (id !== 'codex' && (rememberChanged || value !== keyOriginal[id])) changedKeys[id] = value
    const assistant = presets.value.find(item => item.id === settings.value.assistantPreset) || presets.value[0]
    // 一个预设都没有时顶层照旧（AI 功能会提示先新建预设）。
    const saved = await saveAiSettings({ ...settings.value, ...(assistant ? presetConnection(assistant) : {}) }, changedKeys)
    for (const [id, value] of Object.entries(changedKeys)) keyOriginal[id] = value
    rememberedAtLoad = Boolean(saved.rememberKey)
    settings.value = saved
    status.value = ''
    edited.value = false
    emit('saved', saved)
    return saved
  } catch (cause: any) { status.value = cause?.message || String(cause); error.value = true; return null }
  finally { saving.value = false }
}
defineExpose({ save, hasChanges: () => edited.value })
</script>

<template>
  <section class="ai-settings" :class="{ embedded }" aria-label="AI 设置" @input="markEdited" @change="markEdited">
    <div v-if="!embedded" class="settings-heading"><strong>AI 设置</strong><button class="text-button" @click="emit('close')">返回</button></div>

    <div class="group-head"><strong>模型预设</strong><button type="button" class="text-button" :disabled="presets.length >= MAX_PRESETS" @click="addPreset">＋ 新建预设</button></div>
    <p class="settings-note">点「新建预设」填写一个新的模型预设，点「编辑预设」（或直接点这个预设）可以修改它；再在下面给阅读助手、翻译和快速解释各选一个。同一服务商的预设共用一把 API Key。「测试连接」会用这个预设发一句极短的消息，看地址、密钥和模型能不能用。</p>
    <div class="preset-list">
      <p v-if="!presets.length" class="preset-empty">还没有模型预设。点右上角「＋ 新建预设」，选好服务商、填上 API Key 和模型，阅读助手、翻译和快速解释就能用了。</p>
      <div v-for="item in presets" :key="item.id" class="preset-item">
        <button type="button" class="preset-row" :data-uses="usesOf(item.id)" :data-tip="`编辑「${presetTitle(item)}」`" @click="editPreset(item.id)">
          <span class="preset-title">{{ presetTitle(item) }}</span>
          <span class="preset-detail">{{ presetDetail(item) }}</span>
        </button>
        <button type="button" class="preset-edit" :aria-label="`编辑预设「${presetTitle(item)}」`" @click="editPreset(item.id)">编辑预设</button>
        <button type="button" class="preset-test" :class="tests[item.id]?.state" :disabled="tests[item.id]?.state === 'testing'" :aria-label="`测试连接「${presetTitle(item)}」`" @click="testPreset(item)">{{ tests[item.id]?.state === 'testing' ? '测试中…' : '测试连接' }}</button>
        <button type="button" class="preset-delete" :aria-label="`删除预设「${presetTitle(item)}」`" @click="removePreset(item.id)">删除预设</button>
        <p v-if="tests[item.id] && tests[item.id]!.state !== 'testing'" class="preset-test-result" :class="tests[item.id]!.state" role="status">{{ tests[item.id]!.message }}</p>
      </div>
    </div>

    <div class="group-head"><strong>各处默认预设</strong></div>
    <template v-if="presets.length">
      <label v-for="task in TASKS" :key="task.field">{{ task.label }}<select v-model="settings[task.field]" :aria-label="task.aria"><option v-for="item in presets" :key="item.id" :value="item.id">{{ presetTitle(item) }}（{{ presetDetail(item) }}）</option></select></label>
      <p class="settings-note">阅读助手的预设也可以在输入栏的模型按钮里随时切换。思考强度不在预设里设，用的时候在输入栏的模型按钮里选，会记在当前这个预设上；翻译和快速解释照用所选预设的模型和这个强度（没选过就是模型默认），不做降级。</p>
    </template>
    <p v-else class="settings-note">新建预设后，在这里给阅读助手、翻译和快速解释各选一个；第一个预设会先用在这三处。</p>

    <details class="limit-settings"><summary>每题阅读预算</summary><label v-for="field in DOCUMENT_LIMIT_FIELDS" :key="field.key">{{ field.label }}<input v-model.number="settings.documentLimits[field.key]" type="number" :min="field.min" :max="field.max" :step="field.step || 1" /></label></details>
    <details class="limit-settings"><summary>多文件提问</summary><label v-for="field in requestFields" :key="field.key">{{ field.label }}<input v-model.number="settings.requestLimits[field.key]" type="number" :min="field.min" :max="field.max" :aria-label="field.label" /></label><p class="settings-note">切换标签或收起助手后继续回答；关闭文件标签会停止该文件的提问。</p></details>
    <p v-if="status && !form" class="settings-status" :class="{ error }" role="status">{{ status }}</p>
    <button v-if="!embedded" class="primary-button" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存设置' }}</button>

    <!-- 预设窗口：浏览器原生的模态对话框，盖在设置窗口之上；里面的改动不算进设置页，点「添加 / 确定」才算。 -->
    <dialog ref="formDialog" class="preset-dialog" :aria-label="form?.isNew ? '新建预设' : '编辑预设'" @keydown="formKeydown" @input.stop @change.stop @cancel.prevent="closeForm">
      <form v-if="form && current" class="preset-form" @submit.prevent="confirmForm">
        <strong class="form-title">{{ form.isNew ? '新建预设' : `编辑「${presetTitle(presets.find(item => item.id === current!.id) || current)}」` }}</strong>
        <label>预设名称<input v-model="current.name" aria-label="预设名称" :maxlength="PRESET_NAME_LIMIT" :placeholder="autoTitle ? `不填就叫「${autoTitle}」` : '可选'" /></label>
        <label>服务商<select v-model="current.provider" aria-label="服务商" @change="providerChanged"><option v-for="item in PROVIDERS" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
        <template v-if="current.provider !== 'codex'">
          <label v-if="provider?.custom">接口协议<select v-model="current.protocol" aria-label="接口协议"><option v-for="item in PROTOCOLS" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
          <label>API 地址<input v-model="current.baseUrl" aria-label="API 地址" type="url" :placeholder="provider?.custom ? 'https://openrouter.ai/api/v1 或 http://localhost:11434/v1' : 'https://api.example.com/v1'" /></label>
          <label>API Key<input v-model="key" aria-label="API Key" type="password" autocomplete="off" placeholder="仅供所选服务商使用" /></label>
          <p v-if="sharers.length" class="settings-note">这把密钥与「{{ sharers.map(presetTitle).join('」「') }}」共用。</p>
          <label class="check"><input v-model="settings.rememberKey" type="checkbox" @change="markEdited" /> 在这台电脑记住密钥</label>
          <p class="settings-note">桌面版使用 Windows 加密保存。浏览器预览的密钥只保留在本次页面会话。<template v-if="provider?.custom"> 本机服务（Ollama、LM Studio）可以不填密钥。</template></p>
        </template>
        <template v-else>
          <p class="settings-note">沿用本机 Codex 的登录，无需填写 API Key。需要已安装并登录 Codex CLI；点模型右边的「获取模型列表」检查登录并读取本机模型。</p>
        </template>
        <div class="model-field">
          <span class="field-label">模型</span>
          <div class="model-line">
            <select v-if="current.provider === 'codex'" v-model="current.model" aria-label="模型" :disabled="refreshing"><option value="">模型默认</option><option v-if="hasStoredModel" :value="current.model">当前设置：{{ current.model }}</option><option v-for="item in models" :key="item.id" :value="item.id">{{ item.name || item.id }}</option></select>
            <input v-else ref="modelInput" v-model="current.model" aria-label="模型" list="ai-model-list" placeholder="模型默认或自定义名称" />
            <button type="button" class="secondary-button fetch-models" :disabled="listing || refreshing" :aria-expanded="current.provider === 'codex' ? undefined : listOpen" :data-tip="current.provider === 'codex' ? '检查本机 Codex 的登录并读取它的模型' : '用上面的地址和 API Key 向服务商读取可用的模型'" @click="fetchModels">{{ listing || refreshing ? '读取中…' : '获取模型列表' }}</button>
          </div>
          <div v-if="listOpen && listed && current.provider !== 'codex'" class="model-pick">
            <div class="model-pick-head"><span role="status">{{ listStatus }}</span><button type="button" class="text-button" @click="closeList">收起</button></div>
            <input v-if="listed.models.length > 8" v-model="listQuery" class="model-search" type="search" aria-label="搜索模型" placeholder="搜索模型名称" autocomplete="off" @keydown="searchKey" />
            <div ref="modelOptions" class="model-options" role="listbox" aria-label="服务商的模型" @keydown="optionKey">
              <button v-for="item in listShown" :key="item.id" type="button" role="option" :aria-selected="item.id === current.model" :class="{ on: item.id === current.model }" :title="item.id" @click="pickModel(item.id)"><span class="option-id">{{ item.id }}</span><span v-if="item.name" class="option-name">{{ item.name }}</span></button>
              <p v-if="!listShown.length" class="model-none">没有名称里带「{{ listQuery.trim() }}」的模型。</p>
            </div>
          </div>
          <p v-else-if="listStatus" class="list-status" :class="{ error: listError }" role="status">{{ listStatus }}</p>
        </div>
        <datalist v-if="current.provider !== 'codex'" id="ai-model-list"><option v-for="item in models" :key="item.id" :value="item.id">{{ item.name }}</option></datalist>
        <label v-if="supportsFast(current.provider)" class="check"><input v-model="current.fast" type="checkbox" /> Fast：更快出字，额度消耗更多</label>
        <p v-if="status" class="settings-status" :class="{ error }" role="status">{{ status }}</p>
        <div class="form-actions">
          <button type="button" class="text-button" @click="closeForm">取消</button>
          <button type="submit" class="primary-button">{{ form.isNew ? '添加' : '确定' }}</button>
        </div>
      </form>
    </dialog>
  </section>
</template>

<style scoped>
.ai-settings.embedded{position:relative;padding:14px 16px 16px;height:auto;border-radius:var(--r-lg);background-color:color-mix(in srgb,var(--glass-2) 60%,var(--fill-4));background-image:var(--glass-sheen);box-shadow:var(--glass-control-edge)}
.ai-settings{padding:20px;display:flex;flex-direction:column;gap:14px;overflow:auto;height:100%;box-sizing:border-box}
label{font-size:12px;font-weight:550;display:flex;flex-direction:column;gap:7px;color:var(--secondary)}
input:not([type='checkbox']),select{font:inherit;font-size:13px;color:var(--control-ink);height:38px;padding:7px 14px;min-width:0}
select{padding-right:34px}
button{font:inherit;cursor:pointer;color:var(--control-ink)}
.check{flex-direction:row-reverse;justify-content:space-between;align-items:center;font-size:12.5px;cursor:pointer}
.check input{margin:0}
.settings-note{font-size:11.5px;line-height:1.7;color:var(--muted);margin:0}
.text-button{border:0;border-radius:var(--r-control);background:none;box-shadow:none;color:var(--accent);padding:4px 10px}
.text-button:hover:not(:disabled){background:color-mix(in srgb,var(--accent) 10%,transparent);color:var(--accent)}
.text-button:disabled{opacity:.45;cursor:default}
.primary-button,.secondary-button{height:38px;border:1px solid var(--glass-outline);border-radius:var(--r-control);padding:8px 16px;background-color:var(--glass-2);background-image:var(--glass-sheen);box-shadow:var(--glass-control-shadow);color:var(--control-ink);font-weight:600}
.secondary-button{align-self:flex-start}
.secondary-button:hover:not(:disabled){background-color:var(--control-hover);color:var(--control-ink)}
.primary-button{background-color:var(--accent-glass);background-image:var(--glass-tint-sheen);border-color:transparent;color:var(--accent-on)}
.primary-button:hover:not(:disabled){background-color:var(--accent-glass-hover);color:var(--accent-on)}
.settings-status{font-size:12px;line-height:1.6;margin:0;color:var(--muted);overflow-wrap:anywhere}
.error{color:var(--danger)}
/* 分组标题：模型预设 / 各处默认预设。 */
.group-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:32px;margin-bottom:-6px;font-size:13px;color:var(--control-ink)}
.group-head strong{font-weight:650}
.group-head:not(:first-child){border-top:1px solid var(--separator);padding-top:10px}
/* 预设列表：左边点开修改，右边测试连接、删除；测试结果写在这一行下面。 */
.preset-list{display:flex;flex-direction:column;gap:4px}
.preset-empty{margin:0;padding:16px 18px;border:1px dashed color-mix(in srgb,var(--muted) 45%,transparent);border-radius:var(--r-control);font-size:12px;line-height:1.7;color:var(--muted);text-align:center}
.preset-item{display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px;border-radius:var(--r-control);transition:background-color var(--dur-1) var(--ease-soft)}
.preset-item:hover{background-color:var(--control-hover)}
.preset-row{display:flex;flex-direction:column;align-items:flex-start;gap:1px;flex:1;min-width:0;min-height:46px;padding:6px 12px;border:0;border-radius:var(--r-control);background:none;box-shadow:none;text-align:left}
.preset-row:focus-visible,.preset-edit:focus-visible,.preset-test:focus-visible,.preset-delete:focus-visible{outline:none;box-shadow:0 0 0 2px var(--accent-ring,var(--accent))}
.preset-title{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;color:var(--control-ink)}
.preset-detail{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;color:var(--muted)}
.preset-edit,.preset-test,.preset-delete{flex:none;height:30px;padding:0 10px;border:0;border-radius:var(--r-control);background:none;box-shadow:none;font-size:12px;font-weight:600;opacity:.8;transition:background-color var(--dur-1) var(--ease-soft),opacity var(--dur-1) var(--ease-soft)}
.preset-edit{color:var(--control-ink)}
.preset-edit:hover{background:color-mix(in srgb,var(--control-ink) 8%,transparent);opacity:1}
.preset-test{color:var(--accent)}
.preset-test:hover:not(:disabled){background:color-mix(in srgb,var(--accent) 10%,transparent);opacity:1}
.preset-test:disabled{opacity:.55;cursor:progress}
.preset-delete{margin-right:6px;color:var(--danger)}
.preset-delete:hover:not(:disabled){background:color-mix(in srgb,var(--danger) 12%,transparent);opacity:1}
.preset-test-result{flex-basis:100%;margin:-2px 0 0;padding:0 12px 7px;font-size:11.5px;line-height:1.55;overflow-wrap:anywhere}
.preset-test-result.ok{color:var(--success)}
.preset-test-result.fail{color:var(--danger)}
.limit-settings{font-size:12.5px;color:var(--secondary);border-top:1px solid var(--separator);padding-top:4px}
.limit-settings summary{cursor:pointer;display:flex;align-items:center;justify-content:space-between;min-height:40px;padding:6px 4px;border-radius:var(--r-sm);color:var(--control-ink);font-weight:550;list-style:none;transition:background-color var(--dur-1) var(--ease-soft)}
.limit-settings summary::-webkit-details-marker{display:none}
.limit-settings summary::after{content:'›';font-size:17px;line-height:1;color:var(--muted);transition:transform var(--dur-bounce) var(--spring-snappy)}
.limit-settings[open] summary::after{transform:rotate(90deg)}
.limit-settings summary:hover{background-color:var(--control-hover);color:var(--control-ink)}
.limit-settings label{margin:10px 0}
button:disabled{opacity:.5;cursor:wait}
/* 预设窗口：与设置窗口同一种玻璃，居中弹出，后面压暗。 */
.preset-dialog{width:min(440px,calc(100vw - 48px));max-height:min(680px,calc(100vh - 48px));margin:auto;padding:0;overflow:auto;border:1px solid var(--glass-outline);border-radius:var(--r-xl,18px);background-color:var(--popup-glass,var(--surface));background-image:var(--popup-sheen);-webkit-backdrop-filter:blur(var(--popup-blur,24px)) saturate(var(--glass-sat,1.4));backdrop-filter:blur(var(--popup-blur,24px)) saturate(var(--glass-sat,1.4));box-shadow:0 30px 90px -20px rgb(0 0 0 / .45),var(--shadow-3),var(--glass-edge);color:var(--ink);font-family:var(--font-ui)}
.preset-dialog[open]{animation:dialog-in var(--dur-bounce,.32s) var(--spring-snappy,ease-out)}
.preset-dialog::backdrop{background:rgb(16 20 26 / .28)}
:root[data-glass='solid'] .preset-dialog,:root[data-contrast='high'] .preset-dialog{background-color:var(--surface);background-image:none;-webkit-backdrop-filter:none;backdrop-filter:none}
.preset-form{display:flex;flex-direction:column;gap:14px;padding:18px 20px 16px}
.form-title{font-size:15px;font-weight:650;color:var(--control-ink)}
.form-actions{display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:2px}
.form-actions .primary-button{min-width:84px}
/* 模型一行：输入框（Codex 是下拉框）+ 右边「获取模型列表」；读到的模型在下面展开成可搜索的列表。 */
.model-field{display:flex;flex-direction:column;gap:7px;font-size:12px;font-weight:550;color:var(--secondary)}
.model-line{display:flex;align-items:center;gap:8px}
.model-line input,.model-line select{flex:1;width:0}
.secondary-button.fetch-models{flex:none;align-self:stretch;height:auto;padding:0 12px;font-size:12.5px;white-space:nowrap}
.list-status{margin:0;font-size:12px;font-weight:400;line-height:1.6;color:var(--muted);overflow-wrap:anywhere}
.model-pick{display:flex;flex-direction:column;gap:6px;padding:6px;border:1px solid var(--glass-outline);border-radius:var(--r-control);background:color-mix(in srgb,var(--surface) 72%,transparent);animation:pick-in var(--dur-2,.2s) var(--ease-out,ease-out)}
.model-pick-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 2px 0 6px;font-size:11.5px;font-weight:400;line-height:1.5;color:var(--muted)}
.model-pick-head .text-button{flex:none;padding:2px 8px;font-size:12px}
.model-pick input.model-search{height:32px;padding:5px 10px;font-size:12.5px}
.model-options{display:flex;flex-direction:column;gap:1px;max-height:224px;overflow-y:auto;overscroll-behavior:contain}
.model-options button{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex:none;min-height:30px;padding:5px 10px;border:0;border-radius:calc(var(--r-control) - 2px);background:none;box-shadow:none;text-align:left;font-size:12.5px;font-weight:500}
.model-options button:hover,.model-options button:focus-visible{background:var(--control-hover);outline:none}
.model-options button.on{background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent);font-weight:650}
.option-id{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.option-name{flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;font-weight:400;color:var(--muted)}
.model-none{margin:6px 8px;font-size:12px;font-weight:400;color:var(--muted)}
@keyframes pick-in{from{opacity:0;translate:0 -4px}}
@keyframes dialog-in{from{opacity:0;scale:.96}}
@media(prefers-reduced-motion:reduce){.preset-dialog[open],.model-pick{animation:none}}
@media(prefers-reduced-transparency:reduce),(prefers-contrast:more),(forced-colors:active){.preset-dialog{background-color:var(--surface);background-image:none;-webkit-backdrop-filter:none;backdrop-filter:none}}
</style>
