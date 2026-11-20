<script setup lang="ts">
import { computed, onMounted, reactive, watch } from 'vue'
import { diffEdit, type MemoryPatch } from '../../memory/merge.ts'
import { LIMITS, type OnboardingAnswers, type SelfLevel } from '../../memory/types.ts'
import OnboardingFields from './OnboardingFields.vue'

const props = withDefaults(defineProps<{
  kind: 'doc' | 'global'
  baseline: MemoryPatch
  saving?: boolean
}>(), { saving: false })
const emit = defineEmits<{ save: [patch: MemoryPatch]; cancel: []; dirty: [value: boolean] }>()

const isGlobal = computed(() => props.kind === 'global')
const summaryLimit = computed(() => isGlobal.value ? LIMITS.globalSummary : LIMITS.summary)
const lines = (value?: string[]) => (value ?? []).join('\n')
const draft = reactive({
  summary: props.baseline.summary ?? '',
  level: props.baseline.level ?? '',
  goals: lines(props.baseline.goals),
  interests: lines(props.baseline.interests),
  strengths: lines(props.baseline.strengths),
  weaknesses: lines(props.baseline.weaknesses),
  misconceptions: lines(props.baseline.misconceptions),
  preferences: lines(props.baseline.preferences),
  questions: lines(props.baseline.questions),
  themes: lines(props.baseline.themes),
})
const onboarding = props.baseline.onboarding
const docLevel = reactive<{ value: 0 | SelfLevel }>({ value: onboarding?.docLevel ?? 0 })
const fieldLevel = reactive<{ value: 0 | SelfLevel }>({ value: onboarding?.fieldLevel ?? 0 })
const note = reactive({ value: onboarding?.note ?? '' })
const split = (text: string) => text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)

function currentPatch(): MemoryPatch {
  const patch: MemoryPatch = {
    summary: draft.summary,
    level: draft.level,
    goals: split(draft.goals),
    interests: split(draft.interests),
    strengths: split(draft.strengths),
    weaknesses: split(draft.weaknesses),
    preferences: split(draft.preferences),
  }
  if (isGlobal.value) {
    patch.themes = split(draft.themes)
  } else {
    patch.misconceptions = split(draft.misconceptions)
    patch.questions = split(draft.questions)
  }
  if (!isGlobal.value && onboarding) {
    patch.onboarding = {
      docLevel: docLevel.value || 1,
      fieldLevel: fieldLevel.value || 1,
      note: note.value.trim(),
      answeredAt: onboarding.answeredAt || Date.now(),
      source: onboarding.source,
    } as OnboardingAnswers
  }
  return patch
}
const changes = computed(() => diffEdit(props.baseline, currentPatch()))
watch(changes, value => emit('dirty', Object.keys(value).length > 0), { deep: true })
onMounted(() => emit('dirty', false))
function save() { emit('save', Object.keys(changes.value).length ? changes.value : {}) }
</script>

<template>
  <form class="memory-edit-form page-card" @submit.prevent="save">
    <p class="memory-edit-note">你改过的综述和水平会被锁定；你保留的条目会一直留着，你删掉的条目不会被自动总结加回来。</p>
    <label class="memory-field">
      <span>综述 <small>{{ draft.summary.length }} / {{ summaryLimit }}</small></span>
      <textarea v-model="draft.summary" :maxlength="summaryLimit" rows="6" />
    </label>
    <label class="memory-field">
      <span>水平 <small>{{ draft.level.length }} / {{ LIMITS.level }}</small></span>
      <input v-model="draft.level" :maxlength="LIMITS.level" />
    </label>
    <label class="memory-field"><span>目标</span><textarea v-model="draft.goals" rows="2" placeholder="每行一条，最多 6 条，每条不超过 40 字。" /></label>
    <label class="memory-field"><span>兴趣</span><textarea v-model="draft.interests" rows="2" placeholder="每行一条，最多 8 条，每条不超过 40 字。" /></label>
    <label class="memory-field"><span>强项</span><textarea v-model="draft.strengths" rows="2" placeholder="每行一条，最多 8 条，每条不超过 40 字。" /></label>
    <label class="memory-field"><span>薄弱点</span><textarea v-model="draft.weaknesses" rows="2" placeholder="每行一条，最多 8 条，每条不超过 40 字。" /></label>
    <label v-if="!isGlobal" class="memory-field"><span>易错点</span><textarea v-model="draft.misconceptions" rows="2" placeholder="每行一条，最多 6 条，每条不超过 40 字。" /></label>
    <label class="memory-field"><span>偏好</span><textarea v-model="draft.preferences" rows="2" placeholder="每行一条，最多 6 条，每条不超过 40 字。" /></label>
    <label v-if="!isGlobal" class="memory-field"><span>最近问题主题</span><textarea v-model="draft.questions" rows="2" placeholder="每行一条，最多 10 条。" /></label>
    <label v-else class="memory-field"><span>跨书主题</span><textarea v-model="draft.themes" rows="2" placeholder="每行一条，最多 12 条。" /></label>
    <section v-if="!isGlobal && onboarding" class="memory-field" aria-label="导入自评">
      <span>导入自评</span>
      <OnboardingFields v-model:doc-level="docLevel.value" v-model:field-level="fieldLevel.value" v-model:note="note.value" />
    </section>
    <div class="memory-edit-actions">
      <button type="button" class="text-button" @click="emit('cancel')">取消</button>
      <button type="submit" class="primary-button" :disabled="props.saving">{{ props.saving ? '保存中…' : '保存' }}</button>
    </div>
  </form>
</template>

<style scoped>
.memory-edit-form { display: flex; flex-direction: column; gap: 12px; overflow: auto; }
.memory-edit-note { margin: 0; font-size: 12px; line-height: 1.7; color: var(--muted); }
.memory-field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; font-weight: 600; color: var(--control-ink, var(--ink)); }
.memory-field small { font-weight: 400; color: var(--muted); float: right; }
.memory-field input, .memory-field textarea { font: inherit; font-size: 13px; font-weight: 400; padding: 8px 10px; border: 1px solid var(--hairline); border-radius: var(--r-control); background: var(--control-bg, var(--fill-2)); color: var(--control-ink, var(--ink)); resize: vertical; }
.memory-edit-actions { display: flex; justify-content: flex-end; gap: 8px; }
.memory-edit-actions .primary-button, .memory-edit-actions .text-button { padding: 8px 16px; border-radius: var(--r-control); font-weight: 600; }
.primary-button { border: 1px solid transparent; background: var(--accent-glass, var(--accent)); color: var(--accent-on, #fff); }
</style>
