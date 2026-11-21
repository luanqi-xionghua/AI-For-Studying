<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { LiveConversation } from '../../chat/state.ts'
import { citationCount, citationGroups, renderCitations } from '../../chat/citations.ts'
import { relativeTime } from '../../memory/prompts.ts'
import MarkdownAnswer from '../ui/MarkdownAnswer.vue'
import AppIcon from '../ui/AppIcon.vue'

const props = defineProps<{
  conversation: LiveConversation | null
  busy: boolean
  noPreset: boolean
}>()
const emit = defineEmits<{ copy: [text: string]; regenerate: []; example: [text: string]; settings: [] }>()
const EXAMPLES = ['根据我的情况，帮我定一个本周的学习计划', '我最近哪些地方掌握得不牢？出三道题考考我', '用一个生活里的例子解释我上次没弄懂的概念']
const list = ref<HTMLElement>()
const expanded = ref(new Set<string>())
const tick = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
const messages = computed(() => props.conversation?.messages ?? [])
const last = computed(() => messages.value[messages.value.length - 1])
const busyHere = computed(() => Boolean(props.conversation?.request))
const liveStatus = computed(() => busyHere.value ? '正在回答' : last.value?.finishedAt ? '回答完成。' : '')
const lastAssistant = computed(() => [...messages.value].reverse().find(message => message.role === 'assistant'))
const lastFailed = computed(() => Boolean(lastAssistant.value?.failed))
const dark = computed(() => document.documentElement.dataset.theme === 'dark')
const style = computed<'glass' | 'warm' | 'sketch'>(() => {
  const value = document.documentElement.dataset.style
  return value === 'warm' || value === 'sketch' ? value : 'glass'
})
function formatTime(at?: number) { if (!at) return ''; const date = new Date(at); return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` }
function memoryLabel(memory: any) {
  if (memory?.skipped === 'attachments') return '本轮带附件 · 未写入学习记忆'
  if (!memory || memory.kind === 'none') return '未使用记忆'
  const base = memory.kind === 'global' ? '全局记忆' : `《${memory.title || '文档'}》的记忆`
  return memory.injected ? base : `${base}（记忆为空，未注入）`
}
function thinkingSeconds(message: any) {
  if (!message.startedAt) return 0
  const end = message.finishedAt || (busyHere.value ? tick.value : Date.now())
  return Math.max(0, Math.round((end - message.startedAt) / 1000))
}
function toggleThinking(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id); else next.add(id)
  expanded.value = next
}
function copy(text: string) { emit('copy', text) }
const openRefs = ref(new Set<string>())
function toggleRefs(id: string) {
  const next = new Set(openRefs.value)
  if (next.has(id)) next.delete(id); else next.add(id)
  openRefs.value = next
}
/** 回答正文里的 [sourceId] 渲染成「〔《书名》第 N 页〕」；认不出的 id 原样保留。 */
function rendered(message: any) { return renderCitations(message.content, message.refs) }
function messageTitle(aid: string, message: any) {
  return (message.refs?.docs || []).find((doc: any) => doc.aid === aid)?.title || '文档'
}
function progressIcon(status: string) { return status === 'ok' ? '✓' : status === 'failed' ? '✗' : '…' }
function tokenCount(value: number) { return value < 1000 ? String(value) : value < 10000 ? `${(value / 1000).toFixed(1)}k` : `${Math.round(value / 1000)}k` }
function usageText(usage: any) {
  const calls = usage.calls ? `${usage.calls} 次模型调用 · ` : ''
  return `${calls}输入 ${tokenCount(usage.input || 0)} / 输出 ${tokenCount(usage.output || 0)}${usage.estimated ? '（估算）' : ''}`
}
function nearBottom() { const element = list.value; return !element || element.scrollHeight - element.scrollTop - element.clientHeight < 80 }
let follow = true
function onScroll() { if (!list.value) return; follow = nearBottom(); if (props.conversation) props.conversation.scrollTop = list.value.scrollTop }
watch(() => [messages.value.length, last.value?.content, last.value?.reasoning?.length], () => {
  if (!follow) return
  void nextTick(() => { if (list.value) list.value.scrollTop = list.value.scrollHeight })
})
watch(() => props.conversation?.id, () => {
  follow = true
  void nextTick(() => { if (list.value && props.conversation?.scrollTop) list.value.scrollTop = props.conversation.scrollTop })
})
watch(() => props.busy, value => {
  if (value && !timer) timer = setInterval(() => { tick.value = Date.now() }, 250)
  else if (!value && timer) { clearInterval(timer); timer = undefined }
}, { immediate: true })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <div ref="list" class="chat-messages" role="log" aria-live="polite" @scroll="onScroll">
    <p class="visually-hidden" role="status">{{ liveStatus }}</p>
    <div v-if="props.noPreset" class="chat-empty">
      <h2>还没有模型预设</h2>
      <p class="page-note">对话模式需要先在 设置 → AI 里新建一个模型预设。</p>
      <button type="button" class="primary-button" @click="emit('settings')">去 设置 → AI 新建预设</button>
    </div>
    <div v-else-if="!messages.length" class="chat-empty">
      <h2>想聊点什么？</h2>
      <p class="page-note">可以问学习方法、让它出几道练习题，或者聊聊你正在读的书。</p>
      <div class="chat-examples"><button v-for="example in EXAMPLES" :key="example" type="button" @click="emit('example', example)">{{ example }}</button></div>
    </div>
    <template v-else>
    <article v-for="message in messages" :key="message.id" class="chat-turn" :class="message.role">
      <template v-if="message.role === 'user'">
        <div v-if="message.images?.length" class="chat-thumbs">
          <img v-for="(image, index) in message.images" :key="index" :src="image" :alt="`第 ${index + 1} 张图片`" />
        </div>
        <div v-if="message.attach?.docs?.length" class="chat-doc-marks">
          <span v-for="doc in message.attach.docs" :key="doc.aid" class="chat-doc-mark"><AppIcon name="doc" :size="11" />{{ doc.title }}</span>
        </div>
        <div class="chat-bubble" @click="copy(message.content)">{{ message.content }}</div>
        <div class="chat-turn-meta">
          <span>{{ memoryLabel(message.memory) }}</span>
          <span v-if="!message.images?.length && message.attach?.images">曾附 {{ message.attach.images }} 张图片（图片不随记录保存）</span>
          <button type="button" class="icon-button" aria-label="复制问题" data-tip="复制" @click="copy(message.content)"><AppIcon name="copy" :size="13" /></button>
        </div>
      </template>
      <template v-else>
        <p v-if="busyHere && !message.finishedAt && !message.content && !message.reasoning" class="chat-thinking" role="status">
          <span class="thinking-dots" aria-hidden="true"><i /><i /><i /></span>模型正在思考中…
        </p>
        <button v-if="message.reasoning" type="button" class="thinking-toggle" aria-label="展开或收起思考过程" @click="toggleThinking(message.id)">
          <AppIcon name="chevron-right" :size="12" :class="{ open: expanded.has(message.id) }" />
          {{ message.finishedAt ? `已思考 ${thinkingSeconds(message)}s` : `思考中… ${thinkingSeconds(message)}s` }}
        </button>
        <pre v-if="message.reasoning && expanded.has(message.id)" class="thinking-body">{{ message.reasoning }}</pre>
        <div v-if="message.progress?.length" class="doc-progress" aria-label="附件检索进度">
          <span v-for="item in message.progress" :key="item.aid" class="doc-progress-item" :class="item.status">
            <span class="doc-progress-icon" aria-hidden="true">{{ progressIcon(item.status) }}</span>
            {{ messageTitle(item.aid, message) }}<template v-if="item.status === 'ok' && item.evidence"> · 查阅 {{ item.evidence }} 段</template><template v-else-if="item.note">：{{ item.note }}</template>
          </span>
        </div>
        <MarkdownAnswer v-if="message.content" :content="rendered(message)" :finished="Boolean(message.finishedAt)" :dark="dark" :appearance="style" />
        <div v-if="citationCount(message.refs)" class="chat-refs">
          <button type="button" class="text-button" aria-label="展开或收起参考原文" :aria-expanded="openRefs.has(message.id)" @click="toggleRefs(message.id)">
            参考原文 · {{ citationCount(message.refs) }} 段 {{ openRefs.has(message.id) ? '▴' : '▾' }}
          </button>
          <div v-if="openRefs.has(message.id)" class="refs-body">
            <section v-for="group in citationGroups(message.refs)" :key="group.doc.aid">
              <h4>{{ group.doc.title }}</h4>
              <p v-for="item in group.items" :key="item.cite.id">{{ item.label }}<template v-if="item.text"> · {{ item.text }}</template></p>
            </section>
          </div>
        </div>
        <p v-if="message.stopped" class="chat-flag">已停止</p>
        <p v-if="message.failed" class="chat-flag error">未完成{{ message.error ? `：${message.error}` : '' }}</p>
        <div class="chat-turn-meta">
          <button v-if="message.content" type="button" class="text-button" aria-label="复制回答" data-tip="复制回答" @click="copy(message.content)">复制回答</button>
          <button v-if="!props.busy && message === lastAssistant" type="button" class="text-button" aria-label="重新生成" data-tip="重新生成" @click="emit('regenerate')">{{ message.failed ? '重试' : '重新生成' }}</button>
          <span v-if="message.usage" class="chat-usage">{{ usageText(message.usage) }}</span>
          <span class="chat-model">{{ message.model || '' }}<template v-if="message.effort"> · {{ message.effort }}</template></span>
          <span class="chat-time">{{ formatTime(message.finishedAt || message.startedAt) }}</span>
        </div>
      </template>
    </article>
    </template>
    <p v-if="props.conversation?.error && !lastFailed" class="chat-error" role="alert">{{ props.conversation.error }}</p>
    <p v-else-if="lastFailed && props.conversation?.error" class="chat-error" role="alert">{{ props.conversation.error }}</p>
  </div>
</template>

<style scoped>
.chat-messages { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 18px; padding: 6px 2px 10px; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.chat-empty { margin: auto; display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; max-width: 560px; }
.chat-empty h2 { margin: 0; font-size: 20px; font-weight: 650; }
.chat-examples { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
.chat-examples button { padding: 7px 12px; border: 1px solid var(--hairline); border-radius: var(--r-full); background: var(--frost, var(--fill-2)); color: var(--control-ink, var(--ink)); font-size: 12px; cursor: pointer; }
.chat-examples button:hover { background: var(--frost-hover, var(--fill-3)); }
.primary-button { padding: 8px 16px; border: 1px solid transparent; border-radius: var(--r-control); background: var(--accent); color: var(--accent-on, #fff); font-weight: 600; cursor: pointer; }
.chat-turn { display: flex; flex-direction: column; gap: 5px; }
.chat-turn.user { align-items: flex-end; }
.chat-turn.assistant { align-items: stretch; }
.chat-bubble { max-width: min(82%, 640px); padding: 9px 13px; border-radius: 14px; background: color-mix(in srgb, var(--accent) 12%, var(--surface, var(--fill-1))); font-size: 13.5px; line-height: 1.75; color: var(--control-ink, var(--ink)); white-space: pre-wrap; overflow-wrap: anywhere; cursor: default; }
.chat-thumbs { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.chat-thumbs img { width: 56px; height: 56px; object-fit: cover; border: 1px solid var(--hairline); border-radius: var(--r-control); }
.chat-doc-marks { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.chat-doc-mark { display: inline-flex; align-items: center; gap: 3px; padding: 2px 8px; border: 1px solid var(--hairline); border-radius: var(--r-full, 999px); background: var(--frost, var(--fill-2)); font-size: 11px; color: var(--muted); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.doc-progress { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 11.5px; color: var(--muted); }
.doc-progress-item { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; }
.doc-progress-item.ok { color: var(--accent); }
.doc-progress-item.failed { color: var(--danger); }
.doc-progress-icon { width: 12px; text-align: center; }
.chat-refs { display: flex; flex-direction: column; gap: 4px; }
.refs-body { display: flex; flex-direction: column; gap: 8px; padding: 8px 10px; border: 1px solid var(--hairline); border-radius: var(--r-md); background: color-mix(in srgb, var(--ink) 3%, transparent); font-size: 11.5px; line-height: 1.7; color: var(--muted); }
.refs-body h4 { margin: 0; font-size: 12px; color: var(--control-ink, var(--ink)); }
.refs-body p { margin: 2px 0 0; }
.chat-usage { color: var(--muted); }
.chat-turn-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 11.5px; color: var(--muted); }
.chat-turn.user .chat-turn-meta { justify-content: flex-end; }
.chat-thinking { display: inline-flex; align-items: center; gap: 7px; align-self: flex-start; margin: 0; padding: 6px 11px; border-radius: var(--r-full, 999px); background: color-mix(in srgb, var(--ink) 5%, transparent); color: var(--muted); font-size: 12px; }
.thinking-dots { display: inline-flex; align-items: center; gap: 3px; }
.thinking-dots i { width: 4px; height: 4px; border-radius: 50%; background: currentColor; animation: thinking-bounce 1.1s var(--ease-soft, ease-in-out) infinite; }
.thinking-dots i:nth-child(2) { animation-delay: .15s; }
.thinking-dots i:nth-child(3) { animation-delay: .3s; }
@keyframes thinking-bounce { 0%, 60%, 100% { opacity: .35; translate: 0 0; } 30% { opacity: 1; translate: 0 -2px; } }
@media (prefers-reduced-motion: reduce) { .thinking-dots i { animation: none; opacity: .7; } }
.thinking-toggle { align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border: 0; border-radius: var(--r-control); background: color-mix(in srgb, var(--ink) 5%, transparent); color: var(--muted); font-size: 11.5px; cursor: pointer; }
.thinking-toggle svg { transition: transform var(--dur-1) var(--ease-soft); }
.thinking-toggle svg.open { transform: rotate(90deg); }
.thinking-body { margin: 0; padding: 9px 12px; border: 1px solid var(--hairline); border-radius: var(--r-md); background: color-mix(in srgb, var(--ink) 3%, transparent); font-size: 12px; line-height: 1.7; white-space: pre-wrap; color: var(--muted); }
.chat-flag { margin: 0; font-size: 12px; color: var(--muted); }
.chat-flag.error { color: var(--danger); }
.chat-model, .chat-time { margin-left: auto; }
.chat-model + .chat-time { margin-left: 0; }
.chat-error { margin: 0; font-size: 12.5px; color: var(--danger); }
.text-button { border: 0; border-radius: var(--r-control); background: none; box-shadow: none; color: var(--accent); padding: 2px 5px; font-size: 11.5px; cursor: pointer; }
.text-button:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.icon-button { width: 22px; height: 22px; padding: 0; border: 0; border-radius: var(--r-control); background: none; box-shadow: none; color: var(--muted); cursor: pointer; }
.icon-button:hover { background: color-mix(in srgb, var(--ink) 8%, transparent); color: var(--ink); }
</style>
