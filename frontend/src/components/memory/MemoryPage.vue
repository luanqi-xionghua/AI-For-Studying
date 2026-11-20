<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DocumentMemory, GlobalMemory, MemoryScope, OnboardingAnswers } from '../../memory/types.ts'
import type { MemoryPatch } from '../../memory/merge.ts'
import {
  memoryState, loadDocumentMemory, loadGlobalMemory, initDocumentMemory, editDocumentMemory, editGlobalMemory,
  summarizeDocumentNow, summarizeGlobalNow, removeMemoryItem, removeMemoryEvidence, unlockMemoryField,
  clearDocumentMemory, clearGlobalMemory, setAutoUpdate, resumeAutoUpdate, cancelMemoryRun,
} from '../../memory'
import { documentTitle } from '../../library/kinds'
import MemorySettingsCard from './MemorySettingsCard.vue'
import GlobalMemoryPanel from './GlobalMemoryPanel.vue'
import DocumentMemoryList from './DocumentMemoryList.vue'
import DocumentMemoryDetail from './DocumentMemoryDetail.vue'
import MemoryEditForm from './MemoryEditForm.vue'
import ConfirmDialog from '../ui/ConfirmDialog.vue'

const props = defineProps<{
  documents: { id: string; title: string; kind: string }[]
  settingsVersion: number
}>()
const emit = defineEmits<{ settings: []; chat: [scope: MemoryScope]; 'open-document': [docId: string]; notify: [text: string] }>()

const tab = ref<'global' | 'doc'>('global')
const selectedId = ref('')
const memory = ref<DocumentMemory | null>(null)
const newer = ref(false)
const editing = ref(false)
const editingGlobal = ref(false)
const editDirty = ref(false)
const editSaving = ref(false)
const initializing = ref(false)
const listRef = ref<{ focusSearch?: () => void }>()
const confirmState = ref<{ title: string; message: string; confirmLabel: string; danger?: boolean; action: () => void | Promise<void> } | null>(null)

const selectedDocument = computed(() => props.documents.find(doc => doc.id === selectedId.value) || null)
const index = computed(() => memoryState.index)
const ready = computed(() => memoryState.ready)
const runningAny = computed(() => Boolean(memoryState.running))
const runningDocId = computed(() => memoryState.running?.kind === 'doc' ? memoryState.running.docId : '')
const globalMemory = computed<GlobalMemory | null>(() => memoryState.global)
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)

async function loadSelected() {
  if (!selectedId.value) { memory.value = null; newer.value = false; return }
  const result = await loadDocumentMemory(selectedId.value)
  memory.value = result.memory
  newer.value = result.newer
}

watch([ready, tab], async ([isReady, current]) => {
  if (!isReady) return
  if (current === 'global') await loadGlobalMemory()
  else if (selectedId.value && !editing.value) await loadSelected()
}, { immediate: true })
watch(() => memoryState.docsVersion, () => { if (tab.value === 'doc' && selectedId.value && !editing.value) void loadSelected() })
watch(() => props.settingsVersion, () => { if (tab.value === 'global') void loadGlobalMemory(); else if (selectedId.value && !editing.value) void loadSelected() })

function function_ask(options: { title: string; message: string; confirmLabel: string; danger?: boolean; action: () => void | Promise<void> }) { confirmState.value = options }
async function runConfirm() { const item = confirmState.value; confirmState.value = null; await item?.action() }
function cancelConfirm() { confirmState.value = null }
function leaveEdit(action: () => void | Promise<void>) {
  if ((!editing.value && !editingGlobal.value) || !editDirty.value) { editing.value = false; editingGlobal.value = false; void action(); return }
  function_ask({ title: '放弃修改？', message: '还没保存的修改会丢失。', confirmLabel: '放弃修改', danger: true, action: async () => { editing.value = false; editingGlobal.value = false; editDirty.value = false; await action() } })
}
function switchTab(next: 'global' | 'doc') {
  if (next === tab.value) return
  leaveEdit(async () => { tab.value = next; if (next === 'global') await loadGlobalMemory(); else if (selectedId.value) await loadSelected() })
}
function selectDocument(docId: string) {
  leaveEdit(async () => { tab.value = 'doc'; selectedId.value = docId; editing.value = false; await loadSelected() })
}
function viewDocument(docId: string) { selectDocument(docId) }
function focusSearch() { tab.value = 'doc'; listRef.value?.focusSearch?.() }
defineExpose({ focusSearch })

function patchOf(value: DocumentMemory): MemoryPatch {
  return {
    summary: value.summary, level: value.profile.level,
    goals: [...value.profile.goals], interests: [...value.profile.interests], strengths: [...value.profile.strengths],
    weaknesses: [...value.profile.weaknesses], misconceptions: [...value.profile.misconceptions], preferences: [...value.profile.preferences],
    questions: [...value.questions], onboarding: value.onboarding ?? undefined,
  }
}
function patchOfGlobal(value: GlobalMemory): MemoryPatch {
  return {
    summary: value.summary, level: value.profile.level,
    goals: [...value.profile.goals], interests: [...value.profile.interests], strengths: [...value.profile.strengths],
    weaknesses: [...value.profile.weaknesses], preferences: [...value.profile.preferences], themes: [...value.themes],
  }
}
const docBaseline = computed<MemoryPatch>(() => memory.value ? patchOf(memory.value) : {})
const globalBaseline = computed<MemoryPatch>(() => globalMemory.value ? patchOfGlobal(globalMemory.value) : {})

function startEditDoc() { if (!memory.value) return; editDirty.value = false; editing.value = true }
function startEditGlobal() { if (!globalMemory.value) return; editDirty.value = false; editingGlobal.value = true }
function cancelEdit() {
  if (!editDirty.value) { editing.value = false; editingGlobal.value = false; return }
  function_ask({ title: '放弃修改？', message: '还没保存的修改会丢失。', confirmLabel: '放弃修改', danger: true, action: () => { editing.value = false; editingGlobal.value = false; editDirty.value = false } })
}
async function saveDocEdit(patch: MemoryPatch) {
  if (!Object.keys(patch).length) { editing.value = false; editDirty.value = false; return }
  if (!memory.value || !selectedId.value) return
  editSaving.value = true
  try {
    const result = await editDocumentMemory(selectedId.value, patch, memory.value.revision)
    memory.value = result.memory
    editing.value = false; editDirty.value = false
    emit('notify', result.merged ? '保存期间记忆被后台更新过：已保留你修改的字段，其余内容是最新结果。' : '已保存。')
  } catch (error) { emit('notify', `保存失败：${messageOf(error)}`) }
  finally { editSaving.value = false }
}
async function saveGlobalEdit(patch: MemoryPatch) {
  if (!Object.keys(patch).length) { editingGlobal.value = false; editDirty.value = false; return }
  if (!globalMemory.value) return
  editSaving.value = true
  try {
    const result = await editGlobalMemory(patch, globalMemory.value.revision)
    editingGlobal.value = false; editDirty.value = false
    emit('notify', result.merged ? '保存期间记忆被后台更新过：已保留你修改的字段，其余内容是最新结果。' : '已保存。')
  } catch (error) { emit('notify', `保存失败：${messageOf(error)}`) }
  finally { editSaving.value = false }
}

async function summarizeDoc(docId: string) {
  if (runningAny.value || !docId) return
  const result = await summarizeDocumentNow(docId)
  if (!result.ok && result.code !== 'aborted') emit('notify', result.message)
  else if (result.ok) await loadSelected()
}
async function summarizeGlobal() {
  if (runningAny.value) return
  const result = await summarizeGlobalNow()
  if (!result.ok && result.code !== 'aborted') emit('notify', result.message)
}
function retryLastRun() {
  const lastRun = memoryState.index.lastRun
  if (!lastRun) return
  if (lastRun.kind === 'doc') void summarizeDoc(lastRun.docId)
  else void summarizeGlobal()
}
async function toggleAuto(value: boolean) { await setAutoUpdate(value) }
async function stopRun() { cancelMemoryRun() }
async function resumeAuto() { await resumeAutoUpdate() }

function requestClearDoc() {
  if (!selectedId.value || !memory.value) return
  const name = documentTitle(selectedDocument.value?.title || memory.value.title)
  function_ask({
    title: `清空《${name}》的记忆？`,
    message: '这本书的导入自评、综述、画像、问题主题、证据和待总结记录都会被删除，无法恢复。文档本身、阅读进度和 AI 对话不受影响。',
    confirmLabel: '清空记忆', danger: true,
    action: async () => {
      try { await clearDocumentMemory(selectedId.value); memory.value = null; newer.value = false; emit('notify', `已清空《${name}》的记忆。`) }
      catch (error) { emit('notify', `清空失败：${messageOf(error)}`) }
    },
  })
}
function requestClearGlobal() {
  function_ask({
    title: '清空全局记忆？',
    message: '跨文档的综述、画像、主题和待总结的对话都会被删除，无法恢复。各本书的文档记忆不受影响；之后可以点「重新总结」重新生成。',
    confirmLabel: '清空全局记忆', danger: true,
    action: async () => {
      try { await clearGlobalMemory(); emit('notify', '已清空全局记忆。') }
      catch (error) { emit('notify', `清空失败：${messageOf(error)}`) }
    },
  })
}
async function initDocument(answers: OnboardingAnswers) {
  if (!selectedDocument.value) return
  initializing.value = true
  try {
    memory.value = await initDocumentMemory(selectedId.value, selectedDocument.value.title, answers)
    newer.value = false
    emit('notify', `已为《${documentTitle(selectedDocument.value.title)}》建立学习记忆。`)
  } catch (error) { emit('notify', `建立记忆失败：${messageOf(error)}`) }
  finally { initializing.value = false }
}
async function removeListItem(target: 'global' | { docId: string }, field: string, text: string) {
  try { await removeMemoryItem(target, field, text); if (target !== 'global') await loadSelected(); emit('notify', `已删除「${text}」，之后的自动总结不会再加回它。`) }
  catch (error) { emit('notify', `删除失败：${messageOf(error)}`) }
}
async function removeEvidence(target: 'global' | { docId: string }, evidenceId: string) {
  try { await removeMemoryEvidence(target, evidenceId); if (target !== 'global') await loadSelected(); emit('notify', '已删除这条证据。') }
  catch (error) { emit('notify', `删除失败：${messageOf(error)}`) }
}
async function unlockField(target: 'global' | { docId: string }, field: 'summary' | 'level') {
  try { await unlockMemoryField(target, field); if (target !== 'global') await loadSelected() }
  catch (error) { emit('notify', `解除锁定失败：${messageOf(error)}`) }
}
</script>

<template>
  <section class="page-view memory-page" aria-label="记忆管理">
    <header class="page-heading">
      <h1>记忆管理</h1>
      <div class="view-switch" role="tablist" aria-label="记忆类型">
        <button type="button" role="tab" :aria-selected="tab === 'global'" :class="{ selected: tab === 'global' }" @click="switchTab('global')">全局记忆</button>
        <button type="button" role="tab" :aria-selected="tab === 'doc'" :class="{ selected: tab === 'doc' }" @click="switchTab('doc')">文档记忆</button>
      </div>
    </header>

    <MemorySettingsCard
      :state="memoryState"
      @settings="emit('settings')"
      @toggle="toggleAuto"
      @stop="stopRun"
      @resume="resumeAuto"
      @retry="retryLastRun"
    />

    <p v-if="!ready" class="page-note" role="status">正在读取学习记忆…</p>
    <p v-else-if="memoryState.error" class="page-warning" role="alert">学习记忆读取失败：{{ memoryState.error }}</p>
    <template v-else>
      <GlobalMemoryPanel
        v-if="tab === 'global' && !editingGlobal"
        :memory="globalMemory"
        :state="memoryState"
        :documents="props.documents"
        @summarize="summarizeGlobal"
        @edit="startEditGlobal"
        @clear="requestClearGlobal"
        @remove-item="(field, text) => removeListItem('global', field, text)"
        @remove-evidence="id => removeEvidence('global', id)"
        @unlock="field => unlockField('global', field)"
        @view-document="viewDocument"
        @chat="scope => emit('chat', scope)"
      />
      <MemoryEditForm
        v-else-if="tab === 'global'"
        :kind="'global'"
        :baseline="globalBaseline"
        :saving="editSaving"
        @save="saveGlobalEdit"
        @cancel="cancelEdit"
        @dirty="value => editDirty = value"
      />
      <div v-else class="memory-doc-layout">
        <DocumentMemoryList
          ref="listRef"
          :documents="props.documents"
          :index="index"
          :running-id="runningDocId"
          :selected-id="selectedId"
          @select="selectDocument"
        />
        <MemoryEditForm
          v-if="editing"
          :kind="'doc'"
          :baseline="docBaseline"
          :saving="editSaving"
          @save="saveDocEdit"
          @cancel="cancelEdit"
          @dirty="value => editDirty = value"
        />
        <DocumentMemoryDetail
          v-else
          :document="selectedDocument"
          :memory="memory"
          :newer="newer"
          :state="memoryState"
          @summarize="summarizeDoc(selectedId)"
          @edit="startEditDoc"
          @clear="requestClearDoc"
          @init="initDocument"
          @remove-item="(field, text) => removeListItem({ docId: selectedId }, field, text)"
          @remove-evidence="id => removeEvidence({ docId: selectedId }, id)"
          @unlock="field => unlockField({ docId: selectedId }, field)"
          @chat="scope => emit('chat', scope)"
          @open-document="id => emit('open-document', id)"
        />
      </div>
    </template>

    <ConfirmDialog
      v-if="confirmState"
      :title="confirmState.title"
      :message="confirmState.message"
      :confirm-label="confirmState.confirmLabel"
      :danger="confirmState.danger"
      @confirm="runConfirm"
      @cancel="cancelConfirm"
    />
  </section>
</template>

<style scoped>
.memory-page { display: flex; flex-direction: column; gap: 14px; }
.memory-doc-layout { display: grid; grid-template-columns: minmax(220px, 300px) minmax(0, 1fr); gap: 14px; min-height: 0; flex: 1; }
@media (max-width: 900px) {
  .memory-doc-layout { grid-template-columns: minmax(0, 1fr); }
  .memory-doc-layout > :first-child { max-height: 40vh; }
}
.memory-page .view-switch { display: flex; gap: 2px; padding: 2px; border-radius: var(--r-control); background: color-mix(in srgb, var(--ink) 5%, transparent); }
.memory-page .view-switch button { width: auto; min-width: 0; padding: 6px 14px; border: 0; border-radius: calc(var(--r-control) - 2px); background: none; box-shadow: none; font-size: 12.5px; font-weight: 600; color: var(--muted); white-space: nowrap; cursor: pointer; }
.memory-page .view-switch button.selected { background: var(--surface, var(--fill-1)); color: var(--ink); box-shadow: var(--shadow-1, 0 1px 2px rgb(0 0 0 / .08)); }
</style>
