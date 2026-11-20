<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { MemoryScope } from '../../memory/types.ts'
import AppIcon from '../ui/AppIcon.vue'

const props = defineProps<{
  scope: MemoryScope
  documents: { id: string; title: string }[]
  memoryIds: Set<string>
  globalHasContent: boolean
  disabled: boolean
  /** 放在输入栏时向上展开，避免弹层被窗口底部截断。 */
  up?: boolean
}>()
const emit = defineEmits<{ 'update:scope': [scope: MemoryScope]; manage: [] }>()
const open = ref(false)
const button = ref<HTMLButtonElement>()
const search = ref<HTMLInputElement>()
const query = ref('')
const optionList = ref<HTMLElement>()
const shortTitle = (title: string) => title.length > 16 ? `${title.slice(0, 16)}…` : title
const label = computed(() => props.scope.kind === 'none' ? '记忆范围：不使用记忆'
  : props.scope.kind === 'global' ? '记忆范围：全局记忆'
    : `记忆范围：《${shortTitle(props.scope.title || '')}》`)
const rows = computed(() => props.documents
  .filter(doc => !query.value.trim() || doc.title.toLowerCase().includes(query.value.trim().toLowerCase()))
  .map(doc => ({ doc, hasMemory: props.memoryIds.has(doc.id) }))
  .sort((a, b) => (Number(b.hasMemory) - Number(a.hasMemory)) || a.doc.title.localeCompare(b.doc.title, 'zh-CN')))
function choose(scope: MemoryScope) { emit('update:scope', scope); close() }
function close() { open.value = false; void nextTick(() => button.value?.focus()) }
function toggle() { if (props.disabled) return; open.value = !open.value }
watch(open, value => {
  if (value) {
    query.value = ''
    void nextTick(() => search.value?.focus())
    document.addEventListener('pointerdown', outside, true)
  } else document.removeEventListener('pointerdown', outside, true)
})
function outside(event: PointerEvent) { if (!(event.target as Element)?.closest?.('.scope-host')) close() }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const options = [...(optionList.value?.querySelectorAll<HTMLButtonElement>('[role="option"]') || [])]
    const index = options.indexOf(document.activeElement as HTMLButtonElement)
    const next = options[(index + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % Math.max(1, options.length)]
    next?.focus()
  }
}
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside, true))
</script>

<template>
  <div class="scope-host">
    <button ref="button" type="button" class="scope-button" :disabled="props.disabled" aria-label="选择记忆范围" :aria-expanded="open" @click="toggle">{{ label }}<AppIcon name="down" :size="12" /></button>
    <div v-if="open" class="scope-pop page-card" :class="{ up: props.up }" role="dialog" aria-label="选择记忆范围" @keydown="keydown">
      <h2>这段对话使用哪份记忆？</h2>
      <input ref="search" v-model="query" class="scope-search" type="search" aria-label="搜索书名" placeholder="搜索书名" autocomplete="off" />
      <div ref="optionList" class="scope-options" role="listbox" aria-label="记忆范围">
        <button type="button" role="option" :aria-selected="props.scope.kind === 'none'" class="scope-option" @click="choose({ kind: 'none' })">
          <span><strong>不使用记忆</strong><small>不读取也不写入任何学习记忆。</small></span>
        </button>
        <button type="button" role="option" :aria-selected="props.scope.kind === 'global'" class="scope-option" @click="choose({ kind: 'global' })">
          <span><strong>全局记忆</strong><small>跨文档的总体画像；这段对话也会用来更新它。</small></span>
          <em>{{ props.globalHasContent ? '有内容' : '还是空的' }}</em>
        </button>
        <p class="scope-group">某本书的记忆</p>
        <p v-if="!props.documents.length" class="page-note">文档库里还没有文档。</p>
        <p v-else-if="!rows.length" class="page-note">没有名称里带「{{ query.trim() }}」的文档。</p>
        <button v-for="row in rows" :key="row.doc.id" type="button" role="option" :aria-selected="props.scope.kind === 'doc' && props.scope.docId === row.doc.id" class="scope-option" @click="choose({ kind: 'doc', docId: row.doc.id, title: row.doc.title })">
          <span><strong>{{ row.doc.title }}</strong></span>
          <em>{{ row.hasMemory ? '有记忆' : '暂无记忆' }}</em>
        </button>
      </div>
      <button type="button" class="scope-manage" @click="close(); emit('manage')">管理记忆…</button>
    </div>
  </div>
</template>

<style scoped>
.scope-host { position: relative; }
.scope-button { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid var(--hairline); border-radius: var(--r-control); background: var(--frost, var(--fill-2)); color: var(--control-ink, var(--ink)); font-size: 12.5px; font-weight: 600; cursor: pointer; }
.scope-button:disabled { opacity: .5; cursor: default; }
.scope-pop { position: absolute; right: 0; top: calc(100% + 8px); z-index: 40; width: min(360px, 86vw); display: flex; flex-direction: column; gap: 8px; max-height: 60vh; overflow: auto; }
.scope-pop.up { top: auto; right: auto; left: 0; bottom: calc(100% + 8px); }
.scope-pop h2 { margin: 0; font-size: 13px; font-weight: 650; }
.scope-search { font: inherit; font-size: 13px; padding: 7px 10px; border: 1px solid var(--hairline); border-radius: var(--r-control); background: var(--control-bg, var(--fill-2)); color: var(--control-ink, var(--ink)); }
.scope-options { display: flex; flex-direction: column; gap: 2px; }
.scope-option { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 7px 9px; border: 1px solid transparent; border-radius: var(--r-control); background: none; box-shadow: none; text-align: left; cursor: pointer; }
.scope-option:hover { background: color-mix(in srgb, var(--ink) 5%, transparent); }
.scope-option[aria-selected='true'] { border-color: var(--hairline); background: color-mix(in srgb, var(--accent) 9%, transparent); }
.scope-option span { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.scope-option strong { font-size: 12.5px; font-weight: 600; color: var(--control-ink, var(--ink)); }
.scope-option small { font-size: 11.5px; color: var(--muted); }
.scope-option em { flex: none; font-style: normal; font-size: 11px; color: var(--muted); }
.scope-group { margin: 6px 0 0; font-size: 11px; font-weight: 600; color: var(--muted); }
.scope-manage { align-self: flex-start; border: 0; background: none; box-shadow: none; padding: 2px 4px; color: var(--accent); font-size: 12px; cursor: pointer; }
</style>
