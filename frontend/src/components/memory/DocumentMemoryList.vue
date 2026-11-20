<script setup lang="ts">
import { computed, ref } from 'vue'
import type { MemoryIndex } from '../../memory/types.ts'
import { relativeTime } from '../../memory/prompts.ts'

const props = defineProps<{
  documents: { id: string; title: string; kind: string }[]
  index: MemoryIndex
  runningId: string
  selectedId: string
}>()
const emit = defineEmits<{ select: [docId: string] }>()

const search = ref<HTMLInputElement>()
const query = ref('')
const filter = ref<'all' | 'has' | 'none'>('all')
const sort = ref<'updated' | 'title'>('updated')
const FILTERS = [{ key: 'all', label: '全部' }, { key: 'has', label: '有记忆' }, { key: 'none', label: '未初始化' }] as const
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
const now = Date.now()

const indexById = computed(() => new Map(props.index.docs.map(entry => [entry.docId, entry])))
const rows = computed(() => props.documents
  .filter(doc => !query.value.trim() || doc.title.toLowerCase().includes(query.value.trim().toLowerCase()))
  .map(doc => ({ doc, entry: indexById.value.get(doc.id) }))
  .filter(row => filter.value === 'all' || (filter.value === 'has' ? Boolean(row.entry) : !row.entry))
  .sort((a, b) => {
    if (sort.value === 'title') return collator.compare(a.doc.title, b.doc.title)
    if (Boolean(a.entry) !== Boolean(b.entry)) return a.entry ? -1 : 1
    if (a.entry && b.entry) return (b.entry.updatedAt || 0) - (a.entry.updatedAt || 0)
    return collator.compare(a.doc.title, b.doc.title)
  }))

function statusOf(docId: string) {
  const entry = indexById.value.get(docId)
  if (!entry) return { label: '未初始化', time: '' }
  const time = entry.updatedAt ? relativeTime(entry.updatedAt, now) : ''
  if (props.runningId === docId) return { label: '更新中', time }
  if (entry.failed) return { label: '更新失败', time }
  if (entry.pending > 0) return { label: `待更新 ${entry.pending}`, time }
  if (entry.dirty) return { label: '有新的自评', time }
  if (entry.summarizedAt) return { label: '已是最新', time }
  return { label: '尚未总结', time }
}
function move(event: KeyboardEvent, direction: 1 | -1) {
  const list = (event.currentTarget as HTMLElement).closest('ul')
  const buttons = [...(list?.querySelectorAll<HTMLButtonElement>('button.memory-doc-item') || [])]
  const index = buttons.indexOf(event.currentTarget as HTMLButtonElement)
  if (buttons[index + direction]) { event.preventDefault(); buttons[index + direction].focus() }
}
function focusSearch() { search.value?.focus() }
defineExpose({ focusSearch })
</script>

<template>
  <section class="memory-doc-list page-card" aria-label="文档记忆列表">
    <input ref="search" v-model="query" class="memory-search" type="search" aria-label="搜索书名" placeholder="搜索书名" autocomplete="off" />
    <div class="memory-filter" role="tablist" aria-label="记忆筛选">
      <button v-for="item in FILTERS" :key="item.key" type="button" role="tab" :aria-selected="filter === item.key" :class="{ selected: filter === item.key }" @click="filter = item.key">{{ item.label }}</button>
    </div>
    <label class="memory-sort">排序方式<select v-model="sort" aria-label="排序方式"><option value="updated">最近更新</option><option value="title">书名</option></select></label>
    <ul class="memory-doc-items" role="listbox" aria-label="文档记忆">
      <li v-for="row in rows" :key="row.doc.id">
        <button type="button" class="memory-doc-item" :class="{ selected: row.doc.id === props.selectedId }" role="option" :aria-selected="row.doc.id === props.selectedId" :aria-label="`《${row.doc.title}》，${statusOf(row.doc.id).label}`" @click="emit('select', row.doc.id)" @keydown.down="move($event, 1)" @keydown.up="move($event, -1)">
          <span class="memory-doc-title">{{ row.doc.title }}</span>
          <span class="memory-doc-status">{{ statusOf(row.doc.id).label }}<template v-if="statusOf(row.doc.id).time"> · {{ statusOf(row.doc.id).time }}</template></span>
        </button>
      </li>
    </ul>
    <p v-if="!props.documents.length" class="page-note">文档库里还没有文档。先加入文档，记忆会在这里出现。</p>
    <p v-else-if="!rows.length" class="page-note">{{ query.trim() ? `没有名称里带「${query.trim()}」的文档。` : '没有符合条件的文档。' }}</p>
  </section>
</template>

<style scoped>
.memory-doc-list { display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow: auto; }
.memory-search { font: inherit; font-size: 13px; padding: 7px 10px; border: 1px solid var(--hairline); border-radius: var(--r-control); background: var(--control-bg, var(--fill-2)); color: var(--control-ink, var(--ink)); }
.memory-filter { display: flex; gap: 2px; padding: 2px; border-radius: var(--r-control); background: color-mix(in srgb, var(--ink) 5%, transparent); }
.memory-filter button { flex: 1; padding: 5px 8px; border: 0; border-radius: calc(var(--r-control) - 2px); background: none; box-shadow: none; font-size: 12px; font-weight: 600; color: var(--muted); cursor: pointer; }
.memory-filter button.selected { background: var(--surface, var(--fill-1)); color: var(--ink); box-shadow: var(--shadow-1, 0 1px 2px rgb(0 0 0 / .08)); }
.memory-sort { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--muted); }
.memory-sort select { font: inherit; font-size: 12.5px; padding: 4px 8px; border: 1px solid var(--hairline); border-radius: var(--r-control); background: var(--control-bg, var(--fill-2)); color: var(--control-ink, var(--ink)); }
.memory-doc-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.memory-doc-item { display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 7px 10px; border: 0; border-radius: var(--r-control); background: none; box-shadow: none; text-align: left; cursor: pointer; }
.memory-doc-item:hover { background: color-mix(in srgb, var(--ink) 5%, transparent); }
.memory-doc-item.selected { background: color-mix(in srgb, var(--accent) 11%, transparent); }
.memory-doc-title { font-size: 13px; font-weight: 600; color: var(--control-ink, var(--ink)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.memory-doc-status { font-size: 11.5px; color: var(--muted); }
</style>
