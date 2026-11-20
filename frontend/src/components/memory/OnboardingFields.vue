<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SelfLevel } from '../../memory/types.ts'

const props = withDefaults(defineProps<{
  docLevel: 0 | SelfLevel
  fieldLevel: 0 | SelfLevel
  note: string
  docQuestion?: string
  disabled?: boolean
}>(), { docQuestion: '你对这份文档的内容了解多少？', disabled: false })
const emit = defineEmits<{
  'update:docLevel': [value: 0 | SelfLevel]
  'update:fieldLevel': [value: 0 | SelfLevel]
  'update:note': [value: string]
}>()

const DOC_OPTIONS: { value: SelfLevel; label: string }[] = [
  { value: 1, label: '第一次接触' }, { value: 2, label: '略有了解' }, { value: 3, label: '比较熟悉' }, { value: 4, label: '已经掌握' },
]
const FIELD_OPTIONS: { value: SelfLevel; label: string }[] = [
  { value: 1, label: '零基础' }, { value: 2, label: '入门水平' }, { value: 3, label: '有一定基础' }, { value: 4, label: '专业 / 从业水平' },
]
const docField = ref<HTMLFieldSetElement>()
const fieldField = ref<HTMLFieldSetElement>()
const noteLength = computed(() => props.note.length)
function pickDoc(value: number) { emit('update:docLevel', value as SelfLevel) }
function pickField(value: number) { emit('update:fieldLevel', value as SelfLevel) }
function inputNote(event: Event) { emit('update:note', (event.target as HTMLTextAreaElement).value) }
function focusFirstUnanswered() {
  if (!props.docLevel) docField.value?.querySelector<HTMLInputElement>('input')?.focus()
  else if (!props.fieldLevel) fieldField.value?.querySelector<HTMLInputElement>('input')?.focus()
}
defineExpose({ focusFirstUnanswered })
</script>

<template>
  <div class="onboarding-fields">
    <fieldset ref="docField" class="onboarding-question" :disabled="props.disabled">
      <legend>{{ props.docQuestion }}</legend>
      <div class="onboarding-options">
        <label v-for="option in DOC_OPTIONS" :key="option.value" class="onboarding-option">
          <input type="radio" :name="`doc-level-${props.docQuestion}`" :checked="props.docLevel === option.value" @change="pickDoc(option.value)" />{{ option.label }}
        </label>
      </div>
    </fieldset>
    <fieldset ref="fieldField" class="onboarding-question" :disabled="props.disabled">
      <legend>你对它所属的专业或行业了解多少？</legend>
      <div class="onboarding-options">
        <label v-for="option in FIELD_OPTIONS" :key="option.value" class="onboarding-option">
          <input type="radio" :name="`field-level-${props.docQuestion}`" :checked="props.fieldLevel === option.value" @change="pickField(option.value)" />{{ option.label }}
        </label>
      </div>
    </fieldset>
    <label class="onboarding-note">
      <span>想补充一句吗？（可选）</span>
      <textarea :value="props.note" maxlength="200" rows="2" placeholder="例如：为下个月的考试复习，重点看第 3–5 章" :disabled="props.disabled" @input="inputNote" />
      <small class="onboarding-count">{{ noteLength }} / 200</small>
    </label>
  </div>
</template>

<style scoped>
.onboarding-fields { display: flex; flex-direction: column; gap: 12px; }
.onboarding-question { margin: 0; padding: 0; border: 0; }
.onboarding-question legend { padding: 0; margin-bottom: 7px; font-size: 12.5px; font-weight: 600; color: var(--control-ink, var(--ink)); }
.onboarding-options { display: flex; flex-wrap: wrap; gap: 6px 14px; }
.onboarding-option { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--secondary); cursor: pointer; }
.onboarding-option input { margin: 0; }
.onboarding-note { display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; font-weight: 600; color: var(--control-ink, var(--ink)); }
.onboarding-note textarea { font: inherit; font-size: 13px; font-weight: 400; padding: 8px 10px; border: 1px solid var(--hairline); border-radius: var(--r-control); background: var(--control-bg, var(--fill-2)); color: var(--control-ink, var(--ink)); resize: vertical; min-height: 52px; }
.onboarding-count { align-self: flex-end; font-size: 11px; font-weight: 400; color: var(--muted); }
</style>
