<script setup lang="ts">
import type { MemoryScope } from '../../memory/types.ts'

defineProps<{
  /** 文档库里的全部文档（与记忆索引左连接，形成「有记忆 / 未初始化」列表）。 */
  documents: { id: string; title: string; kind: string }[]
  /** AI 设置保存或设置窗口关闭后递增，页面据此重新读取记忆预设。 */
  settingsVersion: number
}>()
defineEmits<{ settings: []; chat: [scope: MemoryScope]; 'open-document': [docId: string]; notify: [text: string] }>()

/** M5 实现：把焦点放进书名搜索框。 */
function focusSearch() { /* M5 实现 */ }
defineExpose({ focusSearch })
</script>

<template>
  <section class="page-view memory-page" aria-label="记忆管理">
    <header class="page-heading"><h1>记忆管理</h1></header>
    <p class="page-note">跨文档的总体学习画像，以及每一本书的学习记忆。</p>
    <section class="page-card"><p class="page-note">记忆管理页面正在实现中。</p></section>
  </section>
</template>
