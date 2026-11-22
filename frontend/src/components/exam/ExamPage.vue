<script setup lang="ts">
/** 模拟测试页壳：页头、横幅、按 view 切换准备 / 出题 / 作答 / 结果 / 损坏，交卷与确认框。 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ConfirmDialog from '../ui/ConfirmDialog.vue'
import ExamSetupPanel from './ExamSetupPanel.vue'
import ExamQuestionCard from './ExamQuestionCard.vue'
import ExamResultPanel from './ExamResultPanel.vue'
import { exam, setExamNotify } from '../../exam/index.ts'
import { SUBJECT_LABELS, TEMPLATE_LABELS } from '../../exam/types.ts'
import { generationPhaseText } from '../../exam/progress.ts'
import { exportPendingMessage } from '../../exam/scoring.ts'
import type { ExamAnswerItem, ExamQuestion } from '../../exam/types.ts'

type DocItem = { id: string; title: string; kind: 'pdf' | 'markdown' | 'word'; size?: number; pageCount: number; sourceMissing: boolean }
const props = defineProps<{ documents: DocItem[]; settingsVersion: number }>()
const emit = defineEmits<{
  settings: []
  import: []
  notify: [text: string]
  'open-document': [id: string]
  imported: [doc: any]
}>()

const state = exam.state
const view = exam.view
const current = exam.current
const questions = computed(() => current.value?.questions || [])
const answers = computed(() => current.value?.answers)
const meta = computed(() => current.value?.meta)
const submitted = computed(() => Boolean(answers.value?.submittedAt))
const setupPanel = ref<InstanceType<typeof ExamSetupPanel>>()
const reviewOpen = ref(false)
const confirm = ref<null | { kind: 'submit' | 'remove' | 'switch' | 'export'; id?: string; template?: 'A' | 'B' | 'C'; title: string; message: string; confirmLabel: string; danger?: boolean }>(null)

onMounted(async () => {
  setExamNotify(text => emit('notify', text))
  exam.setDocuments(props.documents)
  await exam.init()
})
watch(() => props.documents, list => exam.setDocuments(list as DocItem[]), { deep: true })
watch(() => props.settingsVersion, () => exam.refreshSettings())
onBeforeUnmount(() => {
  setExamNotify(null)
  void exam.leave()
})

const statusLine = computed(() => {
  if (view.value === 'generating') return `正在为《${meta.value?.docTitle || '这本书'}》出题 · 已生成 ${state.generation.done}/${state.generation.total}`
  if (view.value === 'taking') return `《${meta.value?.docTitle}》 · 已得 ${exam.live.value} / ${exam.maxScore.value} · 已完成 ${exam.completed.value} / ${questions.value.length}`
  if (view.value === 'result') return `《${meta.value?.docTitle}》 · 已交卷 · 自评 ${answers.value?.result?.total ?? 0} / ${answers.value?.result?.max ?? 0}`
  return '最近的试卷保存在本机文档库，最多 20 套。'
})

const banner = computed<null | { tone: string; text: string }>(() => {
  if (current.value?.banner) return { tone: 'warn', text: current.value.banner }
  if (meta.value && !meta.value.grounded) {
    return { tone: 'warn', text: `本次未读取原文：${meta.value.degradedReason || '读不到原文件'}。题目只依据书名和学习记忆，可能与这本书的讲法不同。` }
  }
  return null
})

const phaseText = computed(() => {
  const generation = state.generation
  const slots = meta.value?.slots.filter(slot => slot.batch === generation.batch) || []
  return generationPhaseText(generation, slots.map(slot => exam.displayNo.value[slot.slot]))
})

/** 作答页的单批重试：部分成功会直接进作答页，刷新后失败批次从 meta 恢复（exam/state.ts restoreGeneration）。 */
const retryable = computed(() => {
  const generation = state.generation
  if (submitted.value || generation.running || !current.value || generation.examId !== current.value.id) return []
  return generation.failedBatches
})
function numberFor(slot: number): number {
  return exam.displayNo.value[slot] ?? slot + 1
}
function itemFor(slot: number): ExamAnswerItem | undefined {
  return answers.value?.items[String(slot)]
}
function isDone(slot: number): boolean {
  const item = itemFor(slot)
  return Boolean(item && (item.choice.length || typeof item.selfScore === 'number'))
}
function jump(slot: number): void {
  const element = document.getElementById(`exam-q-${slot}`)
  if (!element) return
  element.scrollIntoView({ block: 'start', behavior: 'smooth' })
  const first = element.querySelector<HTMLElement>('button:not(:disabled)')
  first?.focus()
}
function askSubmit(): void {
  confirm.value = { kind: 'submit', title: '确认交卷？', message: exam.pending.value.message, confirmLabel: '交卷' }
}
function askRemove(id: string): void {
  const entry = state.list.find(item => item.id === id)
  confirm.value = {
    kind: 'remove', id, title: '放弃这套试卷？', message: `已生成的 ${entry?.count ?? 0} 题会被删除。`, confirmLabel: '放弃', danger: true,
  }
}
async function confirmAction(): Promise<void> {
  const action = confirm.value
  confirm.value = null
  if (!action) return
  if (action.kind === 'submit') await exam.submit()
  else if (action.kind === 'remove' && action.id) await exam.remove(action.id)
  else if (action.kind === 'switch' && action.id && action.template) await exam.switchTemplate(action.id, action.template)
  else if (action.kind === 'export') await exam.exportMarkdown()
}
function askExport(): void {
  const pending = exam.pending.value
  if (pending.unanswered || pending.unscored) {
    confirm.value = { kind: 'export', title: '仍然导出？', message: exportPendingMessage(pending), confirmLabel: '仍然导出' }
    return
  }
  void exam.exportMarkdown()
}
function askSwitch(template: 'A' | 'B' | 'C'): void {
  const entry = current.value
  if (!entry) return
  if (exam.completed.value > 0) {
    confirm.value = {
      kind: 'switch', id: entry.id, template,
      title: '换模板重出？', message: `会按${TEMPLATE_LABELS[template]}重新出全部题目，已作答的 ${exam.completed.value} 题会清空。`,
      confirmLabel: '重新出题',
    }
    return
  }
  void exam.switchTemplate(entry.id, template)
}
function focusSearch(): void {
  if (view.value === 'setup') setupPanel.value?.focusSearch()
  else if (view.value === 'taking') {
    const first = questions.value.find(question => !isDone(question.slot)) || questions.value[0]
    if (first) jump(first.slot)
  } else if (view.value === 'result') {
    document.querySelector<HTMLElement>('.exam-result-actions button')?.focus()
  }
}
defineExpose({ focusSearch })
</script>

<template>
  <section class="page-view exam-page" aria-label="模拟测试">
    <header class="page-heading exam-heading">
      <h1>模拟测试</h1>
      <div class="exam-head-info">
        <p class="page-note">选一本书，让模型先检索原文再出 20 道题：单选、多选由程序判分，大题对照评分要点自评。试卷和作答保存在本机文档库。</p>
        <p class="exam-status" role="status">{{ statusLine }}</p>
      </div>
      <div v-if="view === 'taking' || view === 'result'" class="exam-head-actions">
        <button type="button" class="head-button" data-tip="回到准备区；这套试卷保留在「最近的试卷」里" @click="exam.again()">新的一套</button>
      </div>
    </header>

    <div v-if="banner" class="exam-banner" :class="banner.tone" :role="banner.tone === 'error' ? 'alert' : 'status'">{{ banner.text }}</div>

    <div class="exam-body" aria-live="polite">
      <div v-if="view === 'loading'" class="exam-empty page-card"><span class="spinner"></span> 正在读取试卷…</div>

      <ExamSetupPanel v-else-if="view === 'setup'" ref="setupPanel" :exam="exam" :documents="documents"
                      @settings="emit('settings')" @import="emit('import')"
                      @open="exam.open($event)" @continue="exam.continueGeneration($event)"
                      @remove="askRemove($event)" />

      <section v-else-if="view === 'generating'" class="exam-progress page-card">
        <h2>正在出题</h2>
        <p class="exam-phase">{{ phaseText }}</p>
        <progress :value="state.generation.done" :max="state.generation.total || 20"></progress>
        <p class="exam-meta-line">已生成 {{ state.generation.done }}/{{ state.generation.total }}<template v-if="state.generation.evidence"> · 已读取 {{ state.generation.evidence }} 段原文</template></p>
        <p v-if="state.generation.note" class="exam-meta-line">{{ state.generation.note }}</p>
        <p v-if="meta" class="exam-meta-line">学科判定：{{ SUBJECT_LABELS[meta.subject] }}<template v-if="meta.subjectReason">（{{ meta.subjectReason }}）</template> · {{ TEMPLATE_LABELS[meta.template] }}</p>
        <p v-if="meta?.topicNote" class="exam-meta-line">{{ meta.topicNote }}</p>
        <p v-if="meta?.planNote" class="exam-meta-line">{{ meta.planNote }}</p>

        <div v-if="state.generation.degradeOffer" class="exam-degrade" role="alert">
          <p>{{ state.generation.degradeOffer.reason }}</p>
          <div class="exam-actions">
            <button type="button" class="exam-primary" @click="exam.acceptDegrade()">仍然出题（不读原文）</button>
            <button type="button" class="exam-secondary" @click="exam.rejectDegrade()">取消</button>
          </div>
        </div>

        <p v-if="state.generation.error" class="exam-error" role="alert">{{ state.generation.error }}</p>
        <div v-if="state.generation.error && !state.generation.running" class="exam-actions">
          <button type="button" class="exam-primary" @click="current && exam.continueGeneration(current.id)">重试</button>
          <button type="button" class="exam-secondary" @click="current && exam.remove(current.id)">返回</button>
        </div>
        <p v-if="state.generation.stopped" class="exam-meta-line">已停止。已生成的 {{ questions.length }} 题已保存，可以先作答，或稍后继续出题。</p>
        <p v-for="failed in state.generation.failedBatches" :key="failed" class="exam-meta-line">第 {{ failed + 1 }} 批生成失败，已保留 {{ questions.length }} 题。</p>

        <div v-if="!state.generation.running && state.generation.failedBatches.length" class="exam-actions">
          <button v-for="failed in state.generation.failedBatches" :key="failed" type="button" class="exam-secondary"
                  @click="current && exam.retryBatch(current.id, failed)">重新生成第 {{ failed + 1 }} 批</button>
        </div>
        <div v-if="!state.generation.running && meta && meta.topics.length" class="exam-actions">
          <span class="exam-meta-line">换模板重出：</span>
          <button v-for="template in (['A', 'B', 'C'] as const)" :key="template" type="button" class="exam-secondary"
                  @click="askSwitch(template)">{{ TEMPLATE_LABELS[template] }}</button>
        </div>

        <div class="exam-actions">
          <button v-if="state.generation.running && !state.generation.stopping" type="button" class="exam-secondary" @click="exam.stop()">停止出题</button>
          <button v-else-if="state.generation.stopping" type="button" class="exam-secondary" disabled>停止中…</button>
          <template v-if="!state.generation.running && questions.length">
            <button type="button" class="exam-primary" @click="exam.acceptPartial()">开始作答</button>
            <button type="button" class="exam-secondary" @click="current && exam.continueGeneration(current.id)">继续出题</button>
            <button type="button" class="exam-secondary" @click="current && askRemove(current.id)">放弃这套</button>
          </template>
          <template v-else-if="!state.generation.running && current && !state.generation.error">
            <button type="button" class="exam-primary" @click="exam.continueGeneration(current.id)">继续出题</button>
            <button type="button" class="exam-secondary" @click="askRemove(current.id)">放弃这套</button>
          </template>
        </div>
      </section>

      <template v-else-if="view === 'taking'">
        <div class="exam-scorebar" role="status"><template v-if="submitted">已得 {{ exam.live.value }} / {{ exam.maxScore.value }} · </template>已完成 {{ exam.completed.value }} / {{ questions.length }}</div>
        <p v-if="questions.length < 20" class="exam-meta-line">本卷共 {{ questions.length }} 题，满分按 {{ exam.maxScore.value }} 分计。</p>
        <div v-if="retryable.length" class="exam-actions" role="group" aria-label="重新生成失败的批次">
          <span class="exam-meta-line">第 {{ retryable.map(index => index + 1).join('、') }} 批生成失败：可以先作答，重新生成不影响已作答的题。</span>
          <button v-for="failed in retryable" :key="failed" type="button" class="exam-secondary"
                  @click="current && exam.retryBatch(current.id, failed)">重新生成第 {{ failed + 1 }} 批</button>
        </div>
        <nav class="exam-nav" aria-label="题目导航">
          <button v-for="question in questions" :key="question.slot" type="button" :class="{ done: isDone(question.slot) }" @click="jump(question.slot)">{{ numberFor(question.slot) }}</button>
        </nav>
        <ol class="exam-questions">
          <ExamQuestionCard v-for="question in questions" :key="question.slot" :question="question" :number="numberFor(question.slot)"
                            :answer="itemFor(question.slot)" mode="taking" :submitted="submitted"
                            :locked="Boolean(itemFor(question.slot)?.revealed)"
                            @choose="exam.choose(question.slot, $event)" @reveal="exam.reveal(question.slot)"
                            @score="exam.selfScore(question.slot, $event)" @open-source="meta && emit('open-document', meta.docId)" />
        </ol>
        <footer class="exam-submit">
          <p>多选判分：全部选对 10 分；只选了正确选项但没选全 5 分；选了任何一个错误选项 0 分。交卷时判分。</p>
          <p>大题由你对照评分要点自评，模型不判分。</p>
          <button type="button" class="exam-primary" :disabled="state.submitting" @click="askSubmit">{{ state.submitting ? '正在交卷…' : '交卷' }}</button>
        </footer>
      </template>

      <template v-else-if="view === 'result'">
        <ExamResultPanel v-if="answers?.result && meta" :result="answers.result" :meta="meta" :memory="answers.memory"
                         :finalized="answers.finalizedAt > 0" :doc-missing="exam.docMissing.value"
                         :exporting="state.exporting" :export-error="state.exportError" :exported="answers.exported"
                         @memory="exam.setMemoryWant($event)" @again="exam.again()" @review="reviewOpen = !reviewOpen"
                         @export="askExport" @open-document="emit('open-document', $event)" />
        <ol v-if="reviewOpen" class="exam-questions">
          <!-- 交卷后在结果页展开答案、给大题自评（离开结果页后只读，见 state.selfScore）。 -->
          <ExamQuestionCard v-for="question in questions" :key="question.slot" :question="question" :number="numberFor(question.slot)"
                            :answer="itemFor(question.slot)" mode="review" :submitted="true" :locked="true"
                            :scorable="!answers?.finalizedAt && !current?.readOnly"
                            @reveal="exam.reveal(question.slot)" @score="exam.selfScore(question.slot, $event)"
                            @open-source="meta && emit('open-document', meta.docId)" />
        </ol>
      </template>

      <section v-else-if="view === 'broken'" class="exam-empty page-card">{{ current?.banner || '这套试卷的数据已损坏。' }}</section>
    </div>

    <ConfirmDialog v-if="confirm" :title="confirm.title" :message="confirm.message" :confirm-label="confirm.confirmLabel"
                   :danger="confirm.danger" @confirm="confirmAction" @cancel="confirm = null" />
  </section>
</template>

<style scoped>
.exam-page { display: flex; flex-direction: column; gap: 14px; }
.exam-page > .exam-heading, .exam-page > .exam-banner, .exam-page > .exam-body { width: 100%; max-width: 960px; margin-inline: auto; }
.exam-head-info { display: flex; flex-direction: column; gap: 4px; }
.exam-status { margin: 0; color: var(--secondary); font-size: 13px; }
.exam-banner { padding: 9px 12px; border: 1px solid var(--hairline); border-radius: var(--r-control); font-size: 12.5px; line-height: 1.7; }
.exam-banner.warn { border-color: var(--warning, var(--hairline)); background: var(--warning-soft, var(--fill-2)); color: var(--secondary); }
.exam-body { display: flex; flex-direction: column; gap: 12px; }
.exam-empty { padding: 24px; display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 13.5px; }
.exam-progress { padding: 18px 20px; display: flex; flex-direction: column; gap: 8px; }
.exam-progress h2 { margin: 0; font-size: 15px; }
.exam-phase { margin: 0; color: var(--secondary); font-size: 13.5px; }
.exam-progress progress { display: block; box-sizing: border-box; width: 100%; height: 8px; accent-color: var(--accent); }
.exam-meta-line { margin: 0; color: var(--muted); font-size: 12.5px; line-height: 1.7; }
.exam-error { margin: 0; color: var(--danger); font-size: 13px; }
.exam-degrade { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--warning, var(--hairline)); border-radius: var(--r-control); background: var(--warning-soft, var(--fill-2)); font-size: 13px; }
.exam-degrade p { margin: 0; line-height: 1.7; }
.exam-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.exam-primary, .exam-secondary { padding: 7px 16px; border-radius: var(--r-control); font: 600 13px/1 inherit; cursor: pointer; }
.exam-primary { border: 0; background: var(--accent); color: #fff; }
.exam-primary:disabled { opacity: .6; cursor: default; }
.exam-secondary { border: 1px solid var(--hairline); background: var(--frost); color: var(--secondary); }
.exam-scorebar { padding: 10px 14px; border: 1px solid var(--hairline); border-radius: var(--r-control); background: var(--frost); font: 600 13px/1.4 var(--font-mono); color: var(--secondary); }
.exam-nav { display: flex; gap: 6px; flex-wrap: wrap; }
.exam-nav button { width: 32px; height: 32px; border: 1px solid var(--hairline); border-radius: var(--r-xs); background: var(--frost); color: var(--secondary); font: 12.5px/1 var(--font-mono); cursor: pointer; }
.exam-nav button.done { border-color: var(--accent); color: var(--accent); }
.exam-questions { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.exam-submit { display: flex; flex-direction: column; gap: 8px; padding: 12px 4px 24px; }
.exam-submit p { margin: 0; color: var(--muted); font-size: 12.5px; line-height: 1.7; }
.exam-submit .exam-primary { align-self: flex-start; }
@media (max-width: 760px) {
  .exam-nav { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 4px; }
}
</style>
