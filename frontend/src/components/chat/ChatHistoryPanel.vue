<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { ChatModeIndexEntry } from '../../chat/types.ts'
import { relativeTime } from '../../memory/prompts.ts'
import AppIcon from '../ui/AppIcon.vue'

const props = defineProps<{ list: ChatModeIndexEntry[]; activeId: string; busyIds: Set<string> }>()
const emit = defineEmits<{ select: [id: string]; remove: [id: string]; create: [] }>()
const open = ref(false)
const host = ref<HTMLElement>()
const toggleButton = ref<HTMLButtonElement>()
const shortTitle = (title: string) => title.length > 12 ? `${title.slice(0, 12)}…` : title
const scopeLabel = (entry: ChatModeIndexEntry) => entry.scope.kind === 'none' ? '无记忆' : entry.scope.kind === 'global' ? '全局' : `《${shortTitle(entry.scope.title)}》`
const rows = computed(() => [...props.list].sort((a, b) => b.updatedAt - a.updatedAt))
function select(id: string) { emit('select', id); close() }
function close() { open.value = false; void nextTick(() => toggleButton.value?.focus()) }
watch(open, value => {
  if (value) document.addEventListener('pointerdown', outside, true)
  else document.removeEventListener('pointerdown', outside, true)
})
function outside(event: PointerEvent) { if (!(event.target as Element)?.closest?.('.history-host')) close() }
function keydown(event: KeyboardEvent) { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside, true))
</script>

<template>
  <div ref="host" class="history-host">
    <button ref="toggleButton" type="button" class="history-button" aria-label="对话历史" :aria-expanded="open" @click="open = !open">历史</button>
    <button type="button" class="new-chat" aria-label="新对话" @click="emit('create')">新对话</button>
    <div v-if="open" class="history-pop page-card" role="dialog" aria-label="对话历史" @keydown="keydown">
      <h2>对话历史</h2>
      <p v-if="!rows.length" class="page-note">还没有对话。</p>
      <ul v-else class="history-list">
        <li v-for="entry in rows" :key="entry.id">
          <button type="button" class="history-item" :class="{ active: entry.id === props.activeId }" :aria-current="entry.id === props.activeId ? 'true' : undefined" @click="select(entry.id)">
            <span class="history-title">{{ entry.title || '新对话' }}</span>
            <span class="history-meta">{{ scopeLabel(entry) }} · {{ relativeTime(entry.updatedAt, Date.now()) }} · {{ entry.count }} 问<template v-if="props.busyIds.has(entry.id)"> · 回答中</template></span>
          </button>
          <button type="button" class="history-delete" :aria-label="`删除对话 ${entry.title || '新对话'}`" data-tip="删除这段对话" @click="emit('remove', entry.id)"><AppIcon name="trash" :size="13" /></button>
        </li>
      </ul>
      <p class="history-foot">最多保留最近 40 段对话。</p>
    </div>
  </div>
</template>

<style scoped>
.history-host { position: relative; display: flex; align-items: center; gap: 6px; }
.history-button, .new-chat { padding: 6px 12px; border: 1px solid var(--hairline); border-radius: var(--r-control); background: var(--frost, var(--fill-2)); color: var(--control-ink, var(--ink)); font-size: 12.5px; font-weight: 600; cursor: pointer; }
.new-chat { color: var(--accent); }
.history-pop { position: absolute; right: 0; top: calc(100% + 8px); z-index: 40; width: min(340px, 86vw); max-height: 60vh; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
.history-pop h2 { margin: 0; font-size: 13px; font-weight: 650; }
.history-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.history-list li { display: flex; align-items: center; gap: 2px; }
.history-item { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; padding: 7px 9px; border: 0; border-radius: var(--r-control); background: none; box-shadow: none; text-align: left; cursor: pointer; }
.history-item:hover { background: color-mix(in srgb, var(--ink) 5%, transparent); }
.history-item.active { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.history-title { font-size: 12.5px; font-weight: 600; color: var(--control-ink, var(--ink)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-meta { font-size: 11px; color: var(--muted); }
.history-delete { flex: none; width: 26px; height: 26px; padding: 0; border: 0; border-radius: var(--r-control); background: none; box-shadow: none; color: var(--muted); cursor: pointer; }
.history-delete:hover { background: color-mix(in srgb, var(--danger) 12%, transparent); color: var(--danger); }
.history-foot { margin: 0; font-size: 11px; color: var(--muted); }
</style>
