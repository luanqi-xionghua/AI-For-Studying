<script setup lang="ts">
/** 输入框上方的附件预览条：图片缩略图、预算、不识图警示。文档 chip 在 M4 接入。 */
import AppIcon from '../ui/AppIcon.vue'
import { imageBudgetText } from '../../chat/images.ts'

const props = defineProps<{
  images: string[]
  busy: boolean
  vision: boolean
  modelName?: string
}>()
const emit = defineEmits<{ remove: [index: number]; removeAll: [] }>()

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
  <div v-if="props.images.length || !props.vision" class="attachment-bar">
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
.image-strip { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.image-chip { position: relative; margin: 0; width: 44px; height: 44px; border: 1px solid var(--hairline); border-radius: var(--r-control); overflow: hidden; background: var(--frost, var(--fill-2)); }
.image-chip img { width: 100%; height: 100%; object-fit: cover; display: block; }
.chip-remove { position: absolute; top: 1px; right: 1px; width: 16px; height: 16px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%; background: color-mix(in srgb, #000 55%, transparent); color: #fff; cursor: pointer; }
.chip-remove[aria-disabled="true"] { opacity: .4; cursor: default; }
.image-budget { font-size: 11px; color: var(--muted); white-space: nowrap; }
.bar-warning { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin: 0; font-size: 11.5px; line-height: 1.5; color: var(--warning, #b06b00); }
.text-button { padding: 0 2px; border: 0; border-radius: 4px; background: none; color: var(--accent); font: inherit; cursor: pointer; text-decoration: underline; }
.text-button[aria-disabled="true"] { opacity: .5; cursor: default; text-decoration: none; }
</style>
