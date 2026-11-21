<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { chat } from '../../chat'
import { loadChatChoice, resolveChatChoice, saveChatChoice, type ResolvedChatChoice } from '../../chat/choice.ts'
import { wireMessages } from '../../chat/history.ts'
import { loadRailPreference, railRows, saveRailPreference, type ChatRailRow } from '../../chat/rail.ts'
import { attachAvailability, attachmentContextTokens, friendlyDocError, type PickableDoc } from '../../chat/attachments.ts'
import { addImageToDraft, imageFilesFrom, toDataUrl } from '../../chat/images.ts'
import { CHAT_ATTACH_LIMITS, type ChatDocAttachment, type ChatModelChoice } from '../../chat/types.ts'
import type { ChatDocRuntime, LiveConversation } from '../../chat/state.ts'
import { getModel } from '../../ai/providers.mjs'
import { loadAiSettings, NO_PRESET_MESSAGE } from '../../ai/settings.mjs'
import { estimateTokens } from '../../ai/workspace'
import { hasMemoryContent } from '../../memory/merge.ts'
import type { MemoryScope } from '../../memory/types.ts'
import { relativeTime } from '../../memory/prompts.ts'
import MemoryScopePicker from './MemoryScopePicker.vue'
import ChatConversationRail from './ChatConversationRail.vue'
import ChatAttachmentBar from './ChatAttachmentBar.vue'
import ChatDocumentPicker from './ChatDocumentPicker.vue'
import ChatMessageList from './ChatMessageList.vue'
import ChatComposer from './ChatComposer.vue'
import AppIcon from '../ui/AppIcon.vue'
import ConfirmDialog from '../ui/ConfirmDialog.vue'

const props = defineProps<{
  documents: { id: string; title: string }[]
  libraryDocs?: PickableDoc[]
  settingsVersion: number
  initialScope?: MemoryScope | null
}>()
const emit = defineEmits<{ settings: []; memory: []; notify: [text: string]; 'scope-applied': [] }>()

const RAIL_BREAKPOINT = 860
const settings = ref<any>(loadAiSettings())
const choice = ref<ChatModelChoice>(loadChatChoice())
const resolved = computed<ResolvedChatChoice | null>(() => resolveChatChoice(settings.value, choice.value))
const memoryModule = shallowRef<any>(undefined)
const memoryState = shallowRef<any>(undefined)
const composer = ref<{ focus?: () => void }>()
const rail = ref<{ focusSearch?: () => void; focusActive?: () => void }>()
const imageInput = ref<HTMLInputElement>()
const libraryButton = ref<HTMLButtonElement>()
const pickerOpen = ref(false)
const attachNotice = ref('')
let noticeTimer: ReturnType<typeof setTimeout> | undefined
const confirmRemove = ref<{ id: string; title: string } | null>(null)
const appliedInitial = ref(false)
const pageRoot = ref<HTMLElement>()
const railToggle = ref<HTMLButtonElement>()
const railCollapsed = ref(loadRailPreference().collapsed)
const narrow = ref(false)
const drawerOpen = ref(false)
let observer: ResizeObserver | undefined

const conversation = computed(() => {
  const id = chat.state.activeId
  return id ? (chat.state.conversations.get(id) || null) : null
})
const busyIds = computed(() => new Set([...chat.state.conversations.values()].filter(item => item.request).map(item => item.id)))
const currentBusy = computed(() => Boolean(conversation.value?.request))
const noPreset = computed(() => !resolved.value)
const railHidden = computed(() => narrow.value || railCollapsed.value)
const rows = computed<ChatRailRow[]>(() => {
  const live = conversation.value
  return railRows(chat.state.list, chat.state.activeId, live ? {
    id: live.id,
    title: live.title,
    createdAt: live.createdAt,
    updatedAt: live.updatedAt,
    scope: live.scope,
    messageCount: live.messages.length,
  } : null)
})
const effectiveScope = computed<MemoryScope>(() => {
  const scope = conversation.value?.scope || { kind: 'global' }
  if (scope.kind === 'doc' && !props.documents.some(doc => doc.id === scope.docId)) return { kind: 'none' }
  return scope
})
const removedScope = computed(() => conversation.value?.scope.kind === 'doc' && !props.documents.some(doc => doc.id === (conversation.value!.scope as any).docId))
const memoryIds = computed(() => new Set<string>((memoryState.value?.index?.docs || []).map((entry: any) => entry.docId)))
const globalHasContent = computed(() => hasMemoryContent(memoryState.value?.global || null))
/** 输入栏里还没发出去的图片（data URL，只在内存里）。 */
const draftImages = computed(() => conversation.value?.draftImages || [])
/** 附件栏非空：图片草稿或整会话文档附件（文档在 M4 接入）。 */
const hasAttachmentsNow = computed(() => draftImages.value.length > 0 || (conversation.value?.attachments?.length ?? 0) > 0)
const vision = computed(() => {
  const current = resolved.value
  if (!current) return true
  return getModel(current.provider, current.model)?.vision !== false
})
const modelName = computed(() => resolved.value?.model || '')
const EMPTY_RUNTIME = new Map<string, ChatDocRuntime>()
const attachments = computed(() => conversation.value?.attachments || [])
const runtimeMap = computed(() => conversation.value?.runtime || EMPTY_RUNTIME)
const docsCount = computed(() => attachments.value.length)
const attachedDocIds = computed(() => attachments.value.filter(doc => doc.source === 'library' && doc.docId).map(doc => doc.docId as string))
const availability = computed(() => attachAvailability({
  busy: Boolean(currentBusy.value),
  hasPreset: Boolean(resolved.value),
  vision: vision.value,
  modelName: modelName.value,
  images: draftImages.value.length,
  docs: docsCount.value,
  libraryEmpty: !(props.libraryDocs?.length),
}))
const contextUsed = computed(() => {
  const messages = conversation.value ? wireMessages(conversation.value) : []
  const history = estimateTokens(messages.map(message => message.content).join('\n'))
  return history + attachmentContextTokens(draftImages.value.length, conversation.value?.attachments?.length || 0)
})
const statusText = computed(() => {
  const scope = effectiveScope.value
  const suffix = hasAttachmentsNow.value ? ' 本会话带附件，问答不写入学习记忆。' : ''
  if (scope.kind === 'none') {
    if (removedScope.value && conversation.value?.scope.kind === 'doc') return `《${(conversation.value!.scope as any).title || '这本书'}》已从文档库移除，这段对话按「不使用记忆」处理。${suffix}`
    return `这段对话不使用记忆。${suffix}`
  }
  if (scope.kind === 'global') {
    const global = memoryState.value?.global
    if (!globalHasContent.value) return `全局记忆还是空的，本轮不会注入内容；继续对话后会逐步建立。${suffix}`
    return `正在使用全局记忆（上次更新：${relativeTime(global.summarizedAt, Date.now())}）。${suffix}`
  }
  const entry = (memoryState.value?.index?.docs || []).find((item: any) => item.docId === scope.docId)
  if (!entry || (!entry.summarizedAt && !entry.hasOnboarding && !entry.pending)) return `该书暂无记忆，本轮不会注入内容；继续对话后会为它建立记忆。${suffix}`
  return `正在使用《${scope.title || '这本书'}》的记忆${entry.summarizedAt ? `（上次更新：${relativeTime(entry.summarizedAt, Date.now())}）` : ''}。${suffix}`
})
/** 附件操作的原因（添加不了、忽略文件等）临时显示在状态行。 */
const statusLine = computed(() => attachNotice.value || statusText.value)

function reloadSettings() { settings.value = loadAiSettings() }
watch(() => props.settingsVersion, reloadSettings)
watch(railCollapsed, value => saveRailPreference({ version: 1, collapsed: value }))

function syncNarrow(width: number) {
  const next = width > 0 && width < RAIL_BREAKPOINT
  narrow.value = next
  if (!next) drawerOpen.value = false
}
function toggleRail() {
  if (narrow.value) {
    drawerOpen.value = true
    void nextTick(() => rail.value?.focusSearch?.())
    return
  }
  railCollapsed.value = false
}
function collapseRail() {
  railCollapsed.value = true
  void nextTick(() => railToggle.value?.focus())
}
function closeDrawer() {
  drawerOpen.value = false
  void nextTick(() => railToggle.value?.focus())
}

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
  return { connection, reason, scope: effectiveScope.value, injectionFor, vision: vision.value, documentLimits: settings.value?.documentLimits }
}
function focus() { void composer.value?.focus?.() }

onMounted(async () => {
  observer = new ResizeObserver(entries => syncNarrow(entries[0]?.contentRect.width ?? 0))
  if (pageRoot.value) observer.observe(pageRoot.value)
  syncNarrow(pageRoot.value?.clientWidth ?? 0)
  await chat.load()
  const current = chat.current()
  if (!current.loaded) await chat.open(current.id)
  await ensureMemory()
  void probeAttachments(current)
  if (!appliedInitial.value && props.initialScope) applyInitialScope()
  focus()
})
onBeforeUnmount(() => {
  observer?.disconnect()
  observer = undefined
  if (noticeTimer) { clearTimeout(noticeTimer); noticeTimer = undefined }
})
function applyInitialScope() {
  if (!props.initialScope) return
  appliedInitial.value = true
  applyScope(props.initialScope)
  emit('scope-applied')
}
watch(() => [chat.state.ready, props.initialScope], () => { if (chat.state.ready && !appliedInitial.value && props.initialScope) applyInitialScope() })

function notifyAttach(text: string) {
  attachNotice.value = text
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => { attachNotice.value = ''; noticeTimer = undefined }, 6000)
}
function pickImages() {
  if (availability.value.image.disabled) { notifyAttach(availability.value.image.tip); return }
  imageInput.value?.click()
}
function pickImagesFromInput(event: Event) {
  const input = event.target as HTMLInputElement
  const files = input.files ? [...input.files] : []
  input.value = ''
  void addImages(files)
}
async function addImages(files: File[]) {
  const current = conversation.value
  if (!current || !files.length) return
  if (availability.value.image.disabled) { notifyAttach(availability.value.image.tip); return }
  const { files: accepted, rejected } = imageFilesFrom(files)
  if (rejected.length) {
    const wrongType = rejected.filter(item => item.reason === 'type').length
    const tooBig = rejected.filter(item => item.reason === 'size')
    if (wrongType) notifyAttach(`已忽略 ${wrongType} 个不是图片的文件：只支持 PNG、JPEG、WebP、GIF、BMP。`)
    else if (tooBig.length) notifyAttach(`图片「${tooBig[0].name}」超过 20 MB，已跳过。`)
    if (!accepted.length) return
  }
  for (const file of accepted) {
    if (current.draftImages.length >= CHAT_ATTACH_LIMITS.images) { notifyAttach(`一次最多 ${CHAT_ATTACH_LIMITS.images} 张图片`); return }
    try {
      const dataUrl = await toDataUrl(file)
      // 解码期间可能切了会话：这时不要再往旧会话里塞图。
      if (conversation.value !== current) return
      const result = addImageToDraft(current.draftImages, dataUrl)
      if (result.reason === 'count') { notifyAttach(`一次最多 ${CHAT_ATTACH_LIMITS.images} 张图片`); return }
      if (result.reason === 'chars') { notifyAttach('图片总量太大，请减少几张或换小一点的图片。'); return }
      chat.setDraftImages(current.id, result.images)
    } catch {
      notifyAttach(`无法读取图片「${file.name || '这张图片'}」。`)
    }
  }
}
function removeImage(index: number) {
  const current = conversation.value
  if (!current || current.request) return
  chat.setDraftImages(current.id, current.draftImages.filter((_, at) => at !== index))
}
function removeAllImages() {
  const current = conversation.value
  if (!current || current.request) return
  chat.setDraftImages(current.id, [])
}

function libraryInfo(docId?: string) {
  return props.libraryDocs?.find(doc => doc.id === docId)
}
function noTextMessage(title: string) {
  return `《${title}》是扫描件、没有文字层，当前模型不支持图片：请换识图模型。`
}
/** 打开一次文档，检查加密与「有没有文字层」；加密的时报错文案由 friendlyDocError 统一转写。 */
async function probeDocument(doc: ChatDocAttachment): Promise<ChatDocRuntime> {
  const { openAiContext } = await import('../../document/ai-context.mjs')
  const controller = new AbortController()
  const resource = await openAiContext({ id: doc.docId, kind: doc.kind, title: doc.title, passwordId: doc.docId }, { page: 1 }, controller.signal)
  try {
    if (!resource.context.pdf) return { status: 'ready' }
    const page = await resource.context.pdf.getPage(1)
    const content = await page.getTextContent()
    const hasText = (content.items || []).some((item: any) => typeof item?.str === 'string' && item.str.trim())
    if (hasText) return { status: 'ready' }
    return vision.value
      ? { status: 'ready', noText: true }
      : { status: 'error', noText: true, error: noTextMessage(doc.title) }
  } finally {
    try { await resource.close?.() } catch { /* 已关闭 */ }
  }
}
async function probeAttachment(live: LiveConversation, doc: ChatDocAttachment) {
  if (doc.source !== 'library') { live.runtime.set(doc.id, { status: 'expired' }); return }
  const info = libraryInfo(doc.docId)
  if (!info) { live.runtime.set(doc.id, { status: 'removed' }); return }
  if (info.sourceMissing) { live.runtime.set(doc.id, { status: 'missing' }); return }
  live.runtime.set(doc.id, { status: 'preparing' })
  try {
    live.runtime.set(doc.id, await probeDocument(doc))
  } catch (error) {
    live.runtime.set(doc.id, { status: 'error', error: friendlyDocError(error, doc.title) })
  }
}
async function probeAttachments(live: LiveConversation | null = conversation.value) {
  if (!live) return
  for (const doc of live.attachments || []) {
    const runtime = live.runtime.get(doc.id)
    if (runtime && runtime.status !== 'missing' && runtime.status !== 'removed') continue
    await probeAttachment(live, doc)
  }
}
function openPicker() {
  if (availability.value.library.disabled) { notifyAttach(availability.value.library.tip); return }
  pickerOpen.value = true
}
function closePicker() {
  pickerOpen.value = false
  void nextTick(() => libraryButton.value?.focus())
}
function attachDocuments(ids: string[]) {
  const live = conversation.value
  pickerOpen.value = false
  if (!live) return
  const previous = (live.attachments || []).length
  const next = [...(live.attachments || [])]
  for (const id of ids) {
    if (next.length >= CHAT_ATTACH_LIMITS.docs) break
    if (next.some(doc => doc.source === 'library' && doc.docId === id)) continue
    const info = libraryInfo(id)
    if (!info || info.sourceMissing) continue
    next.push({
      id: crypto.randomUUID(),
      source: 'library',
      docId: id,
      title: (info.title || '文档').slice(0, CHAT_ATTACH_LIMITS.attachTitle),
      kind: info.kind,
      addedAt: Date.now(),
    })
  }
  chat.setAttachments(live.id, next)
  const added = next.length - previous
  notifyAttach(added > 0 ? `已附加 ${added} 份文档。` : '没有添加新的文档。')
  // 关掉弹层后把焦点还给文档库按钮（与 Esc 关闭一致）。
  void nextTick(() => libraryButton.value?.focus())
  void probeAttachments(live)
}
function removeDocument(aid: string) {
  const live = conversation.value
  if (!live || live.request) return
  live.runtime.delete(aid)
  chat.setAttachments(live.id, (live.attachments || []).filter(doc => doc.id !== aid))
}

// 模型在识图 / 不识图之间切换时，「扫描件」的状态要跟着变。
watch(vision, () => {
  const live = conversation.value
  if (!live) return
  for (const doc of live.attachments || []) {
    const runtime = live.runtime.get(doc.id)
    if (!runtime?.noText) continue
    live.runtime.set(doc.id, vision.value
      ? { status: 'ready', noText: true }
      : { status: 'error', noText: true, error: noTextMessage(doc.title) })
  }
})
// 文档在文档库里被移除 / 找回时，chip 的状态跟着更新。
watch(() => (props.libraryDocs || []).map(doc => `${doc.id}:${doc.sourceMissing ? 1 : 0}`).join(','), () => {
  const live = conversation.value
  if (!live) return
  for (const doc of live.attachments || []) {
    if (doc.source !== 'library') continue
    const runtime = live.runtime.get(doc.id)
    if (runtime?.status === 'preparing') continue
    const info = libraryInfo(doc.docId)
    if (!info) live.runtime.set(doc.id, { status: 'removed' })
    else if (info.sourceMissing) live.runtime.set(doc.id, { status: 'missing' })
    else if (runtime?.status === 'removed' || runtime?.status === 'missing') { live.runtime.delete(doc.id); void probeAttachment(live, doc) }
  }
})
watch(() => conversation.value?.id, () => { void probeAttachments() })
async function send(text: string) {
  const current = chat.current()
  if (!current) return
  // 计划 §5.5：带图但模型不识图时拦截发送，预览条给出 [移除全部图片]。
  if (current.draftImages.length && !vision.value) {
    current.error = '当前模型不支持图片：请换识图模型，或移除图片后发送。'
    return
  }
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
function newConversation() {
  const current = conversation.value
  // 当前会话还是空的、也没挂附件：只聚焦输入框，不制造一堆空会话。
  if (current && current.messages.length === 0 && !(current.attachments?.length)) { focus(); return }
  chat.newConversation({ kind: 'global' })
  if (narrow.value) drawerOpen.value = false
  focus()
}
function applyScope(scope: MemoryScope) {
  const current = chat.current()
  if (!current) return
  if (current.messages.length) chat.newConversation(scope)
  else chat.setScope(current.id, scope)
}
async function selectConversation(id: string) {
  const fromDrawer = narrow.value && drawerOpen.value
  await chat.open(id)
  chat.state.activeId = id
  // 计划 §3.6：抽屉的每条关闭路径都要把焦点还给「对话列表」按钮（选中某行也算关闭）。
  if (fromDrawer) {
    drawerOpen.value = false
    await nextTick()
    railToggle.value?.focus()
    return
  }
  focus()
}
function renameConversation(id: string, title: string) { void chat.rename(id, title) }
function requestRemove(id: string) {
  const entry = chat.state.list.find(item => item.id === id)
  const live = chat.state.conversations.get(id)
  confirmRemove.value = { id, title: entry?.title || live?.title || '新对话' }
}
async function removeConversation() {
  const item = confirmRemove.value
  confirmRemove.value = null
  if (!item) return
  await chat.remove(item.id)
  const current = chat.current()
  if (!current.loaded) await chat.open(current.id)
  await nextTick()
  rail.value?.focusActive?.()
}
async function copy(text: string) {
  if (!text) return
  try { await navigator.clipboard.writeText(text) } catch { emit('notify', '复制失败，请手动选择文字。') }
}
function focusPrompt() { focus() }
defineExpose({ focusPrompt })
</script>

<template>
  <section ref="pageRoot" class="page-view chat-page" aria-label="对话模式">
    <header class="page-heading">
      <h1>对话模式</h1>
      <div v-if="railHidden" class="chat-head-actions">
        <button ref="railToggle" type="button" class="head-button" aria-label="对话列表" :aria-expanded="narrow && drawerOpen" data-tip="对话列表" @click="toggleRail"><AppIcon name="list" :size="14" />对话列表</button>
        <button type="button" class="head-button" aria-label="新对话" data-tip="新对话" @click="newConversation"><AppIcon name="plus" :size="14" />新对话</button>
      </div>
    </header>
    <p class="page-note">不打开文档，直接和模型聊。可以带上学习记忆，让回答更贴合你的情况。</p>
    <p class="chat-status" role="status">{{ statusLine }}</p>
    <div class="chat-layout">
      <ChatConversationRail
        v-if="!narrow && !railCollapsed"
        ref="rail"
        :rows="rows"
        :active-id="chat.state.activeId"
        :busy-ids="busyIds"
        @select="selectConversation"
        @create="newConversation"
        @remove="requestRemove"
        @rename="renameConversation"
        @collapse="collapseRail"
      />
      <div class="chat-main" :inert="(narrow && drawerOpen) || undefined">
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
          :has-attachments="hasAttachmentsNow"
          @update:model-value="updateDraft"
          @send="send"
          @stop="stop"
          @choice="applyChoice"
          @settings="emit('settings')"
          @images="addImages"
        >
          <template #attachments>
            <ChatAttachmentBar
              :images="draftImages"
              :docs="attachments"
              :runtime="runtimeMap"
              :busy="Boolean(currentBusy)"
              :vision="vision"
              :model-name="modelName"
              @remove="removeImage"
              @remove-all="removeAllImages"
              @remove-doc="removeDocument"
            />
          </template>
          <template #scope>
            <MemoryScopePicker up :scope="effectiveScope" :documents="props.documents" :memory-ids="memoryIds" :global-has-content="globalHasContent" :disabled="Boolean(currentBusy)" @update:scope="applyScope" @manage="emit('memory')" />
          </template>
          <template #attach>
            <div class="attach-host">
              <button
                type="button"
                class="attach-button"
                :aria-disabled="availability.image.disabled ? 'true' : undefined"
                aria-label="添加图片（也可以 Ctrl+V 粘贴）"
                :data-tip="availability.image.tip"
                @click="pickImages"
              ><AppIcon name="image" :size="16" /></button>
              <input ref="imageInput" class="attach-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" multiple tabindex="-1" aria-hidden="true" @change="pickImagesFromInput" @click="pickerOpen = false" />
            </div>
            <div class="attach-host">
              <button
                ref="libraryButton"
                type="button"
                class="attach-button"
                :aria-disabled="availability.library.disabled ? 'true' : undefined"
                aria-label="从文档库选择文档（本会话有效，最多 3 份）"
                :data-tip="availability.library.tip"
                @click="openPicker"
              ><AppIcon name="library" :size="16" /></button>
              <ChatDocumentPicker
                v-if="pickerOpen"
                :documents="props.libraryDocs || []"
                :attached-ids="attachedDocIds"
                :remaining="Math.max(0, CHAT_ATTACH_LIMITS.docs - docsCount)"
                :limit="CHAT_ATTACH_LIMITS.docs"
                @pick="attachDocuments"
                @close="closePicker"
              />
            </div>
          </template>
        </ChatComposer>
      </div>
      <ChatConversationRail
        v-if="narrow && drawerOpen"
        ref="rail"
        drawer
        :rows="rows"
        :active-id="chat.state.activeId"
        :busy-ids="busyIds"
        @select="selectConversation"
        @create="newConversation"
        @remove="requestRemove"
        @rename="renameConversation"
        @close="closeDrawer"
      />
    </div>
    <ConfirmDialog v-if="confirmRemove" title="删除这段对话？" :message="`「${confirmRemove.title}」会被永久删除。已经写入学习记忆的内容不受影响。`" confirm-label="删除对话" danger @confirm="removeConversation" @cancel="confirmRemove = null" />
  </section>
</template>

<style scoped>
.chat-page { height: 100%; }
.chat-head-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.head-button { display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px; border: 1px solid var(--hairline); border-radius: var(--r-control); background: var(--frost, var(--fill-2)); color: var(--control-ink, var(--ink)); font-size: 12.5px; font-weight: 600; cursor: pointer; }
.head-button:hover { background: var(--frost-hover, var(--fill-3)); }
.chat-status { margin: 0; font-size: 12px; color: var(--muted); }
.chat-layout { flex: 1; min-height: 0; display: flex; gap: 12px; position: relative; }
.chat-main { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 10px; }
.attach-button { width: 30px; height: 30px; display: grid; place-items: center; padding: 0; border: 1px solid var(--hairline); border-radius: var(--r-control); background: none; color: var(--muted); cursor: pointer; }
.attach-button:hover { background: color-mix(in srgb, var(--ink) 7%, transparent); color: var(--ink); }
.attach-button[aria-disabled="true"] { opacity: .45; cursor: default; }
.attach-button[aria-disabled="true"]:hover { background: none; color: var(--muted); }
.attach-file { display: none; }
.attach-host { position: relative; display: inline-flex; }
</style>
