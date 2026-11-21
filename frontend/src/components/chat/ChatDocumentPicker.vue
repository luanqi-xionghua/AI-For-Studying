<script setup lang="ts">
/** 从文档库多选附件：整会话有效，最多 3 份；已附加与原文件缺失的不可选。 */
import { computed, nextTick, onMounted, ref } from 'vue'
import type { PickableDoc } from '../../chat/attachments.ts'
import AppIcon from '../ui/AppIcon.vue'

const props = defineProps<{
  documents: PickableDoc[]
  attachedIds: string[]
  remaining: number
  limit: number
}>()
const emit = defineEmits<{ pick: [ids: string[]]; close: [] }>()

const query = ref('')
const searchField = ref<HTMLInputElement>()
const selected = ref(new Set<string>())
const kindLabel = (kind: PickableDoc['kind']) => kind === 'pdf' ? 'PDF' : kind === 'markdown' ? 'Markdown' : 'Word'
const normalize = (text: string) => text.toLowerCase().replace(/[\s\u3000]+/g, '')

const rows = computed(() => {
  const needle = normalize(query.value)
  return props.documents
    .filter(doc => !needle || normalize(doc.title || '').includes(needle))
    .map(doc => ({
      doc,
      attached: props.attachedIds.includes(doc.id),
      missing: doc.sourceMissing === true,
    }))
})
const selectedCount = computed(() => selected.value.size)

function disabled(item: { doc: PickableDoc; attached: boolean; missing: boolean }): boolean {
  if (item.attached || item.missing) return true
  return !selected.value.has(item.doc.id) && selectedCount.value >= props.remaining
}
function toggle(id: string, item: { attached: boolean; missing: boolean }) {
  if (item.attached || item.missing) return
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else if (next.size < props.remaining) next.add(id)
  selected.value = next
}
function confirm() {
  const ids = [...selected.value]
  if (!ids.length) { emit('close'); return }
  emit('pick', ids)
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('close') }
}
function meta(item: { doc: PickableDoc; attached: boolean; missing: boolean }): string {
  if (item.attached) return '已在本会话'
  if (item.missing) return '原文件找不到（不可选）'
  const parts = [kindLabel(item.doc.kind)]
  if (item.doc.pageCount && item.doc.pageCount > 0) parts.push(`${item.doc.pageCount} 页`)
  return parts.join(' · ')
}
onMounted(() => { void nextTick(() => searchField.value?.focus()) })
defineExpose({ focusSearch: () => { void nextTick(() => searchField.value?.focus()) } })
</script>

<template>
  <section class="doc-picker page-card" role="dialog" aria-label="从文档库选择" @keydown="keydown">
    <header class="picker-head">
      <h2>从文档库选择（本会话有效，最多 {{ props.limit }} 份）</h2>
      <button type="button" class="icon-button" aria-label="关闭" data-tip="关闭（Esc）" @click="emit('close')"><AppIcon name="close" :size="13" /></button>
    </header>
    <label class="picker-search">
      <AppIcon name="search" :size="13" />
      <input ref="searchField" :value="query" type="search" aria-label="搜索文档名" placeholder="搜索文档名…" @input="query = ($event.target as HTMLInputElement).value" />
    </label>
    <p v-if="!rows.length" class="picker-note" role="status">{{ query.trim() ? `没有找到包含「${query.trim()}」的文档` : '文档库还是空的，先加入文档。' }}</p>
    <ul v-else class="picker-list">
      <li v-for="item in rows" :key="item.doc.id" class="picker-row" :class="{ disabled: disabled(item) }">
        <label class="picker-label">
          <input type="checkbox" :checked="selected.has(item.doc.id)" :disabled="disabled(item)" @change="toggle(item.doc.id, item)" />
          <span class="picker-title">{{ item.doc.title || '未命名文档' }}</span>
          <span class="picker-meta">{{ meta(item) }}</span>
        </label>
      </li>
    </ul>
    <footer class="picker-foot">
      <span class="picker-count">已选 {{ selectedCount }} / 还可选 {{ props.remaining }}</span>
      <span class="picker-space" />
      <button type="button" class="text-button" @click="emit('close')">取消</button>
      <button type="button" class="primary-button" :disabled="!selectedCount" @click="confirm">添加 {{ selectedCount }} 份</button>
    </footer>
  </section>
</template>

<style scoped>
.doc-picker { position: absolute; left: 0; bottom: calc(100% + 8px); z-index: 45; width: min(400px, 86vw); max-height: 52vh; display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; }
.picker-head { display: flex; align-items: center; gap: 8px; }
.picker-head h2 { flex: 1; margin: 0; font-size: 13px; font-weight: 650; }
.icon-button { width: 24px; height: 24px; display: grid; place-items: center; padding: 0; border: 0; border-radius: var(--r-control); background: none; color: var(--muted); cursor: pointer; }
.icon-button:hover { background: color-mix(in srgb, var(--ink) 8%, transparent); color: var(--ink); }
.picker-search { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border: 1px solid var(--hairline); border-radius: var(--r-control); background: var(--frost, var(--fill-2)); color: var(--muted); }
.picker-search input { flex: 1; min-width: 0; border: 0; background: none; color: var(--control-ink, var(--ink)); font: inherit; font-size: 12.5px; outline: none; }
.picker-list { list-style: none; margin: 0; padding: 0; overflow: auto; display: flex; flex-direction: column; gap: 2px; }
.picker-row { border-radius: var(--r-control); }
.picker-row:hover { background: color-mix(in srgb, var(--ink) 4%, transparent); }
.picker-row.disabled { opacity: .55; }
.picker-label { display: flex; align-items: center; gap: 8px; padding: 6px 8px; cursor: pointer; font-size: 12.5px; }
.picker-label input { flex: none; width: 14px; height: 14px; accent-color: var(--accent); }
.picker-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--control-ink, var(--ink)); }
.picker-meta { flex: none; font-size: 11px; color: var(--muted); }
.picker-note { margin: 0; padding: 6px 4px; font-size: 12px; color: var(--muted); }
.picker-foot { display: flex; align-items: center; gap: 8px; }
.picker-count { font-size: 11.5px; color: var(--muted); }
.picker-space { flex: 1; }
.text-button { padding: 4px 8px; border: 0; border-radius: var(--r-control); background: none; color: var(--muted); font-size: 12px; cursor: pointer; }
.text-button:hover { background: color-mix(in srgb, var(--ink) 7%, transparent); color: var(--ink); }
.primary-button { padding: 6px 12px; border: 0; border-radius: var(--r-control); background: var(--accent); color: var(--accent-on, #fff); font-size: 12.5px; font-weight: 600; cursor: pointer; }
.primary-button:disabled { opacity: .45; cursor: default; }
</style>
