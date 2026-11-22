<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { DocumentMemory, MemoryScope, OnboardingAnswers, SelfLevel } from '../../memory/types.ts'
import { DOC_LEVEL_LABELS, FIELD_LEVEL_LABELS, relativeTime, formatMinute, formatDay } from '../../memory/prompts.ts'
import { documentTitle } from '../../library/kinds'
import AppIcon from '../ui/AppIcon.vue'
import OnboardingFields from './OnboardingFields.vue'
import MemoryChips from './MemoryChips.vue'

const props = defineProps<{
  document: { id: string; title: string; kind: string } | null
  memory: DocumentMemory | null
  newer: boolean
  state: any
}>()
const emit = defineEmits<{
  summarize: []
  edit: []
  clear: []
  init: [answers: OnboardingAnswers]
  'remove-item': [field: string, text: string]
  'remove-evidence': [evidenceId: string]
  unlock: [field: 'summary' | 'level']
  chat: [scope: MemoryScope]
  'open-document': [docId: string]
}>()

const running = computed(() => Boolean(props.state?.running))
const configured = computed(() => Boolean(props.state?.config?.configured))
const runningHere = computed(() => props.state?.running?.kind === 'doc' && props.state?.running?.docId === props.document?.id)
const docId = computed(() => props.document?.id || '')
const title = computed(() => props.document ? documentTitle(props.document.title) : '')
const evidenceLabel: Record<string, string> = { onboarding: '导入', assistant: '阅读助手', chat: '对话模式', reading: '阅读进度', manual: '手动编辑', quiz: '模拟测试' }
const status = computed(() => {
  const memory = props.memory
  if (!memory) return '未初始化'
  if (runningHere.value) return '正在更新…'
  if (memory.status.state === 'failed') return `上次更新失败：${memory.status.error}`
  if (memory.pending.length) return `待更新 · ${memory.pending.length} 条新记录`
  if (memory.dirty) return '待更新 · 有新的自评'
  if (memory.summarizedAt) return `已是最新 · 上次更新 ${relativeTime(memory.summarizedAt, Date.now())}`
  return '尚未总结'
})
const readingText = computed(() => {
  const memory = props.memory
  if (!memory) return ''
  const reading = memory.reading
  if (!reading.sessions) return '还没有阅读记录。'
  const parts: string[] = []
  if (props.document?.kind !== 'markdown') parts.push(`第 ${reading.page} / ${reading.pageCount} 页`)
  parts.push(`已读 ${Math.round(reading.progress * 100)}%`, `最高读到 ${Math.round(reading.maxProgress * 100)}%`, `打开 ${reading.sessions} 次`, `${reading.activeDays} 个阅读日`, `提问 ${reading.questions} 次`)
  return parts.join(' · ')
})

const onboarding = reactive<{ docLevel: 0 | SelfLevel; fieldLevel: 0 | SelfLevel; goal: string; preference: string; note: string }>({ docLevel: 0, fieldLevel: 0, goal: '', preference: '', note: '' })
const onboardingError = ref('')
const fillOpen = ref(false)
const initializing = ref(false)
function submitInit() {
  if (!onboarding.docLevel || !onboarding.fieldLevel) { onboardingError.value = '请先回答上面两道自评。'; return }
  if (!onboarding.goal.trim()) { onboardingError.value = '请填写学习目标。'; return }
  onboardingError.value = ''
  initializing.value = true
  emit('init', {
    docLevel: onboarding.docLevel, fieldLevel: onboarding.fieldLevel,
    goal: onboarding.goal.trim(), preference: onboarding.preference.trim(), note: onboarding.note.trim(),
    answeredAt: Date.now(), source: 'manual',
  })
}
function submitFill() { submitInit(); fillOpen.value = false }
function openFill() {
  if (props.memory?.onboarding) {
    onboarding.docLevel = props.memory.onboarding.docLevel
    onboarding.fieldLevel = props.memory.onboarding.fieldLevel
    onboarding.goal = props.memory.onboarding.goal || ''
    onboarding.preference = props.memory.onboarding.preference || ''
    onboarding.note = props.memory.onboarding.note
  }
  fillOpen.value = true
}
</script>

<template>
  <section class="memory-detail page-card" aria-label="文档记忆详情">
    <p v-if="!props.document" class="page-note">选择左侧的一本书查看记忆。</p>
    <p v-else-if="props.newer" class="memory-warning">这份记忆由更新版本的阅迁星穹写入，当前版本无法读取。</p>
    <template v-else-if="!props.memory">
      <header class="memory-detail-head"><h2>{{ title }}</h2></header>
      <p class="page-note">这本书还没有学习记忆。在阅读助手或对话模式里围绕它提问后会自动建立；也可以现在先填一份自评。</p>
      <OnboardingFields v-model:doc-level="onboarding.docLevel" v-model:field-level="onboarding.fieldLevel" v-model:goal="onboarding.goal" v-model:preference="onboarding.preference" v-model:note="onboarding.note" doc-question="你对这份文档的内容了解多少？" />
      <p v-if="onboardingError" class="memory-warning" role="alert">{{ onboardingError }}</p>
      <button type="button" class="primary-button" :disabled="initializing" @click="submitInit">建立记忆</button>
    </template>
    <template v-else>
      <header class="memory-detail-head">
        <h2>{{ title }}</h2>
        <div class="memory-detail-actions">
          <button type="button" class="text-button" @click="emit('chat', { kind: 'doc', docId, title: props.document!.title })">在对话模式中使用</button>
          <button type="button" class="text-button" @click="emit('open-document', docId)">打开文档</button>
        </div>
      </header>
      <div class="memory-detail-status">
        <span class="memory-badge">{{ status }}</span>
        <button type="button" :disabled="running || !configured" :data-tip="configured ? '重新总结这本书的记忆' : '未配置记忆管理预设'" @click="emit('summarize')">重新总结</button>
        <button type="button" :disabled="running" @click="emit('edit')">编辑</button>
        <button type="button" class="danger-text" :disabled="running" @click="emit('clear')">清空本书记忆</button>
      </div>
      <p v-if="props.memory.pending.length" class="page-note">有 {{ props.memory.pending.length }} 条新的问答等待总结。</p>

      <section class="memory-section">
        <h3>导入自评</h3>
        <template v-if="props.memory.onboarding">
          <p class="memory-text">文档内容：{{ DOC_LEVEL_LABELS[props.memory.onboarding.docLevel] }} · 相关专业：{{ FIELD_LEVEL_LABELS[props.memory.onboarding.fieldLevel] }}</p>
          <p v-if="props.memory.onboarding.goal" class="memory-text">学习目标：{{ props.memory.onboarding.goal }}</p>
          <p v-if="props.memory.onboarding.preference" class="memory-text">学习偏好：{{ props.memory.onboarding.preference }}</p>
          <p v-if="props.memory.onboarding.note" class="memory-text">补充：{{ props.memory.onboarding.note }}</p>
          <p class="memory-meta">{{ props.memory.onboarding.source === 'manual' ? '手动补建' : '导入时填写' }} · {{ formatDay(props.memory.onboarding.answeredAt) }}</p>
        </template>
        <template v-else>
          <p class="page-note">没有导入自评。<button type="button" class="text-button" @click="openFill">补填自评</button></p>
        </template>
        <template v-if="fillOpen">
          <OnboardingFields v-model:doc-level="onboarding.docLevel" v-model:field-level="onboarding.fieldLevel" v-model:goal="onboarding.goal" v-model:preference="onboarding.preference" v-model:note="onboarding.note" />
          <p v-if="onboardingError" class="memory-warning" role="alert">{{ onboardingError }}</p>
          <button type="button" class="primary-button" :disabled="initializing" @click="submitFill">保存自评</button>
        </template>
      </section>

      <section class="memory-section">
        <h3>综述<span v-if="props.memory.manual.locked.summary" class="memory-locked">已手动编辑 · 总结不会改写<button type="button" class="text-button" @click="emit('unlock', 'summary')">解除锁定</button></span></h3>
        <p class="memory-text">{{ props.memory.summary || '暂无' }}</p>
      </section>

      <section class="memory-section">
        <h3>画像</h3>
        <div class="memory-profile-row"><strong>目标</strong><MemoryChips :items="props.memory.profile.goals" :pinned="props.memory.manual.pinned.goals" label="目标" @remove="text => emit('remove-item', 'goals', text)" /></div>
        <div class="memory-profile-row"><strong>水平</strong><span class="memory-text">{{ props.memory.profile.level || '暂无' }}</span><span v-if="props.memory.manual.locked.level" class="memory-locked">已手动编辑 · 总结不会改写<button type="button" class="text-button" @click="emit('unlock', 'level')">解除锁定</button></span></div>
        <div class="memory-profile-row"><strong>兴趣</strong><MemoryChips :items="props.memory.profile.interests" :pinned="props.memory.manual.pinned.interests" label="兴趣" @remove="text => emit('remove-item', 'interests', text)" /></div>
        <div class="memory-profile-row"><strong>强项</strong><MemoryChips :items="props.memory.profile.strengths" :pinned="props.memory.manual.pinned.strengths" label="强项" @remove="text => emit('remove-item', 'strengths', text)" /></div>
        <div class="memory-profile-row"><strong>薄弱点</strong><MemoryChips :items="props.memory.profile.weaknesses" :pinned="props.memory.manual.pinned.weaknesses" label="薄弱点" @remove="text => emit('remove-item', 'weaknesses', text)" /></div>
        <div class="memory-profile-row"><strong>易错点</strong><MemoryChips :items="props.memory.profile.misconceptions" :pinned="props.memory.manual.pinned.misconceptions" label="易错点" @remove="text => emit('remove-item', 'misconceptions', text)" /></div>
        <div class="memory-profile-row"><strong>偏好</strong><MemoryChips :items="props.memory.profile.preferences" :pinned="props.memory.manual.pinned.preferences" label="偏好" @remove="text => emit('remove-item', 'preferences', text)" /></div>
      </section>

      <section class="memory-section">
        <h3>最近问题主题</h3>
        <MemoryChips :items="props.memory.questions" :pinned="props.memory.manual.pinned.questions" label="最近问题主题" @remove="text => emit('remove-item', 'questions', text)" />
      </section>

      <section class="memory-section">
        <h3>阅读行为</h3>
        <p class="memory-text">{{ readingText }}</p>
      </section>

      <section class="memory-section">
        <h3>证据</h3>
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
.memory-detail { display: flex; flex-direction: column; gap: 12px; min-height: 0; overflow: auto; }
.memory-detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.memory-detail-head h2 { margin: 0; font-size: 17px; font-weight: 650; color: var(--control-ink, var(--ink)); overflow-wrap: anywhere; }
.memory-detail-actions { display: flex; gap: 4px; flex-wrap: wrap; }
.memory-detail-status { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.memory-detail-status button { padding: 5px 11px; border: 1px solid var(--hairline); border-radius: var(--r-control); background: var(--frost, var(--fill-2)); color: var(--control-ink, var(--ink)); font-size: 12.5px; font-weight: 600; cursor: pointer; }
.memory-detail-status button:disabled { opacity: .45; cursor: default; }
.memory-detail-status .danger-text { color: var(--danger); }
.memory-badge { padding: 2px 9px; border-radius: var(--r-full); font-size: 11.5px; font-weight: 600; color: var(--secondary); background: color-mix(in srgb, var(--ink) 7%, transparent); }
.memory-section { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--line-soft, var(--hairline)); padding-top: 10px; }
.memory-section:first-of-type { border-top: 0; padding-top: 0; }
.memory-section h3 { margin: 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13.5px; font-weight: 650; color: var(--control-ink, var(--ink)); }
.memory-text { margin: 0; font-size: 12.5px; line-height: 1.8; color: var(--secondary); white-space: pre-wrap; overflow-wrap: anywhere; }
.memory-meta { margin: 0; font-size: 11.5px; color: var(--muted); }
.memory-locked { font-size: 11px; font-weight: 400; color: var(--muted); }
.memory-warning { margin: 0; font-size: 12px; line-height: 1.6; color: var(--warning); }
.memory-profile-row { display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap; }
.memory-profile-row strong { flex: none; min-width: 44px; padding-top: 3px; font-size: 12px; color: var(--muted); font-weight: 600; }
.memory-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.memory-list li { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; border-top: 1px solid var(--line-soft, var(--hairline)); padding-top: 8px; }
.memory-list li:first-child { border-top: 0; padding-top: 0; }
.memory-list-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.memory-footer { margin: 0; font-size: 11.5px; color: var(--muted); }
.text-button { border: 0; border-radius: var(--r-control); background: none; box-shadow: none; color: var(--accent); padding: 2px 6px; font-size: 12px; cursor: pointer; }
.text-button:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.primary-button { align-self: flex-start; padding: 8px 16px; border: 1px solid transparent; border-radius: var(--r-control); background: var(--accent); color: var(--accent-on, #fff); font-weight: 600; cursor: pointer; }
.icon-button { width: 26px; height: 26px; padding: 0; border: 0; border-radius: var(--r-control); background: none; box-shadow: none; color: var(--muted); cursor: pointer; }
.icon-button:hover { background: color-mix(in srgb, var(--ink) 8%, transparent); color: var(--ink); }
</style>
