<script setup lang="ts">
/**
 * 对话页内部的会话附属栏：新建、搜索、切换、重命名、删除、回答中标记。
 * 宽窗口常驻（可收起），窄窗口以抽屉覆盖在对话区上方。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { relativeTime } from '../../memory/prompts.ts'
import { filterConversations, type ChatRailRow } from '../../chat/rail.ts'
import AppIcon from '../ui/AppIcon.vue'

const props = defineProps<{
  rows: ChatRailRow[]
  activeId: string
  busyIds: Set<string>
  drawer?: boolean
}>()
const emit = defineEmits<{
  select: [id: string]
  create: []
  remove: [id: string]
  rename: [id: string, title: string]
  collapse: []
  close: []
}>()

const TITLE_LIMIT = 28
const query = ref('')
const renamingId = ref('')
const draftTitle = ref('')
const tick = ref(Date.now())
const focusIndex = ref(0)
const searchField = ref<HTMLInputElement>()
const renameField = ref<HTMLInputElement>()
const rowEls = new Map<string, HTMLButtonElement>()

const visible = computed(() => filterConversations(props.rows, query.value))
const searching = computed(() => Boolean(query.value.trim()))
const titleOf = (row: ChatRailRow) => row.draft ? '新对话 · 未开始' : (row.title || '新对话')
const timeOf = (row: ChatRailRow) => row.draft ? '未开始' : relativeTime(row.updatedAt, tick.value)
const tabIndexOf = (row: ChatRailRow) => visible.value.indexOf(row) === focusIndex.value ? 0 : -1

function setRowEl(id: string, el: unknown) {
  if (el instanceof HTMLButtonElement) rowEls.set(id, el)
  else rowEls.delete(id)
}
function setRenameField(el: unknown) { renameField.value = el instanceof HTMLInputElement ? el : undefined }

function rowIndexOf(id: string) { return visible.value.findIndex(row => row.id === id) }
function focusRow(id: string) {
  const index = rowIndexOf(id)
  if (index < 0) return
  focusIndex.value = index
  void nextTick(() => rowEls.get(id)?.focus())
}
function moveTo(index: number) {
  const row = visible.value[Math.min(visible.value.length - 1, Math.max(0, index))]
  if (row) focusRow(row.id)
}
function select(row: ChatRailRow) {
  if (row.draft) return
  emit('select', row.id)
}
async function startRename(row: ChatRailRow) {
  if (row.draft) return
  renamingId.value = row.id
  draftTitle.value = row.title
  await nextTick()
  renameField.value?.focus()
  renameField.value?.select()
}
function commitRename(row: ChatRailRow, refocus = false) {
  if (renamingId.value !== row.id) return
  renamingId.value = ''
  const value = draftTitle.value.trim()
  if (value !== row.title) emit('rename', row.id, value)
  // 只有显式按 Enter 才把焦点放回该行；失焦提交时不要再抢焦点（用户可能点了别的行）。
  if (refocus) focusRow(row.id)
}
function cancelRename() {
  const id = renamingId.value
  renamingId.value = ''
  if (id) focusRow(id)
}
function onRowKeydown(event: KeyboardEvent, row: ChatRailRow, index: number) {
  if (event.key === 'ArrowDown') { event.preventDefault(); moveTo(index + 1) }
  else if (event.key === 'ArrowUp') { event.preventDefault(); moveTo(index - 1) }
  else if (event.key === 'Home') { event.preventDefault(); moveTo(0) }
  else if (event.key === 'End') { event.preventDefault(); moveTo(visible.value.length - 1) }
  else if (event.key === 'F2') { event.preventDefault(); void startRename(row) }
  else if (event.key === 'Delete') { event.preventDefault(); emit('remove', row.id) }
}
function onRootKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !props.drawer || renamingId.value) return
  event.preventDefault()
  event.stopPropagation()
  emit('close')
}
function onSearchKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !query.value) return
  event.preventDefault()
  event.stopPropagation()
  query.value = ''
}

let timer: ReturnType<typeof setInterval> | undefined
function startTimer() { stopTimer(); timer = setInterval(() => { tick.value = Date.now() }, 60000) }
function stopTimer() { if (timer) { clearInterval(timer); timer = undefined } }
function onVisibility() {
  if (document.hidden) { stopTimer(); return }
  tick.value = Date.now()
  startTimer()
}

watch(() => props.rows.map(row => row.id).join(','), () => {
  if (focusIndex.value > visible.value.length - 1) focusIndex.value = Math.max(0, visible.value.length - 1)
})
// 搜索结果变化后 roving tabindex 回到第一行，避免焦点索引指向被过滤掉的行。
watch(query, () => { focusIndex.value = 0 })
watch(() => visible.value.length, length => {
  if (focusIndex.value > length - 1) focusIndex.value = Math.max(0, length - 1)
})
watch(() => props.activeId, id => {
  const index = rowIndexOf(id)
  if (index >= 0) focusIndex.value = index
}, { immediate: true })

onMounted(() => {
  startTimer()
  document.addEventListener('visibilitychange', onVisibility)
  if (props.drawer) void nextTick(() => searchField.value?.focus())
})
onBeforeUnmount(() => {
  stopTimer()
  document.removeEventListener('visibilitychange', onVisibility)
})

defineExpose({
  focusSearch: () => { void nextTick(() => searchField.value?.focus()) },
  focusActive: () => { if (props.activeId) focusRow(props.activeId) },
})
</script>

<template>
  <div v-if="props.drawer" class="rail-backdrop" aria-hidden="true" @click="emit('close')" />
  <nav
    class="chat-rail"
    :class="{ drawer: props.drawer }"
    :role="props.drawer ? 'dialog' : undefined"
    :aria-modal="props.drawer ? 'true' : undefined"
    aria-label="对话列表"
    @keydown="onRootKeydown"
  >
    <div class="rail-head">
      <button type="button" class="rail-new" aria-label="新对话" @click="emit('create')"><AppIcon name="plus" :size="14" />新对话</button>
      <button v-if="props.drawer" type="button" class="rail-icon" aria-label="关闭对话列表" data-tip="关闭" @click="emit('close')"><AppIcon name="close" :size="14" /></button>
      <button v-else type="button" class="rail-icon" aria-label="收起对话列表" data-tip="收起" @click="emit('collapse')"><AppIcon name="arrow" :size="14" /></button>
    </div>
    <label class="rail-search">
      <AppIcon name="search" :size="13" />
      <input
        ref="searchField"
        :value="query"
        type="search"
        aria-label="搜索对话标题"
        placeholder="搜索对话标题…"
        @input="query = ($event.target as HTMLInputElement).value"
        @keydown="onSearchKeydown"
      />
    </label>
    <p v-if="searching && !visible.length" class="rail-note" role="status">没有找到包含「{{ query.trim() }}」的对话</p>
    <p v-else-if="!visible.length" class="rail-note">还没有对话。</p>
    <ul v-else class="rail-list" aria-label="对话">
      <li v-for="(row, index) in visible" :key="row.id" class="rail-item">
        <template v-if="renamingId === row.id">
          <input
            :ref="setRenameField"
            class="rail-rename"
            :value="draftTitle"
            :maxlength="TITLE_LIMIT"
            :aria-label="`重命名「${titleOf(row)}」`"
            @input="draftTitle = ($event.target as HTMLInputElement).value"
            @keydown.enter.prevent="commitRename(row, true)"
            @keydown.esc.prevent.stop="cancelRename()"
            @blur="commitRename(row)"
          />
          <span class="rail-count">{{ draftTitle.length }}/{{ TITLE_LIMIT }}</span>
        </template>
        <template v-else>
          <button
            :ref="el => setRowEl(row.id, el)"
            type="button"
            class="rail-row"
            :class="{ active: row.id === props.activeId, draft: row.draft }"
            :aria-current="row.id === props.activeId ? 'true' : undefined"
            :tabindex="tabIndexOf(row)"
            @focus="focusIndex = index"
            @click="select(row)"
            @keydown="onRowKeydown($event, row, index)"
          >
            <span class="rail-title">{{ titleOf(row) }}</span>
            <span class="rail-meta">
              <span>{{ timeOf(row) }}</span>
              <span v-if="props.busyIds.has(row.id)" class="rail-busy"><span class="rail-dot" aria-hidden="true" />回答中</span>
            </span>
          </button>
          <div class="rail-actions">
            <button v-if="!row.draft" type="button" class="rail-icon" :aria-label="`重命名「${titleOf(row)}」`" data-tip="重命名（F2）" @click="startRename(row)"><AppIcon name="edit" :size="13" /></button>
            <button type="button" class="rail-icon danger" :aria-label="`删除「${titleOf(row)}」`" data-tip="删除这段对话" @click="emit('remove', row.id)"><AppIcon name="trash" :size="13" /></button>
          </div>
        </template>
      </li>
    </ul>
    <p class="rail-foot">最多保留最近 40 段对话</p>
  </nav>
</template>

<style scoped>
.chat-rail { flex: 0 0 clamp(220px, 24%, 280px); max-width: 280px; min-height: 0; display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--hairline); border-radius: var(--r-xl); background: color-mix(in srgb, var(--ink) 3%, transparent); overflow: auto; }
.rail-head { display: flex; align-items: center; gap: 6px; }
.rail-new { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 7px 10px; border: 1px solid var(--hairline); border-radius: var(--r-control); background: var(--frost, var(--fill-2)); color: var(--accent); font-size: 12.5px; font-weight: 600; cursor: pointer; }
.rail-new:hover { background: var(--frost-hover, var(--fill-3)); }
.rail-icon { flex: none; width: 26px; height: 26px; display: grid; place-items: center; padding: 0; border: 0; border-radius: var(--r-control); background: none; color: var(--muted); cursor: pointer; }
.rail-icon:hover { background: color-mix(in srgb, var(--ink) 8%, transparent); color: var(--ink); }
.rail-icon.danger:hover { background: color-mix(in srgb, var(--danger) 12%, transparent); color: var(--danger); }
.rail-search { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border: 1px solid var(--hairline); border-radius: var(--r-control); background: var(--frost, var(--fill-2)); color: var(--muted); }
.rail-search input { flex: 1; min-width: 0; border: 0; background: none; color: var(--control-ink, var(--ink)); font: inherit; font-size: 12.5px; outline: none; }
.rail-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.rail-item { display: flex; align-items: center; gap: 2px; }
.rail-row { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; border: 1px solid transparent; border-radius: var(--r-control); background: none; box-shadow: none; text-align: left; cursor: pointer; }
.rail-row:hover { background: color-mix(in srgb, var(--ink) 5%, transparent); }
.rail-row.active { background: color-mix(in srgb, var(--accent) 11%, transparent); }
.rail-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.rail-row.draft { cursor: default; }
.rail-title { font-size: 12.5px; font-weight: 600; color: var(--control-ink, var(--ink)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rail-row.draft .rail-title { color: var(--muted); font-weight: 500; }
.rail-meta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); }
.rail-busy { display: inline-flex; align-items: center; gap: 3px; color: var(--accent); }
.rail-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.rail-actions { flex: none; display: flex; align-items: center; }
.rail-rename { flex: 1; min-width: 0; padding: 5px 7px; border: 1px solid var(--accent); border-radius: var(--r-control); background: var(--surface, var(--fill-1)); color: var(--control-ink, var(--ink)); font: inherit; font-size: 12.5px; }
.rail-count { flex: none; font-size: 10.5px; color: var(--muted); }
.rail-note { margin: 0; padding: 6px 8px; font-size: 11.5px; color: var(--muted); }
.rail-foot { margin: auto 0 0; padding-top: 6px; font-size: 10.5px; color: var(--muted); }
.rail-backdrop { position: absolute; inset: 0; z-index: 30; background: color-mix(in srgb, #000 30%, transparent); }
.chat-rail.drawer { position: absolute; inset: 0 auto 0 0; z-index: 31; width: min(300px, 84%); max-width: 300px; border-radius: 0 var(--r-xl) var(--r-xl) 0; background: var(--surface, var(--fill-1)); box-shadow: var(--shadow-2); animation: rail-in var(--dur-2, .18s) var(--ease-soft, ease-out); }
@keyframes rail-in { from { transform: translateX(-14px); opacity: .4; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .chat-rail.drawer { animation: none; } }
@media (forced-colors: active) { .rail-row.active { border-color: CanvasText; } }
</style>
