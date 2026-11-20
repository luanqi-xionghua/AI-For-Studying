<script setup lang="ts">
import type { MemoryScope } from '../../memory/types.ts'

defineProps<{
  /** 文档库里的全部文档（书名用于范围选择）。 */
  documents: { id: string; title: string }[]
  /** AI 设置保存或设置窗口关闭后递增，页面据此重新读取预设。 */
  settingsVersion: number
  /** 从记忆页点「在对话模式中使用」带过来的范围；处理后由页面 emit('scope-applied') 清掉。 */
  initialScope?: MemoryScope | null
}>()
defineEmits<{ settings: []; memory: []; notify: [text: string]; 'scope-applied': [] }>()

/** M6 实现：页面挂载后把焦点放进输入框。 */
function focusPrompt() { /* M6 实现 */ }
defineExpose({ focusPrompt })
</script>

<template>
  <section class="page-view chat-page" aria-label="对话模式">
    <header class="page-heading"><h1>对话模式</h1></header>
    <p class="page-note">不打开文档，直接和模型聊。可以带上学习记忆，让回答更贴合你的情况。</p>
    <section class="page-card"><p class="page-note">对话模式页面正在实现中。</p></section>
  </section>
</template>
