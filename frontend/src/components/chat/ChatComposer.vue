<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { contextWindow } from '../../ai/workspace'
import { composerModels, presetDetail, presetTitle } from '../../ai/presets.ts'
import type { ChatModelChoice } from '../../chat/types.ts'
import type { ResolvedChatChoice } from '../../chat/choice.ts'
import { pickChatEffort, pickChatModel, pickChatPreset } from '../../chat/choice.ts'
import AppIcon from '../ui/AppIcon.vue'
import ModelPicker from '../assistant/ModelPicker.vue'
import UsagePanel from '../assistant/UsagePanel.vue'

const props = defineProps<{
  modelValue: string
  busy: boolean
  disabled: boolean
  settings: any
  choice: ChatModelChoice
  resolved: ResolvedChatChoice | null
  contextUsed: number
  /** 输入栏里有附件：底注追加附件说明。 */
  hasAttachments?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
  send: [text: string]
  stop: []
  choice: [choice: ChatModelChoice]
  settings: []
  images: [files: File[]]
}>()

const EFFORT_LABELS: Record<string, string> = { '': '默认', none: '不思考', minimal: '极简', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高', ultra: '极致' }
const field = ref<HTMLTextAreaElement>()
const host = ref<HTMLElement>()
const usageOpen = ref(false)
const pickerOpen = ref(false)
const drawerMounted = ref(false)
const pickerHost = ref<HTMLElement>()
const modelLabel = computed(() => {
  if (!props.resolved) return '未设置模型'
  return composerModels(props.resolved.provider, props.resolved.model).find(item => item.id === props.resolved!.model)?.name || props.resolved.model
})
const effortLabel = computed(() => props.resolved ? (EFFORT_LABELS[props.resolved.effort] ?? props.resolved.effort) : '')
const pickerModels = computed(() => props.resolved ? composerModels(props.resolved.provider, props.resolved.model) : [])
const presetChips = computed(() => (props.settings?.presets || []).map((item: any) => ({ id: item.id, name: presetTitle(item), detail: presetDetail(item) })))
const contextLimit = computed(() => props.resolved ? contextWindow(props.resolved.provider, props.resolved.model) : 0)

function resize() {
  const element = field.value
  if (!element) return
  element.style.height = 'auto'
  element.style.height = `${Math.min(Math.round(window.innerHeight * .4), Math.max(52, element.scrollHeight))}px`
}
watch(() => props.modelValue, () => { void nextTick(resize) })
function input(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
  resize()
}
function send() {
  if (props.busy || props.disabled) return
  const text = props.modelValue.trim()
  if (!text) return
  emit('send', text)
}
function keydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  send()
}
function openPicker() {
  if (props.disabled) return
  if (!props.resolved) { emit('settings'); return }
  pickerOpen.value = true
  drawerMounted.value = true
}
function closePicker() { pickerOpen.value = false; void nextTick(() => pickerHost.value?.querySelector<HTMLElement>('.model-picker')?.focus()) }
function commit(next: ChatModelChoice) { emit('choice', next) }
function choosePreset(id: string) { commit(pickChatPreset(props.settings, id)) }
function chooseModel(id: string) { commit(pickChatModel(props.settings, props.choice, id)) }
function chooseEffort(value: string) { commit(pickChatEffort(props.settings, props.choice, value)) }
function manage() { pickerOpen.value = false; emit('settings') }
function outside(event: PointerEvent) { if (event.target instanceof Node && !host.value?.contains(event.target)) pickerOpen.value = false }
watch(pickerOpen, open => {
  if (open) document.addEventListener('pointerdown', outside, true)
  else document.removeEventListener('pointerdown', outside, true)
})
function escape(event: KeyboardEvent) { if (pickerOpen.value && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePicker() } }
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside, true))
function imageFiles(files?: FileList | null): File[] {
  return [...(files || [])].filter(file => file.type.startsWith('image/'))
}
/** 粘贴图片：只处理带图片文件的剪贴板；文字粘贴保持浏览器默认行为。 */
function pasteImages(event: ClipboardEvent) {
  const files = imageFiles(event.clipboardData?.files)
  if (!files.length) return
  event.preventDefault()
  emit('images', files)
}
/** 拖入图片数据（浏览器/截图工具拖出的图片，不是资源管理器里的文件路径）：只在带文件时接管。 */
function dragImages(event: DragEvent) {
  if (![...(event.dataTransfer?.types || [])].includes('Files')) return
  event.preventDefault()
  event.stopPropagation()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}
function dropImages(event: DragEvent) {
  const files = imageFiles(event.dataTransfer?.files)
  if (!files.length) return
  event.preventDefault()
  event.stopPropagation()
  emit('images', files)
}
function focus() { void nextTick(() => field.value?.focus()) }
defineExpose({ focus })
</script>

<template>
  <div ref="host" class="chat-composer" @keydown="escape">
    <slot name="attachments" />
    <div class="composer-field" :class="{ busy: props.busy }" @dragover="dragImages" @drop="dropImages">
      <textarea ref="field" :value="props.modelValue" :disabled="props.disabled" rows="1" :aria-label="props.disabled ? undefined : '向模型提问'" :placeholder="props.disabled ? '先新建模型预设才能开始对话' : '输入问题，Enter 发送，Shift + Enter 换行'" @input="input" @keydown="keydown" @paste="pasteImages" />
    </div>
    <div class="composer-actions">
      <button type="button" class="text-button" data-tip="本次打开应用以来的模型用量" @click="usageOpen = true">用量</button>
      <slot name="scope" />
      <slot name="attach" />
      <span class="composer-space"></span>
      <div ref="pickerHost" class="model-picker-host">
        <button type="button" class="model-picker" :class="{ empty: !props.resolved }" :disabled="props.busy || props.disabled" :aria-expanded="pickerOpen" aria-label="选择模型与思考强度" data-tip="模型与思考强度（只影响对话模式）" @click="openPicker">
          {{ modelLabel }}<em v-if="props.resolved && effortLabel">{{ effortLabel }}</em><AppIcon name="down" :size="12" />
        </button>
      </div>
      <button v-if="props.busy" type="button" class="send-button stop" aria-label="停止" data-tip="停止回答" @click="emit('stop')"><span class="stop-square" /></button>
      <button v-else type="button" class="send-button" :disabled="props.disabled || !props.modelValue.trim()" aria-label="发送" data-tip="发送" data-tip-key="Enter" @click="send"><AppIcon name="arrow-up" :size="16" /></button>
    </div>
    <div v-if="drawerMounted" class="composer-drawer" :class="{ open: pickerOpen }" :inert="!pickerOpen || undefined">
      <ModelPicker
        :model="props.resolved?.model || ''"
        :effort="props.resolved?.effort || ''"
        :models="pickerModels"
        :presets="presetChips"
        :preset="props.resolved?.preset.id"
        @preset="choosePreset"
        @model="chooseModel"
        @effort="chooseEffort"
        @manage="manage"
        @close="closePicker"
      />
    </div>
    <p class="composer-note">记忆只保存在本机。使用记忆范围时，记忆摘要会随问题发给你配置的模型服务商。<template v-if="props.hasAttachments"> 附件（图片、文档摘录）只在本机和你配置的模型服务商之间传输；临时文档不进文档库、不进备份，退出应用后清理。</template></p>
    <UsagePanel v-if="usageOpen" :context-used="props.contextUsed" :context-limit="contextLimit" :model="modelLabel" @close="usageOpen = false; focus()" />
  </div>
</template>

<style scoped>
.chat-composer { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--hairline); border-radius: var(--r-xl); background: var(--frost, var(--fill-2)); }
.composer-field textarea { display: block; width: 100%; min-height: 52px; max-height: 40vh; padding: 8px 4px; border: 0; background: none; resize: none; font: inherit; font-size: 13.5px; line-height: 1.7; color: var(--control-ink, var(--ink)); outline: none; }
.composer-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.composer-space { flex: 1; }
.composer-actions .text-button { padding: 4px 8px; border: 0; border-radius: var(--r-control); background: none; color: var(--muted); font-size: 12px; cursor: pointer; }
.composer-actions .text-button:hover { background: color-mix(in srgb, var(--ink) 7%, transparent); color: var(--ink); }
.composer-actions :deep(.scope-button) { padding: 6px 10px; }
.model-picker-host { position: relative; }
.model-picker { display: inline-flex; align-items: center; gap: 6px; max-width: 260px; padding: 6px 10px; border: 1px solid var(--hairline); border-radius: var(--r-control); background: var(--frost-hover, var(--fill-2)); color: var(--control-ink, var(--ink)); font-size: 12.5px; font-weight: 600; cursor: pointer; }
.model-picker em { font-style: normal; font-weight: 500; color: var(--muted); }
.model-picker.empty { color: var(--muted); }
.send-button { display: grid; place-items: center; width: 34px; height: 34px; padding: 0; border: 0; border-radius: 50%; background: var(--accent); color: var(--accent-on, #fff); cursor: pointer; }
.send-button:disabled { opacity: .4; cursor: default; }
.send-button.stop { background: color-mix(in srgb, var(--ink) 12%, transparent); color: var(--ink); }
.stop-square { width: 10px; height: 10px; border-radius: 2px; background: currentColor; }
.composer-drawer { display: none; }
.composer-drawer.open { display: block; }
.composer-note { margin: 0; font-size: 11px; line-height: 1.6; color: var(--muted); }
</style>
