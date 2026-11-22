<script setup lang="ts">
/** 一道题：题头、题干、选项、展开区（答案 / 解析 / 评分要点 / 来源）、大题自评。 */
import { computed } from 'vue'
import AppIcon from '../ui/AppIcon.vue'
import MarkdownAnswer from '../ui/MarkdownAnswer.vue'
import type { ExamAnswerItem, ExamQuestion } from '../../exam/types.ts'
import { DIFFICULTY_LABELS, TYPE_LABELS, EXAM_LIMITS } from '../../exam/types.ts'
import { scoreQuestion } from '../../exam/scoring.ts'

const props = defineProps<{
  question: ExamQuestion
  number: number
  answer?: ExamAnswerItem
  mode: 'taking' | 'review'
  submitted: boolean
  locked: boolean
}>()
const emit = defineEmits<{
  choose: [key: string]
  reveal: []
  score: [value: number]
  'open-source': []
}>()

const item = computed(() => props.answer || { choice: [], revealed: false, revealedAt: 0, selfScore: null })
const chosen = computed(() => new Set(item.value.choice))
const correctKeys = computed(() => (Array.isArray(props.question.answer) ? props.question.answer : []))
const revealed = computed(() => item.value.revealed)
const essay = computed(() => props.question.type === 'essay')
const interactive = computed(() => props.mode === 'taking' && !props.locked && !props.submitted)

const answerText = computed(() => correctKeys.value.join('、'))
const verdict = computed(() => {
  const result = scoreQuestion(props.question, item.value, props.submitted)
  if (props.question.type === 'essay') {
    if (typeof item.value.selfScore === 'number') return `自评 ${item.value.selfScore} / 10`
    return '未自评'
  }
  if (!result.judged) return props.question.type === 'multiple' && !props.submitted ? '交卷后判分' : '未作答'
  if (result.score === EXAM_LIMITS.points) return `回答正确 +${EXAM_LIMITS.points}`
  if (props.question.type === 'multiple' && result.score > 0) return `漏选 +${result.score}`
  return '回答错误 0 分'
})

const sourceText = computed(() => {
  const source = props.question.source
  if (!props.question.grounded) return '来源：本次未读取原文'
  if (source.kind === 'markdown' && source.lines.length) return `来源：第 ${source.lines.join('、')} 行`
  if (source.pages.length) return `来源：第 ${source.pages.join('、')} 页`
  return '来源：未记录'
})
const quote = computed(() => props.question.source.quotes?.[0]?.text || '')

function stateOf(key: string): 'selected' | 'right' | 'wrong' | '' {
  const picked = chosen.value.has(key)
  const right = correctKeys.value.includes(key)
  if (props.submitted) {
    if (right) return 'right'
    if (picked) return 'wrong'
  }
  return picked ? 'selected' : ''
}
const verdictTone = computed(() => {
  if (!props.submitted) return ''
  const result = scoreQuestion(props.question, item.value, true)
  if (props.question.type === 'essay') return typeof item.value.selfScore === 'number' ? 'right' : 'wrong'
  if (result.score === EXAM_LIMITS.points) return 'right'
  if (result.score > 0) return 'warn'
  return 'wrong'
})
</script>

<template>
  <li :id="`exam-q-${question.slot}`" class="exam-card page-card" :class="{ essay, locked }">
    <header class="exam-card-head">
      <span class="exam-number">{{ number }}</span>
      <span class="exam-meta">第 {{ number }} 题 · {{ TYPE_LABELS[question.type] }} · {{ DIFFICULTY_LABELS[question.difficulty] }} · 10 分</span>
      <span class="exam-tags">
        <span v-for="tag in question.knowledge" :key="tag" class="exam-tag">{{ tag }}</span>
      </span>
      <button type="button" class="exam-arrow"
              :aria-label="revealed ? '收起答案' : '显示答案'"
              :data-tip="revealed ? undefined : '交卷后查看答案'"
              @click="emit('reveal')">{{ revealed ? '收起答案' : '显示答案' }}</button>
    </header>

    <MarkdownAnswer class="exam-stem" :content="question.stem" />

    <div v-if="!essay" class="exam-options">
      <button v-for="option in question.options" :key="option.key" type="button"
              class="exam-option" :class="stateOf(option.key)"
              :disabled="!interactive" :aria-pressed="chosen.has(option.key)"
              @click="emit('choose', option.key)">
        <span class="exam-key">{{ option.key }}</span>
        <MarkdownAnswer class="exam-option-text" :content="option.text" />
      </button>
    </div>
    <p v-if="!interactive && !essay" class="exam-lock">
      {{ locked ? '已查看答案，本题作答已锁定。' : '结果页只读。' }}
    </p>
    <p v-else-if="essay && !revealed" class="exam-lock">先展开参考答案，再对照评分要点给自己打分。</p>

    <div v-if="revealed" class="exam-reveal">
      <p v-if="essay" class="exam-answer-title">参考答案</p>
      <p v-if="!essay" class="exam-answer">正确答案：{{ answerText }}</p>
      <p class="exam-explanation">解析：{{ question.explanation }}</p>
      <template v-if="essay">
        <p class="exam-rubric-title">评分要点</p>
        <ol class="exam-rubric">
          <li v-for="(point, index) in question.rubric" :key="index">{{ index + 1 }}. {{ point.point }}（{{ point.score }} 分）</li>
        </ol>
        <div class="exam-self" role="radiogroup" aria-label="大题自评得分，0 到 10 分">
          <button v-for="value in 11" :key="value - 1" type="button" role="radio"
                  :aria-checked="item.selfScore === value - 1"
                  :class="{ selected: item.selfScore === value - 1 }"
                  :disabled="!interactive" @click="emit('score', value - 1)">{{ value - 1 }}</button>
        </div>
        <p class="exam-self-value">{{ typeof item.selfScore === 'number' ? `${item.selfScore} / 10` : '还没有自评' }}</p>
      </template>
      <p class="exam-source">{{ sourceText }}</p>
      <p v-if="quote" class="exam-quote">原文摘录：「{{ quote }}」</p>
      <button v-if="props.question.grounded" type="button" class="exam-source-button" @click="emit('open-source')">打开原书</button>
    </div>

    <footer v-if="submitted || essay" class="exam-verdict" :class="verdictTone">{{ verdict }}</footer>
  </li>
</template>

<style scoped>
.exam-card { padding: 16px 18px; display: flex; flex-direction: column; gap: 10px; }
.exam-card-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.exam-number { display: inline-grid; place-items: center; min-width: 26px; height: 26px; padding: 0 6px; border-radius: var(--r-control); background: var(--fill-2); color: var(--secondary); font: 600 13px/1 var(--font-mono); }
.exam-meta { color: var(--muted); font-size: 12.5px; }
.exam-tags { display: inline-flex; gap: 6px; margin-inline-start: 4px; }
.exam-tag { padding: 1px 8px; border-radius: var(--r-full); background: var(--fill-2); color: var(--secondary); font-size: 11.5px; }
.exam-arrow { margin-inline-start: auto; display: inline-grid; place-items: center; height: 28px; padding: 0 10px; border: 1px solid var(--hairline); border-radius: var(--r-control); background: var(--frost); color: var(--secondary); font: 12px/1 inherit; cursor: pointer; transition: background .18s ease; }
.exam-arrow:hover { background: var(--frost-hover, var(--fill-2)); }
.exam-stem { font-size: 14.5px; line-height: 1.75; color: var(--ink); }
.exam-options { display: flex; flex-direction: column; gap: 8px; }
.exam-option { display: flex; align-items: flex-start; justify-content: flex-start; gap: 10px; padding: 10px 12px; border: 1px solid var(--hairline); border-radius: var(--r-control); background: var(--frost, var(--fill-2)); color: var(--control-ink, var(--ink)); text-align: start; font: inherit; font-size: 13.5px; line-height: 1.65; cursor: pointer; }
.exam-option:hover:not(:disabled) { background: var(--frost-hover, var(--fill-2)); }
.exam-option:disabled { cursor: default; opacity: 1; }
.exam-option.selected { border-color: var(--accent); background: var(--accent-ring, var(--fill-3)); }
.exam-option.right { border-color: var(--success); }
.exam-option.wrong { border-color: var(--danger); background: var(--danger-soft); }
.exam-key { display: inline-grid; place-items: center; width: 22px; height: 22px; flex: none; border-radius: 50%; background: var(--fill-3); font: 600 12px/1 var(--font-mono); }
.exam-option-text { min-width: 0; }
.exam-lock { color: var(--muted); font-size: 12.5px; }
.exam-reveal { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px dashed var(--hairline); border-radius: var(--r-control); background: var(--fill-1, var(--frost)); }
.exam-answer { font-size: 13.5px; color: var(--ink); }
.exam-answer-title, .exam-rubric-title { font-weight: 600; font-size: 13px; color: var(--secondary); }
.exam-explanation { font-size: 13px; color: var(--secondary); line-height: 1.7; }
.exam-rubric { margin: 0; padding-inline-start: 18px; font-size: 13px; color: var(--secondary); line-height: 1.8; }
.exam-self { display: flex; flex-wrap: wrap; gap: 4px; }
.exam-self button { width: 30px; height: 30px; border: 1px solid var(--hairline); border-radius: var(--r-xs); background: var(--frost); color: var(--secondary); font: 500 12.5px/1 var(--font-mono); cursor: pointer; }
.exam-self button.selected { border-color: var(--accent); background: var(--accent); color: #fff; }
.exam-self-value { font: 600 13px/1 var(--font-mono); color: var(--ink); }
.exam-source, .exam-quote { font-size: 12.5px; color: var(--muted); }
.exam-quote { font-style: italic; }
.exam-source-button { align-self: flex-start; padding: 4px 10px; border: 1px solid var(--hairline); border-radius: var(--r-control); background: var(--frost); color: var(--secondary); font-size: 12px; cursor: pointer; }
.exam-verdict { color: var(--muted); font-size: 12.5px; }
.exam-verdict.right { color: var(--success); font-weight: 600; }
.exam-verdict.wrong { color: var(--danger); font-weight: 600; }
.exam-verdict.warn { color: var(--warning); font-weight: 600; }
</style>
