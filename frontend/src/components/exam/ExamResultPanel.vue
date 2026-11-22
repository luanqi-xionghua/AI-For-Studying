<script setup lang="ts">
/** 结果面板：总分、按题型得分表、用时、薄弱知识点、记忆勾选框、再来一套 / 回看。 */
import { computed } from 'vue'
import type { ExamMeta, ExamResult } from '../../exam/types.ts'
import { formatElapsed, typeRowLabel } from '../../exam/scoring.ts'
import { relativeTime } from '../../memory/prompts.ts'
import { TYPE_LABELS } from '../../exam/types.ts'

const props = defineProps<{
  result: ExamResult
  meta: ExamMeta
  memory: { want: boolean; sentAt: number; skipped: '' | 'unchecked' | 'doc-removed' }
  finalized: boolean
  docMissing: boolean
  exporting: boolean
  exportError: string
  exported: { name: string; docId: string; at: number } | null
}>()
const emit = defineEmits<{
  memory: [on: boolean]; again: []; review: []; export: []; 'open-document': [id: string]
}>()

const rows = computed(() => (['single', 'multiple', 'essay'] as const).map(type => ({
  type, label: typeRowLabel(type), ...props.result.byType[type],
})))
const memoryLocked = computed(() => props.finalized || props.docMissing)
const memoryNote = computed(() => {
  if (props.docMissing) return '原书已从文档库移除，这次结果不会写入学习记忆。'
  if (props.memory.sentAt) {
    return `已记入《${props.meta.docTitle}》的学习记忆和全局记忆（${relativeTime(props.memory.sentAt, Date.now())}）。如需修改，请到「记忆管理」。`
  }
  if (props.memory.skipped === 'unchecked') return '这次结果没有记入学习记忆。'
  return '只写入总分、各题型得分和薄弱知识点，不写题目和答案原文，并标明是自评。离开结果页时写入，在那之前可以取消。'
})
</script>

<template>
  <section class="exam-result page-card" aria-label="成绩">
    <div class="exam-total">
      <strong>{{ result.total }}</strong><span>/ {{ result.max }}</span>
      <p>单选、多选由程序判分，大题为自评。</p>
    </div>

    <table class="exam-table">
      <thead><tr><th>题型</th><th>题数</th><th>得分</th><th>满分</th></tr></thead>
      <tbody>
        <tr v-for="row in rows" :key="row.type">
          <td>{{ row.label }}</td><td>{{ row.count }}</td><td>{{ row.score }}</td><td>{{ row.max }}</td>
        </tr>
        <tr class="exam-table-total">
          <td>合计</td><td>{{ result.count }}</td><td>{{ result.total }}</td><td>{{ result.max }}</td>
        </tr>
      </tbody>
    </table>

    <p class="exam-meta-line">用时：{{ formatElapsed(result.elapsedMs) }}</p>
    <p v-if="result.unanswered || result.unscored" class="exam-meta-line">
      有 {{ result.unanswered }} 题未作答、{{ result.unscored }} 道大题未自评，均按 0 分计。
    </p>

    <div class="exam-weak">
      <h2>薄弱知识点</h2>
      <ul v-if="result.weak.length">
        <li v-for="item in result.weak" :key="item.tag">{{ item.tag }}（失 {{ item.lost }} 分 · {{ item.count }} 题）</li>
      </ul>
      <p v-else class="exam-meta-line">没有明显的薄弱点：每个知识点的失分都不超过 5 分。</p>
    </div>

    <label class="exam-memory" :class="{ disabled: memoryLocked }">
      <input type="checkbox" :checked="memory.want" :disabled="memoryLocked"
             @change="emit('memory', ($event.target as HTMLInputElement).checked)" />
      <span>把这次测验的结果记入学习记忆</span>
    </label>
    <p class="exam-meta-line">{{ memoryNote }}</p>

    <div class="exam-export">
      <button type="button" class="exam-secondary" :disabled="exporting" @click="emit('export')">
        {{ exporting ? '正在导出…' : '导出并加入文档库' }}
      </button>
      <button v-if="exported" type="button" class="exam-link" @click="emit('open-document', exported.docId)">在文档库打开</button>
      <p v-if="exported" class="exam-meta-line">已导出「{{ exported.name }}」并加入文档库。</p>
      <p v-if="exportError" class="exam-error" role="alert">{{ exportError }}</p>
    </div>

    <div class="exam-result-actions">
      <button type="button" class="exam-primary" @click="emit('again')">再来一套</button>
      <button type="button" class="exam-secondary" @click="emit('review')">回看全部题目</button>
    </div>
  </section>
</template>

<style scoped>
.exam-result { padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; }
.exam-total { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.exam-total strong { font: 700 34px/1 var(--font-mono); color: var(--ink); }
.exam-total span { font: 500 16px/1 var(--font-mono); color: var(--muted); }
.exam-total p { flex-basis: 100%; margin: 2px 0 0; color: var(--muted); font-size: 12.5px; }
.exam-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.exam-table th, .exam-table td { padding: 7px 8px; border-bottom: 1px solid var(--hairline); text-align: start; }
.exam-table th { color: var(--muted); font-weight: 500; font-size: 12px; }
.exam-table td:nth-child(n+2), .exam-table th:nth-child(n+2) { text-align: end; font-family: var(--font-mono); }
.exam-table-total td { font-weight: 600; border-bottom: 0; }
.exam-meta-line { margin: 0; color: var(--muted); font-size: 12.5px; line-height: 1.7; }
.exam-weak h2 { margin: 0 0 4px; font-size: 13.5px; color: var(--secondary); }
.exam-weak ul { margin: 0; padding-inline-start: 18px; color: var(--secondary); font-size: 13px; line-height: 1.8; }
.exam-memory { display: inline-flex; align-items: center; gap: 8px; font-size: 13.5px; color: var(--ink); cursor: pointer; }
.exam-memory.disabled { opacity: .6; cursor: default; }
.exam-export { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.exam-link { border: 0; background: none; color: var(--accent); font: inherit; font-size: 12.5px; cursor: pointer; }
.exam-error { flex-basis: 100%; margin: 0; color: var(--danger); font-size: 12.5px; }
.exam-result-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.exam-primary, .exam-secondary { padding: 8px 16px; border-radius: var(--r-control); font: 600 13px/1 inherit; cursor: pointer; }
.exam-primary { border: 0; background: var(--accent); color: #fff; }
.exam-secondary { border: 1px solid var(--hairline); background: var(--frost); color: var(--secondary); }
</style>
