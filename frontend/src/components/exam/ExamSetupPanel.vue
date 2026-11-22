<script setup lang="ts">
/** 准备区：选书（搜索 + 单选）、模型抽屉、出题要求、题型配比、开始按钮、最近的试卷。 */
import { computed, ref } from 'vue'
import AppIcon from '../ui/AppIcon.vue'
import ModelPicker from '../assistant/ModelPicker.vue'
import { loadAiSettings } from '../../ai/settings.mjs'
import { composerModels, presetDetail, presetTitle } from '../../ai/presets'
import { pickChatEffort, pickChatModel, pickChatPreset } from '../../chat/choice.ts'
import type { ExamApi } from '../../exam/state.ts'
import { EXAM_LIMITS, TEMPLATES } from '../../exam/types.ts'

type DocItem = { id: string; title: string; kind: 'pdf' | 'markdown' | 'word'; size?: number; pageCount: number; sourceMissing: boolean }
const props = defineProps<{ exam: ExamApi; documents: DocItem[] }>()
const emit = defineEmits<{ settings: []; import: []; open: [id: string]; continue: [id: string]; remove: [id: string] }>()

const state = props.exam.state
const search = ref<HTMLInputElement>()
const pickerOpen = ref(false)
const query = ref('')

const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase().replace(/\s+/g, '')
  if (!needle) return props.documents
  return props.documents.filter(doc => doc.title.toLowerCase().replace(/\s+/g, '').includes(needle))
})
const settings = computed(() => {
  void state.settingsVersion
  return loadAiSettings()
})
const resolved = props.exam.resolved
const models = computed(() => (resolved.value ? composerModels(resolved.value.provider, resolved.value.model) : []))
const chips = computed(() => (settings.value?.presets || []).map((preset: any) => ({
  id: preset.id, name: presetTitle(preset), detail: presetDetail(preset),
})))
const preview = computed(() => {
  if (state.setup.template !== 'auto') return props.exam.preview.value
  return '将生成 20 题 · 每题 10 分 · 满分 200。出题前先读目录和前几页判断学科：理工类用 A（单选 10 · 多选 4 · 大题 6），文科类用 B（单选 12 · 多选 3 · 大题 5），判断不了用 C（单选 12 · 多选 4 · 大题 4）。难度 易 5 / 中 10 / 难 5。'
})
const recent = props.exam.recent

function docText(doc: DocItem): string {
  if (doc.kind === 'markdown') return 'Markdown'
  if (doc.kind === 'word') return `Word（已转为 PDF）· ${doc.pageCount || '—'} 页`
  return `PDF · ${doc.pageCount || '—'} 页`
}
function dateText(at: number): string {
  const date = new Date(at)
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}
function choosePreset(id: string) { props.exam.setChoice(pickChatPreset(settings.value, id)) }
function chooseModel(id: string) { props.exam.setChoice(pickChatModel(settings.value, state.choice, id)) }
function chooseEffort(value: string) { props.exam.setChoice(pickChatEffort(settings.value, state.choice, value)) }
function templateClass(value: 'auto' | 'A' | 'B' | 'C') { return { selected: state.setup.template === value } }
function focusSearch() {
  search.value?.focus()
  search.value?.select()
}
defineExpose({ focusSearch })
</script>

<template>
  <div class="exam-setup">
    <section class="exam-section page-card">
      <h2>1. 选一本书</h2>
      <input ref="search" v-model="query" type="search" class="exam-search"
             placeholder="搜索文档库里的书" aria-label="搜索要出题的书" />
      <p v-if="!documents.length" class="exam-empty">
        文档库还是空的。先加入一本 PDF、Markdown 或 Word 文档，再回来出题。
        <button type="button" class="exam-link" @click="emit('import')">加入文档</button>
      </p>
      <p v-else-if="!filtered.length" class="exam-empty">没有找到「{{ query }}」相关的书。</p>
      <ul v-else class="exam-docs">
        <li v-for="doc in filtered" :key="doc.id">
          <button type="button" class="exam-doc" :class="{ selected: state.setup.docId === doc.id }"
                  :disabled="doc.sourceMissing" :aria-pressed="state.setup.docId === doc.id"
                  :data-tip="doc.sourceMissing ? '请先在文档库里重新定位' : undefined"
                  @click="props.exam.selectDocument(doc.id)">
            <span class="exam-doc-title">{{ doc.title }}</span>
            <span class="exam-doc-sub">{{ docText(doc) }}<template v-if="doc.sourceMissing"> · 原文件已移动</template></span>
          </button>
        </li>
      </ul>
    </section>

    <section class="exam-section page-card">
      <h2>2. 选模型</h2>
      <div class="exam-model">
        <button type="button" class="exam-model-button" :aria-expanded="pickerOpen"
                data-tip="模型与思考强度（只影响模拟测试）" @click="pickerOpen = !pickerOpen">
          <AppIcon name="spark" :size="14" />
          <template v-if="resolved">{{ resolved.preset.name }} · {{ resolved.model }}<em v-if="resolved.effort">（{{ resolved.effort }}）</em></template>
          <template v-else>选择模型</template>
          <AppIcon name="down" :size="12" />
        </button>
        <button v-if="!settings.presets?.length" type="button" class="exam-link" @click="emit('settings')">去设置</button>
        <p v-if="!settings.presets?.length" class="exam-hint">还没有模型预设：请先在 设置 → AI 里点「新建预设」添加一个。</p>
      </div>
      <div v-if="pickerOpen" class="exam-picker">
        <ModelPicker :model="resolved?.model || ''" :effort="resolved?.effort || ''" :models="models"
                     :presets="chips" :preset="resolved?.preset.id"
                     @preset="choosePreset" @model="chooseModel" @effort="chooseEffort"
                     @manage="pickerOpen = false; emit('settings')" @close="pickerOpen = false" />
      </div>
    </section>

    <section class="exam-section page-card">
      <h2>3. 出题要求（选填）</h2>
      <textarea class="exam-requirement" :value="state.setup.requirement"
                :maxlength="EXAM_LIMITS.requirement" rows="3"
                placeholder="例如：只考第三章；多出计算题；不要考历史背景。"
                @input="props.exam.setRequirement(($event.target as HTMLTextAreaElement).value)" />
      <p class="exam-count">{{ state.setup.requirement.length }} / {{ EXAM_LIMITS.requirement }}</p>
    </section>

    <section class="exam-section page-card">
      <h2>4. 题型配比</h2>
      <div class="exam-mixes">
        <button type="button" class="exam-mix" :class="templateClass('auto')" @click="props.exam.setTemplate('auto')">自动判断（推荐）</button>
        <button v-for="key in (['A', 'B', 'C'] as const)" :key="key" type="button" class="exam-mix"
                :class="templateClass(key)" @click="props.exam.setTemplate(key)">{{ key }} {{ TEMPLATES[key].name }}</button>
      </div>
      <p class="exam-preview">{{ preview }}</p>
      <p class="exam-hint">出题要求里写明了各题型的题数时，以要求为准。</p>
      <p class="exam-hint">出题时，这本书里被检索到的段落、学习记忆摘要和出题要求会发给你配置的模型服务商；不会发送整本书。一套题大约要调用模型 5–9 次。</p>
      <button type="button" class="exam-start" :disabled="Boolean(props.exam.startBlocker.value)"
              :data-tip="props.exam.startBlocker.value || undefined" @click="props.exam.start()">
        开始出题
      </button>
      <p v-if="props.exam.startBlocker.value" class="exam-hint">{{ props.exam.startBlocker.value }}</p>
    </section>

    <section v-if="recent.length" class="exam-section page-card">
      <h2>最近的试卷</h2>
      <ul class="exam-recent">
        <li v-for="row in recent" :key="row.entry.id">
          <div class="exam-recent-main">
            <strong>《{{ row.entry.title }}》</strong>
            <span class="exam-recent-meta">{{ dateText(row.entry.createdAt) }} · {{ row.statusText }}</span>
          </div>
          <div class="exam-recent-actions">
            <button v-if="row.entry.status === 'draft'" type="button" @click="emit('continue', row.entry.id)">继续出题</button>
            <button v-if="row.entry.status === 'draft' && row.entry.count" type="button" @click="emit('open', row.entry.id)">开始作答</button>
            <button v-if="row.entry.status === 'taking'" type="button" @click="emit('open', row.entry.id)">继续作答</button>
            <button v-if="row.entry.status === 'done'" type="button" @click="emit('open', row.entry.id)">查看结果</button>
            <button type="button" class="danger" @click="emit('remove', row.entry.id)">删除</button>
          </div>
        </li>
      </ul>
      <p class="exam-hint">最多保留 20 套试卷，超出时先删除最早交卷的一套。</p>
    </section>
  </div>
</template>

<style scoped>
.exam-setup { display: flex; flex-direction: column; gap: 14px; }
.exam-section { padding: 16px 18px; display: flex; flex-direction: column; gap: 10px; }
.exam-section h2 { margin: 0; font-size: 14px; font-weight: 600; color: var(--secondary); }
.exam-search, .exam-requirement { width: 100%; padding: 8px 10px; border: 1px solid var(--hairline); border-radius: var(--r-control); background: var(--frost, var(--fill-2)); color: var(--control-ink, var(--ink)); font: inherit; font-size: 13.5px; }
.exam-requirement { resize: vertical; min-height: 64px; line-height: 1.7; }
.exam-count { align-self: flex-end; margin: 0; color: var(--muted); font: 12px/1 var(--font-mono); }
.exam-docs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 280px; overflow: auto; }
.exam-doc { width: 100%; display: flex; flex-direction: column; align-items: flex-start; justify-content: flex-start; gap: 2px; padding: 9px 12px; border: 1px solid var(--hairline); border-radius: var(--r-control); background: var(--frost, var(--fill-2)); color: var(--control-ink, var(--ink)); text-align: start; cursor: pointer; }
.exam-doc.selected { border-color: var(--accent); background: var(--accent-ring, var(--fill-3)); }
.exam-doc:disabled { opacity: .55; cursor: not-allowed; }
.exam-doc-title { font-size: 13.5px; }
.exam-doc-sub { color: var(--muted); font-size: 12px; }
.exam-empty, .exam-hint { margin: 0; color: var(--muted); font-size: 12.5px; line-height: 1.7; }
.exam-link { border: 0; background: none; color: var(--accent); font: inherit; font-size: 12.5px; cursor: pointer; padding: 0 2px; }
.exam-model { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.exam-model-button { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border: 1px solid var(--hairline); border-radius: var(--r-control); background: var(--frost); color: var(--control-ink, var(--ink)); font: inherit; font-size: 13px; cursor: pointer; }
.exam-model-button em { font-style: normal; color: var(--muted); }
.exam-picker { border: 1px solid var(--hairline); border-radius: var(--r-control); padding: 8px; background: var(--fill-1, var(--frost)); }
.exam-mixes { display: flex; flex-wrap: wrap; gap: 8px; }
.exam-mix { padding: 7px 12px; border: 1px solid var(--hairline); border-radius: var(--r-control); background: var(--frost); color: var(--control-ink, var(--ink)); font: inherit; font-size: 13px; cursor: pointer; }
.exam-mix.selected { border-color: var(--accent); background: var(--accent-ring, var(--fill-3)); }
.exam-preview { margin: 0; color: var(--secondary); font-size: 12.5px; line-height: 1.7; }
.exam-start { align-self: flex-start; padding: 9px 20px; border: 0; border-radius: var(--r-control); background: var(--accent); color: #fff; font: 600 13.5px/1 inherit; cursor: pointer; }
.exam-start:disabled { opacity: .5; cursor: not-allowed; }
.exam-recent { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.exam-recent li { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 10px; border: 1px solid var(--hairline); border-radius: var(--r-control); }
.exam-recent-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.exam-recent-meta { color: var(--muted); font-size: 12px; }
.exam-recent-actions { margin-inline-start: auto; display: flex; gap: 6px; flex-wrap: wrap; }
.exam-recent-actions button { padding: 4px 10px; border: 1px solid var(--hairline); border-radius: var(--r-control); background: var(--frost); color: var(--secondary); font: inherit; font-size: 12px; cursor: pointer; }
.exam-recent-actions button.danger { color: var(--danger); }
</style>
