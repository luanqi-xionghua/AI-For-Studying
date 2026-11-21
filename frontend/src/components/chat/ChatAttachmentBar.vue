<script setup lang="ts">
/** 输入框上方的附件预览条：文档 chip（状态、移除）、图片缩略图、预算与不识图警示。 */
import AppIcon from '../ui/AppIcon.vue'
import { imageBudgetText } from '../../chat/images.ts'
import type { ChatDocAttachment } from '../../chat/types.ts'
import type { ChatDocRuntime } from '../../chat/state.ts'

const props = defineProps<{
  images: string[]
  docs: ChatDocAttachment[]
  runtime: Map<string, ChatDocRuntime>
  busy: boolean
  vision: boolean
  modelName?: string
}>()
const emit = defineEmits<{
  remove: [index: number]
  removeAll: []
  removeDoc: [aid: string]
}>()

const titleOf = (doc: ChatDocAttachment) => props.runtime.get(doc.id)?.name || doc.title
function statusOf(doc: ChatDocAttachment): { tone: 'ok' | 'warn' | 'bad'; text: string } {
  const runtime = props.runtime.get(doc.id)
  const status = runtime?.status || 'ready'
  if (status === 'ready') return { tone: 'ok', text: '' }
  if (status === 'preparing') return { tone: 'warn', text: '转换中…' }
  if (status === 'removed') return { tone: 'warn', text: '已从文档库移除' }
  if (status === 'missing' || status === 'stale') return { tone: 'warn', text: '原文件找不到' }
  if (status === 'expired') return { tone: 'bad', text: '已失效（重开应用后需重新上传）' }
  return { tone: 'warn', text: runtime?.error || '读取失败' }
}
function removeDoc(aid: string) {
  if (props.busy) return
  emit('removeDoc', aid)
}
function remove(index: number) {
  if (props.busy) return
  emit('remove', index)
}
function removeAll() {
  if (props.busy) return
  emit('removeAll')
}
</script>

<template>
  <div v-if="props.docs.length || props.images.length || !props.vision" class="attachment-bar">
    <div v-if="props.docs.length" class="doc-chips">
      <span v-for="doc in props.docs" :key="doc.id" class="doc-chip" :class="statusOf(doc).tone">
        <span class="doc-name">{{ titleOf(doc) }}</span>
        <span v-if="doc.source === 'temp'" class="doc-tag">临时</span>
        <span v-if="statusOf(doc).text" class="doc-status">{{ statusOf(doc).text }}</span>
        <button type="button" class="chip-close" :aria-label="`移除附件《${titleOf(doc)}》`" :aria-disabled="props.busy ? 'true' : undefined" data-tip="移除" @click="removeDoc(doc.id)"><AppIcon name="close" :size="10" /></button>
      </span>
    </div>
    <div v-if="props.images.length" class="image-strip">
      <figure v-for="(image, index) in props.images" :key="index" class="image-chip">
        <img :src="image" :alt="`第 ${index + 1} 张图片`" />
        <button type="button" class="chip-remove" :aria-label="`移除第 ${index + 1} 张图片`" :aria-disabled="props.busy ? 'true' : undefined" data-tip="移除这张图片" @click="remove(index)"><AppIcon name="close" :size="10" /></button>
      </figure>
      <span class="image-budget">{{ imageBudgetText(props.images) }}</span>
    </div>
    <p v-if="!props.vision" class="bar-warning">
      ⚠ 当前模型{{ props.modelName ? `「${props.modelName}」` : '' }}不支持图片。
      <template v-if="props.images.length">
        <button type="button" class="text-button" :aria-disabled="props.busy ? 'true' : undefined" @click="removeAll">移除全部图片</button>
        或
      </template>
      在模型按钮里换识图模型
    </p>
  </div>
</template>

<style scoped>
.attachment-bar { display: flex; flex-direction: column; gap: 6px; }
.doc-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.doc-chip { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 3px 4px 3px 9px; border: 1px solid var(--hairline); border-radius: var(--r-full, 999px); background: var(--frost, var(--fill-2)); font-size: 11.5px; color: var(--control-ink, var(--ink)); }
.doc-chip.warn { border-color: color-mix(in srgb, var(--warning, #b06b00) 45%, transparent); }
.doc-chip.bad { border-color: color-mix(in srgb, var(--danger) 50%, transparent); color: var(--danger); }
.doc-name { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.doc-tag { padding: 0 4px; border-radius: 4px; background: color-mix(in srgb, var(--ink) 8%, transparent); font-size: 10px; color: var(--muted); }
.doc-status { color: var(--muted); }
.doc-chip.warn .doc-status { color: var(--warning, #b06b00); }
.doc-chip.bad .doc-status { color: var(--danger); }
.chip-close { flex: none; width: 15px; height: 15px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%; background: none; color: var(--muted); cursor: pointer; }
.chip-close:hover { background: color-mix(in srgb, var(--ink) 10%, transparent); color: var(--ink); }
.image-strip { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.image-chip { position: relative; margin: 0; width: 44px; height: 44px; border: 1px solid var(--hairline); border-radius: var(--r-control); overflow: hidden; background: var(--frost, var(--fill-2)); }
.image-chip img { width: 100%; height: 100%; object-fit: cover; display: block; }
.chip-remove { position: absolute; top: 1px; right: 1px; width: 16px; height: 16px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%; background: color-mix(in srgb, #000 55%, transparent); color: #fff; cursor: pointer; }
.chip-remove[aria-disabled="true"], .chip-close[aria-disabled="true"] { opacity: .4; cursor: default; }
.image-budget { font-size: 11px; color: var(--muted); white-space: nowrap; }
.bar-warning { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin: 0; font-size: 11.5px; line-height: 1.5; color: var(--warning, #b06b00); }
.text-button { padding: 0 2px; border: 0; border-radius: 4px; background: none; color: var(--accent); font: inherit; cursor: pointer; text-decoration: underline; }
.text-button[aria-disabled="true"] { opacity: .5; cursor: default; text-decoration: none; }
</style>
