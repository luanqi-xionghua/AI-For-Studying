<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { chat } from '../../chat'
import { loadChatChoice, resolveChatChoice, saveChatChoice, type ResolvedChatChoice } from '../../chat/choice.ts'
import { wireMessages } from '../../chat/history.ts'
import type { ChatModelChoice } from '../../chat/types.ts'
import { loadAiSettings, NO_PRESET_MESSAGE } from '../../ai/settings.mjs'
import { estimateTokens } from '../../ai/workspace'
import { hasMemoryContent } from '../../memory/merge.ts'
import type { MemoryScope } from '../../memory/types.ts'
import { relativeTime } from '../../memory/prompts.ts'
import MemoryScopePicker from './MemoryScopePicker.vue'
import ChatHistoryPanel from './ChatHistoryPanel.vue'
import ChatMessageList from './ChatMessageList.vue'
import ChatComposer from './ChatComposer.vue'
import ConfirmDialog from '../ui/ConfirmDialog.vue'

const props = defineProps<{
  documents: { id: string; title: string }[]
  settingsVersion: number
  initialScope?: MemoryScope | null
}>()
const emit = defineEmits<{ settings: []; memory: []; notify: [text: string]; 'scope-applied': [] }>()

const settings = ref<any>(loadAiSettings())
const choice = ref<ChatModelChoice>(loadChatChoice())
const resolved = computed<ResolvedChatChoice | null>(() => resolveChatChoice(settings.value, choice.value))
const memoryModule = shallowRef<any>(undefined)
const memoryState = shallowRef<any>(undefined)
const composer = ref<{ focus?: () => void }>()
const confirmRemove = ref<{ id: string; title: string } | null>(null)
const appliedInitial = ref(false)

const conversation = computed(() => {
  const id = chat.state.activeId
  return id ? (chat.state.conversations.get(id) || null) : null
})
const busyIds = computed(() => new Set([...chat.state.conversations.values()].filter(item => item.request).map(item => item.id)))
const currentBusy = computed(() => Boolean(conversation.value?.request))
const noPreset = computed(() => !resolved.value)
const effectiveScope = computed<MemoryScope>(() => {
  const scope = conversation.value?.scope || { kind: 'global' }
  if (scope.kind === 'doc' && !props.documents.some(doc => doc.id === scope.docId)) return { kind: 'none' }
  return scope
})
const removedScope = computed(() => conversation.value?.scope.kind === 'doc' && !props.documents.some(doc => doc.id === (conversation.value!.scope as any).docId))
const memoryIds = computed(() => new Set<string>((memoryState.value?.index?.docs || []).map((entry: any) => entry.docId)))
const globalHasContent = computed(() => hasMemoryContent(memoryState.value?.global || null))
const contextUsed = computed(() => {
  const messages = conversation.value ? wireMessages(conversation.value) : []
  return estimateTokens(messages.map(message => message.content).join('\n'))
})
const statusText = computed(() => {
  const scope = effectiveScope.value
  if (scope.kind === 'none') {
    if (removedScope.value && conversation.value?.scope.kind === 'doc') return `《${(conversation.value!.scope as any).title || '这本书'}》已从文档库移除，这段对话按「不使用记忆」处理。`
    return '这段对话不使用记忆。'
  }
  if (scope.kind === 'global') {
    const global = memoryState.value?.global
    if (!globalHasContent.value) return '全局记忆还是空的，本轮不会注入内容；继续对话后会逐步建立。'
    return `正在使用全局记忆（上次更新：${relativeTime(global.summarizedAt, Date.now())}）。`
  }
  const entry = (memoryState.value?.index?.docs || []).find((item: any) => item.docId === scope.docId)
  if (!entry || (!entry.summarizedAt && !entry.hasOnboarding && !entry.pending)) return '该书暂无记忆，本轮不会注入内容；继续对话后会为它建立记忆。'
  return `正在使用《${scope.title || '这本书'}》的记忆${entry.summarizedAt ? `（上次更新：${relativeTime(entry.summarizedAt, Date.now())}）` : ''}。`
})

function reloadSettings() { settings.value = loadAiSettings() }
watch(() => props.settingsVersion, reloadSettings)

async function injectionFor(scope: MemoryScope) {
  if (!memoryModule.value) memoryModule.value = await import('../../memory')
  return memoryModule.value.injectionFor(scope)
}
async function ensureMemory() {
  if (!memoryModule.value) memoryModule.value = await import('../../memory')
  memoryState.value = memoryModule.value.memoryState
}
function connectionOptions() {
  const connection = resolved.value
    ? { provider: resolved.value.provider, baseUrl: resolved.value.baseUrl, protocol: resolved.value.protocol, model: resolved.value.model, effort: resolved.value.effort }
    : null
  const reason = resolved.value ? undefined : (settings.value?.presets?.length ? '对话模式选的预设没有选模型：请在 设置 → AI 里给它选一个模型。' : NO_PRESET_MESSAGE)
  return { connection, reason, scope: effectiveScope.value, injectionFor }
}
function focus() { void composer.value?.focus?.() }

onMounted(async () => {
  await chat.load()
  const current = chat.current()
  if (!current.loaded) await chat.open(current.id)
  await ensureMemory()
  if (!appliedInitial.value && props.initialScope) applyInitialScope()
  focus()
})
function applyInitialScope() {
  if (!props.initialScope) return
  appliedInitial.value = true
  applyScope(props.initialScope)
  emit('scope-applied')
}
watch(() => [chat.state.ready, props.initialScope], () => { if (chat.state.ready && !appliedInitial.value && props.initialScope) applyInitialScope() })

async function send(text: string) {
  const current = chat.current()
  if (!current) return
  await chat.send(current.id, text, connectionOptions() as any)
  focus()
}
async function regenerate() {
  const current = conversation.value
  if (!current) return
  await chat.regenerate(current.id, connectionOptions() as any)
  focus()
}
function stop() { if (conversation.value) chat.stop(conversation.value.id) }
function updateDraft(value: string) { if (conversation.value) conversation.value.draft = value }
function useExample(text: string) { updateDraft(text); focus() }
function applyChoice(next: ChatModelChoice) { saveChatChoice(next); choice.value = next }
function newConversation() { chat.newConversation({ kind: 'global' }); focus() }
function applyScope(scope: MemoryScope) {
  const current = chat.current()
  if (!current) return
  if (current.messages.length) chat.newConversation(scope)
  else chat.setScope(current.id, scope)
}
async function selectConversation(id: string) {
  await chat.open(id)
  chat.state.activeId = id
  focus()
}
function requestRemove(id: string) {
  const entry = chat.state.list.find(item => item.id === id)
  confirmRemove.value = { id, title: entry?.title || '新对话' }
}
async function removeConversation() {
  const item = confirmRemove.value
  confirmRemove.value = null
  if (item) await chat.remove(item.id)
}
async function copy(text: string) {
  if (!text) return
  try { await navigator.clipboard.writeText(text) } catch { emit('notify', '复制失败，请手动选择文字。') }
}
function focusPrompt() { focus() }
defineExpose({ focusPrompt })
</script>

<template>
  <section class="page-view chat-page" aria-label="对话模式">
    <header class="page-heading">
      <h1>对话模式</h1>
      <div class="chat-head-actions">
        <ChatHistoryPanel :list="chat.state.list" :active-id="chat.state.activeId" :busy-ids="busyIds" @select="selectConversation" @remove="requestRemove" @create="newConversation" />
      </div>
    </header>
    <p class="page-note">不打开文档，直接和模型聊。可以带上学习记忆，让回答更贴合你的情况。</p>
    <p class="chat-status" role="status">{{ statusText }}</p>
    <div class="chat-body">
      <ChatMessageList :conversation="conversation" :busy="Boolean(currentBusy)" :no-preset="noPreset" @copy="copy" @regenerate="regenerate" @example="useExample" @settings="emit('settings')" />
      <ChatComposer
        ref="composer"
        :model-value="conversation?.draft || ''"
        :busy="Boolean(currentBusy)"
        :disabled="noPreset"
        :settings="settings"
        :choice="choice"
        :resolved="resolved"
        :context-used="contextUsed"
        @update:model-value="updateDraft"
        @send="send"
        @stop="stop"
        @choice="applyChoice"
        @settings="emit('settings')"
      >
        <template #scope>
          <MemoryScopePicker up :scope="effectiveScope" :documents="props.documents" :memory-ids="memoryIds" :global-has-content="globalHasContent" :disabled="Boolean(currentBusy)" @update:scope="applyScope" @manage="emit('memory')" />
        </template>
      </ChatComposer>
    </div>
    <ConfirmDialog v-if="confirmRemove" title="删除这段对话？" :message="`「${confirmRemove.title}」会被永久删除。已经写入学习记忆的内容不受影响。`" confirm-label="删除对话" danger @confirm="removeConversation" @cancel="confirmRemove = null" />
  </section>
</template>

<style scoped>
.chat-page { height: 100%; }
.chat-head-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.chat-status { margin: 0; font-size: 12px; color: var(--muted); }
.chat-body { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 10px; }
</style>
