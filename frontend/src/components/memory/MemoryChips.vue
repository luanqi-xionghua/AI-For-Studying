<script setup lang="ts">
import AppIcon from '../ui/AppIcon.vue'

const props = withDefaults(defineProps<{
  items: string[]
  label: string
  pinned?: string[]
  removable?: boolean
}>(), { pinned: () => [], removable: true })
const emit = defineEmits<{ remove: [text: string] }>()
</script>

<template>
  <div class="memory-chips" role="list" :aria-label="props.label">
    <span v-for="item in props.items" :key="item" class="memory-chip" role="listitem">
      <AppIcon v-if="props.pinned.includes(item)" name="pin" :size="11" aria-hidden="true" />
      <span class="memory-chip-text">{{ item }}</span>
      <button v-if="props.removable" type="button" class="memory-chip-remove" :aria-label="`删除「${item}」`" @click="emit('remove', item)"><AppIcon name="close" :size="11" /></button>
    </span>
    <span v-if="!props.items.length" class="memory-empty">暂无</span>
  </div>
</template>

<style scoped>
.memory-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.memory-chip { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 3px 5px 3px 9px; border: 1px solid var(--hairline); border-radius: var(--r-full); font-size: 12px; color: var(--secondary); background: color-mix(in srgb, var(--ink) 4%, transparent); }
.memory-chip-text { overflow-wrap: anywhere; }
.memory-chip-remove { display: grid; place-items: center; width: 18px; height: 18px; padding: 0; border: 0; border-radius: var(--r-full); background: none; box-shadow: none; color: var(--muted); cursor: pointer; }
.memory-chip-remove:hover { background: color-mix(in srgb, var(--ink) 9%, transparent); color: var(--ink); }
.memory-empty { font-size: 12px; color: var(--muted); }
</style>
