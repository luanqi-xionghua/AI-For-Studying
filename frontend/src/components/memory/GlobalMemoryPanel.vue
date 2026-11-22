<script setup lang="ts">
import { computed } from 'vue'
import type { GlobalMemory, MemoryScope } from '../../memory/types.ts'
import { relativeTime, formatMinute } from '../../memory/prompts.ts'
import AppIcon from '../ui/AppIcon.vue'
import MemoryChips from './MemoryChips.vue'

const props = defineProps<{
  memory: GlobalMemory | null
  state: any
  documents: { id: string; title: string }[]
}>()
const emit = defineEmits<{
  summarize: []
  edit: []
  clear: []
  'remove-item': [field: string, text: string]
  'remove-evidence': [evidenceId: string]
  unlock: [field: 'summary' | 'level']
  'view-document': [docId: string]
  chat: [scope: MemoryScope]
}>()

const running = computed(() => Boolean(props.state?.running))
const configured = computed(() => Boolean(props.state?.config?.configured))
const staleCount = computed(() => Number(props.state?.index?.docUpdatesSinceGlobal || 0))
const globalStale = computed(() => Boolean(props.state?.index?.globalStale))
const docIds = computed(() => new Set(props.documents.map(doc => doc.id)))
const hasContent = computed(() => {
  const memory = props.memory
  if (!memory) return false
  return Boolean(memory.summary || memory.profile.level || memory.themes.length || memory.sources.length ||
    [memory.profile.goals, memory.profile.interests, memory.profile.strengths, memory.profile.weaknesses, memory.profile.preferences].some(list => list.length))
})
const badge = computed(() => {
  const memory = props.memory
  if (props.state?.running?.kind === 'global') return '更新中'
  if (memory?.status.state === 'failed') return '更新失败'
  if ((memory?.pending.length || 0) > 0 || globalStale.value) return '待更新'
  if (memory?.summarizedAt) return '已是最新'
  return '尚未总结'
})
const evidenceLabel: Record<string, string> = { onboarding: '导入', assistant: '阅读助手', chat: '对话模式', reading: '阅读进度', manual: '手动编辑', quiz: '模拟测试' }
</script>

<template>
  <section class="global-memory" aria-label="全局记忆">
    <div class="global-toolbar">
      <span class="memory-badge" :class="{ running: badge === '更新中', failed: badge === '更新失败' }">{{ badge }}</span>
      <div class="global-actions">
        <button type="button" :disabled="running || !configured" :data-tip="configured ? '重新总结全局记忆' : '未配置记忆管理预设'" @click="emit('summarize')">重新总结</button>
        <button type="button" :disabled="running || !hasContent" @click="emit('edit')">编辑</button>
        <button type="button" class="danger-text" :disabled="running || !hasContent" @click="emit('clear')">清空全局记忆</button>
      </div>
    </div>

    <p v-if="globalStale && staleCount" class="memory-warning">有 {{ staleCount }} 本书的记忆在上次全局总结之后更新过。</p>
    <p v-if="props.memory?.removed.length" class="memory-warning">有文档被移除或清空了记忆，全局记忆里可能还留有它们的内容，建议重新总结。</p>

    <section v-if="!hasContent" class="page-card memory-empty-card">
      <h2>全局记忆还是空的</h2>
      <p class="page-note">先在对话模式或阅读助手里聊几轮，或者给文档开启学习模式；有了文档记忆后，这里会自动归纳出总体画像。</p>
      <button type="button" class="primary-button" @click="emit('chat', { kind: 'global' })">去对话模式</button>
    </section>

    <template v-else-if="props.memory">
      <section class="page-card memory-block">
        <div class="memory-block-head"><h2>综述</h2><span v-if="props.memory.manual.locked.summary" class="memory-locked">已手动编辑 · 总结不会改写<button type="button" class="text-button" @click="emit('unlock', 'summary')">解除锁定</button></span></div>
        <p class="memory-text">{{ props.memory.summary || '暂无' }}</p>
      </section>

      <section class="page-card memory-block">
        <h2>画像</h2>
        <div class="memory-profile-row"><strong>目标</strong><MemoryChips :items="props.memory.profile.goals" :pinned="props.memory.manual.pinned.goals" label="目标" @remove="text => emit('remove-item', 'goals', text)" /></div>
        <div class="memory-profile-row"><strong>水平</strong><span class="memory-text">{{ props.memory.profile.level || '暂无' }}</span><span v-if="props.memory.manual.locked.level" class="memory-locked">已手动编辑 · 总结不会改写<button type="button" class="text-button" @click="emit('unlock', 'level')">解除锁定</button></span></div>
        <div class="memory-profile-row"><strong>兴趣</strong><MemoryChips :items="props.memory.profile.interests" :pinned="props.memory.manual.pinned.interests" label="兴趣" @remove="text => emit('remove-item', 'interests', text)" /></div>
        <div class="memory-profile-row"><strong>强项</strong><MemoryChips :items="props.memory.profile.strengths" :pinned="props.memory.manual.pinned.strengths" label="强项" @remove="text => emit('remove-item', 'strengths', text)" /></div>
        <div class="memory-profile-row"><strong>薄弱点</strong><MemoryChips :items="props.memory.profile.weaknesses" :pinned="props.memory.manual.pinned.weaknesses" label="薄弱点" @remove="text => emit('remove-item', 'weaknesses', text)" /></div>
        <div class="memory-profile-row"><strong>偏好</strong><MemoryChips :items="props.memory.profile.preferences" :pinned="props.memory.manual.pinned.preferences" label="偏好" @remove="text => emit('remove-item', 'preferences', text)" /></div>
      </section>

      <section class="page-card memory-block">
        <h2>跨书主题</h2>
        <MemoryChips :items="props.memory.themes" :pinned="props.memory.manual.pinned.themes" label="跨书主题" @remove="text => emit('remove-item', 'themes', text)" />
      </section>

      <section class="page-card memory-block">
        <h2>来源文档</h2>
        <p v-if="!props.memory.sources.length" class="page-note">还没有来源文档。</p>
        <ul v-else class="memory-list">
          <li v-for="source in props.memory.sources" :key="source.docId">
            <div class="memory-list-main">
              <strong v-if="docIds.has(source.docId)">《{{ source.title }}》</strong>
              <strong v-else>《{{ source.title }}》（已移除）</strong>
              <span class="memory-meta">纳入于 {{ relativeTime(source.summarizedAt, Date.now()) }}</span>
              <p v-if="source.note" class="page-note">{{ source.note }}</p>
            </div>
            <button v-if="docIds.has(source.docId)" type="button" class="text-button" @click="emit('view-document', source.docId)">查看这本书的记忆</button>
          </li>
        </ul>
      </section>

      <section class="page-card memory-block">
        <h2>待总结的对话</h2>
        <p class="page-note">{{ props.memory.pending.length ? `${props.memory.pending.length} 条「全局记忆」范围的对话等待总结。` : '没有等待总结的对话。' }}</p>
      </section>

      <section class="page-card memory-block">
        <h2>证据</h2>
        <p v-if="!props.memory.evidence.length" class="page-note">还没有证据。</p>
        <ul v-else class="memory-list">
          <li v-for="item in props.memory.evidence" :key="item.id">
            <div class="memory-list-main">
              <span class="memory-meta">{{ evidenceLabel[item.kind] || item.kind }} · {{ relativeTime(item.at, Date.now()) }}</span>
              <p class="memory-text">{{ item.text }}</p>
            </div>
            <button type="button" class="icon-button" aria-label="删除这条证据" data-tip="删除这条证据" @click="emit('remove-evidence', item.id)"><AppIcon name="trash" :size="14" /></button>
          </li>
        </ul>
      </section>

      <p class="memory-footer">建立于 {{ formatMinute(props.memory.createdAt) }} · 最后变更 {{ relativeTime(props.memory.updatedAt, Date.now()) }} · 上次总结 {{ props.memory.summarizedAt ? relativeTime(props.memory.summarizedAt, Date.now()) : '尚未总结' }}</p>
    </template>
  </section>
</template>

<style scoped>
.global-memory { display: flex; flex-direction: column; gap: 14px; }
.global-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.global-actions { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; }
.global-actions button { padding: 6px 12px; border: 1px solid var(--hairline); border-radius: var(--r-control); background: var(--frost, var(--fill-2)); color: var(--control-ink, var(--ink)); font-size: 12.5px; font-weight: 600; cursor: pointer; }
.global-actions button:disabled { opacity: .45; cursor: default; }
.global-actions .danger-text { color: var(--danger); }
.memory-badge { padding: 2px 9px; border-radius: var(--r-full); font-size: 11.5px; font-weight: 600; color: var(--secondary); background: color-mix(in srgb, var(--ink) 7%, transparent); }
.memory-badge.running { color: var(--accent); }
.memory-badge.failed { color: var(--danger); }
.memory-warning { margin: 0; font-size: 12px; line-height: 1.6; color: var(--warning); }
.memory-block { display: flex; flex-direction: column; gap: 8px; }
.memory-block h2 { margin: 0; font-size: 14.5px; font-weight: 650; color: var(--control-ink, var(--ink)); }
.memory-block-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.memory-empty-card { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
.memory-empty-card h2 { margin: 0; font-size: 17px; }
.memory-text { margin: 0; font-size: 13px; line-height: 1.8; color: var(--secondary); white-space: pre-wrap; overflow-wrap: anywhere; }
.memory-profile-row { display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap; }
.memory-profile-row strong { flex: none; min-width: 44px; font-size: 12.5px; color: var(--muted); font-weight: 600; padding-top: 3px; }
.memory-locked { font-size: 11.5px; color: var(--muted); }
.memory-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.memory-list li { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; border-top: 1px solid var(--line-soft, var(--hairline)); padding-top: 8px; }
.memory-list li:first-child { border-top: 0; padding-top: 0; }
.memory-list-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.memory-list-main strong { font-size: 13px; font-weight: 600; color: var(--control-ink, var(--ink)); }
.memory-meta { font-size: 11.5px; color: var(--muted); }
.memory-footer { margin: 0; font-size: 11.5px; color: var(--muted); }
.text-button { border: 0; border-radius: var(--r-control); background: none; box-shadow: none; color: var(--accent); padding: 2px 6px; font-size: 12px; cursor: pointer; }
.text-button:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.primary-button { align-self: flex-start; padding: 8px 16px; border: 1px solid transparent; border-radius: var(--r-control); background: var(--accent); color: var(--accent-on, #fff); font-weight: 600; cursor: pointer; }
.icon-button { width: 26px; height: 26px; padding: 0; border: 0; border-radius: var(--r-control); background: none; box-shadow: none; color: var(--muted); cursor: pointer; }
.icon-button:hover { background: color-mix(in srgb, var(--ink) 8%, transparent); color: var(--ink); }
</style>
