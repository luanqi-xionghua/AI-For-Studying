<script setup lang="ts">
// 「加入文档」窗口：上面拖入或选择文件；下面一行小字说明支持的格式；再下面逐份列出进度。
// Word 会先转成 PDF，转换时显示进度条；失败时写明原因，并建议先手动另存为 PDF。
// 学习模式开启且没填完时，所有入口都不打开选择框、不入队；父级用 validationTicket 通知这里展示统一提示并聚焦缺失项。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '../ui/AppIcon.vue'
import { importer, wordProgress, stageText, failureAdvice, learning, learningReady, setLearningEnabled, firstMissingLearningField, IMPORT_INCOMPLETE_MESSAGE, type ImportItem, type ImportIntent } from '../../library/importer'
import { chooseLibraryPaths } from '../../library/import-flow'
import OnboardingFields from '../memory/OnboardingFields.vue'
import { selectDocuments } from '../../sdk'
import { documentTitle } from '../../library/kinds'
import type { SelfLevel } from '../../memory/types'
import type { Doc } from '../../sdk/types'

const props = withDefaults(defineProps<{
  dragging?: boolean
  /** 父级的拒绝信号：每次被拒递增；0 表示没有待展示的校验。 */
  validationTicket?: number
  /** 从哪来：普通「加入文档」，还是试卷结果页的「导出并加入文档库」。 */
  intent?: ImportIntent
}>(), { dragging: false, validationTicket: 0, intent: 'library' })
const emit = defineEmits<{ close: []; add: [paths: string[]]; open: [doc: Doc]; interact: [] }>()
const dropzone = ref<HTMLButtonElement>()
const choosing = ref(false)
const chooseError = ref('')
const validationText = ref('')
const learnFields = ref<{ focusFirstUnanswered?: () => void }>()
let disposed = false
const ready = computed(() => learningReady())
const missingField = computed(() => firstMissingLearningField())
const examExport = computed(() => props.intent === 'exam-export')
const ticket = () => props.validationTicket ?? 0

// 重新作答就收起「已记下」；校验提示本身保留到必填全部满足或关掉学习模式（不由每次输入清掉）。
watch(() => [learning.docLevel, learning.fieldLevel, learning.goal, learning.preference, learning.note], () => {
  if (learning.docLevel || learning.fieldLevel || learning.goal || learning.preference || learning.note) learning.recorded = 0
})

// 有 Word 正在转换时每 250 毫秒刷新一次：进度条和「已用 N 秒」跟着走。
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | undefined
const converting = computed(() => importer.items.some(item => item.word && item.status === 'working'))
watch(converting, value => {
  clearInterval(ticker); ticker = undefined
  if (value) { now.value = Date.now(); ticker = setInterval(() => { now.value = Date.now() }, 250) }
}, { immediate: true })
onBeforeUnmount(() => { disposed = true; clearInterval(ticker) })

/**
 * 被拒时展示统一提示：先清空常驻 live 区（重复尝试也能再朗读），下一帧再写提示、再聚焦缺失项；
 * 期间表单已填好或 ticket 已换就什么都不做。普通挂载没有 ticket 时才聚焦虚线框。
 */
async function present(id: number) {
  validationText.value = ''
  if (!id || ready.value) return
  await nextTick()
  if (disposed || ticket() !== id || ready.value) return
  validationText.value = IMPORT_INCOMPLETE_MESSAGE
  await nextTick()
  if (disposed || ticket() !== id || ready.value) return
  learnFields.value?.focusFirstUnanswered?.()
}
onMounted(() => {
  if (ticket()) void present(ticket())
  else if (!examExport.value) void nextTick(() => dropzone.value?.focus())
})
// 已经挂载着（窗口没关又来一次拒绝）时：父级改 ticket，这里的 live 区与焦点跟着更新。
watch(() => props.validationTicket, id => void present(id), { flush: 'post' })

/** 选文件：同步过门禁，通过后才打开原生选择框；选择框打开期间表单变了仍由 enqueue 的第二次检查兜底。 */
async function choose() {
  if (choosing.value || disposed) return
  emit('interact')
  choosing.value = true; chooseError.value = ''
  try {
    const paths = await chooseLibraryPaths(() => selectDocuments())
    if (!disposed && paths?.length) emit('add', paths)
  } catch (error: any) {
    if (!disposed) chooseError.value = `无法打开选择文件的窗口：${error?.message || error}`
  } finally { choosing.value = false }
}
function updateDocLevel(value: 0 | SelfLevel) { learning.docLevel = value; emit('interact') }
function updateFieldLevel(value: 0 | SelfLevel) { learning.fieldLevel = value; emit('interact') }
function updateGoal(value: string) { learning.goal = value; emit('interact') }
function updatePreference(value: string) { learning.preference = value; emit('interact') }
function updateNote(value: string) { learning.note = value; emit('interact') }
function toggleLearning(value: boolean) { setLearningEnabled(value); emit('interact') }

function progress(item: ImportItem) { return wordProgress(item, now.value) }
function seconds(item: ImportItem) { return Math.max(0, Math.floor(((item.finishedAt ?? now.value) - (item.startedAt ?? now.value)) / 1000)) }
function icon(item: ImportItem) { return item.word ? 'word' : /\.(md|markdown)$/i.test(item.name) ? 'markdown' : 'file' }
function stateLabel(item: ImportItem) {
  if (item.status === 'waiting') return '排队中'
  if (item.status === 'working') return item.word ? '转换中' : '正在加入'
  if (item.status === 'done') return '已加入'
  return '未能加入'
}
function detail(item: ImportItem) {
  if (item.status === 'done') return `已转换为 PDF 并加入文档库 · 用时 ${Math.max(1, seconds(item))} 秒`
  return `${stageText(item)} 已用 ${seconds(item)} 秒`
}
const imported = computed(() => importer.items.flatMap(item => item.status === 'done' ? item.docs || [] : []))
const failed = computed(() => importer.items.filter(item => item.status === 'error').length)
const finished = computed(() => importer.items.length > 0 && !importer.running)
</script>

<template>
  <div class="dialog-backdrop" @click.self="emit('close')">
    <section class="confirm-dialog import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title" @keydown.esc.stop.prevent="emit('close')">
      <header class="import-head">
        <h2 id="import-title">加入文档</h2>
        <button type="button" class="icon-button" data-tip="关闭" aria-label="关闭加入文档窗口" @click="emit('close')"><AppIcon name="close" :size="16" /></button>
      </header>

      <div class="import-body">
      <template v-if="!examExport">
        <button ref="dropzone" type="button" class="import-drop" :class="{ 'is-blocked': !ready, dragging: props.dragging && ready }" :disabled="choosing" :aria-label="ready ? '选择要加入的文档' : '先填写学习模式必填项'" :aria-describedby="validationText ? 'import-note import-validation' : 'import-note'" @click="choose">
          <span class="import-drop-icon"><AppIcon name="import" :size="26" /></span>
          <strong>{{ props.dragging && ready ? '松开即可加入' : ready ? '把文件拖到这里' : '先填写学习模式必填项' }}</strong>
          <span>{{ choosing ? '正在打开选择窗口…' : ready ? '或点击选择文件，一次可以选多份' : '填好下面的学习模式回答，就能选择或拖入文件' }}</span>
        </button>
        <p id="import-note" class="import-note">原生支持 PDF 与 Markdown；Word 文档（.doc / .docx）会先转换为 PDF 再加入。导入不会移动或修改原文件。</p>
        <p v-if="chooseError" class="import-choose-error" role="alert">{{ chooseError }}</p>
      </template>
      <p v-else class="import-note import-exam-note">填好下面的学习模式回答后，回到试卷结果页，再点「导出并加入文档库」。关闭本窗口会保留这次填写的内容。</p>

      <section class="learn-mode" aria-label="学习模式">
        <label class="learn-switch"><span>开启学习模式</span><input type="checkbox" role="switch" aria-label="开启学习模式" aria-describedby="learn-help" :checked="learning.enabled" @change="toggleLearning(($event.target as HTMLInputElement).checked)" /></label>
        <p id="learn-help" class="import-note">先回答两个小问题、写下学习目标，答案会作为这批文档的初始学习记忆，只保存在本机。</p>
        <!-- 常驻的 live 区：门禁只播报一次；空的时候不占高度，但仍留在 DOM 里供读屏更新。 -->
        <p id="import-validation" class="import-choose-error import-validation" role="status" aria-live="polite" aria-atomic="true">{{ validationText }}</p>
        <template v-if="learning.enabled">
          <OnboardingFields ref="learnFields" :doc-level="learning.docLevel" :field-level="learning.fieldLevel" :goal="learning.goal" :preference="learning.preference" :note="learning.note" :invalid-field="missingField || undefined" :validation-id="validationText ? 'import-validation' : undefined" doc-question="你对要加入的文档内容了解多少？" @update:doc-level="updateDocLevel" @update:field-level="updateFieldLevel" @update:goal="updateGoal" @update:preference="updatePreference" @update:note="updateNote" />
          <p v-if="!examExport" class="import-note">一次加入多份文档时，这组回答会用在这一批的每一份上。</p>
          <p v-if="learning.recorded" class="import-note" role="status">已记下这批 {{ learning.recorded }} 份文档的学习模式回答。要再加入别的文档，请重新回答。</p>
        </template>
      </section>

      <template v-if="!examExport">
        <ul v-if="importer.items.length" class="import-list" aria-live="polite">
          <li v-for="item in importer.items" :key="item.id" class="import-item" :class="item.status">
            <div class="import-row">
              <AppIcon :name="icon(item)" :size="16" class="import-kind" />
              <span class="import-name" :title="item.path">{{ item.name }}</span>
              <span v-if="item.onboarding" class="import-learn" data-tip="加入成功后会写入初始学习记忆">学习模式</span>
              <span class="import-state"><AppIcon v-if="item.status === 'done'" name="check" :size="12" />{{ stateLabel(item) }}</span>
            </div>
            <template v-if="item.word && (item.status === 'working' || item.status === 'done')">
              <div class="import-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.round(progress(item) * 100)" :aria-label="`${item.name} 转换进度`"><i :style="{ transform: `scaleX(${progress(item)})` }" /></div>
              <p class="import-detail">{{ detail(item) }}</p>
            </template>
            <div v-if="item.status === 'error'" class="import-error" role="alert">
              <p class="import-reason">{{ item.error }}</p>
              <p v-if="failureAdvice(item)" class="import-advice">{{ failureAdvice(item) }}</p>
            </div>
          </li>
        </ul>

        <p v-if="converting" class="import-background">可以先关掉这个窗口，转换会在后台继续。</p>
        <div v-else-if="finished" class="dialog-actions" :class="{ single: !imported.length }">
          <button type="button" @click="emit('close')">{{ failed ? '知道了' : '完成' }}</button>
          <button v-if="imported.length" type="button" class="primary-button" @click="emit('open', imported[0]!)">打开「{{ documentTitle(imported[0]!.name) }}」</button>
        </div>
      </template>

      <div v-else class="dialog-actions single">
        <button type="button" @click="emit('close')">返回试卷</button>
      </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* 本窗口单独加宽到 688（公共 .confirm-dialog 仍是 380，删除确认与记忆编辑不受影响）：
   两侧各留 12px；低于 720 时四选项变 2×2，低于 420 时变 1×4。 */
.import-dialog { box-sizing: border-box; width: min(688px, calc(100vw - 24px)); max-width: none; min-width: 0; max-height: min(760px, calc(100vh - 32px)); display: flex; flex-direction: column; text-align: left; padding: 18px 22px 20px; }
.import-head { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.import-head h2 { margin: 0; }
.import-head .icon-button { width: 32px; height: 32px; }
/* 学习模式展开后内容会超过窗口高度：标题固定，只有虚线框到列表、底部动作为主纵向滚动区。 */
.import-body { flex: 1 1 auto; min-width: 0; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; display: flex; flex-direction: column; padding: 3px 6px 5px 4px; }
.import-body > * { flex-shrink: 0; }
.import-drop, .learn-mode, .import-list, .import-item, .import-row { min-width: 0; }
/* 表单组件是共享的：只在本窗口里让选项换行、文本框吃满宽度，不改记忆编辑页。 */
.import-dialog :deep(.onboarding-question), .import-dialog :deep(.onboarding-note) { min-inline-size: 0; }
.import-dialog :deep(.onboarding-options) { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.import-dialog :deep(.onboarding-option) { min-width: 0; white-space: normal; overflow-wrap: anywhere; }
.import-dialog :deep(.onboarding-option input) { flex: none; }
.import-dialog :deep(.onboarding-note textarea) { display: block; box-sizing: border-box; width: 100%; max-width: 100%; min-width: 0; min-height: 64px; resize: vertical; }
.import-dialog :deep(legend), .import-reason, .import-advice { max-width: 100%; overflow-wrap: anywhere; }
.import-dialog .dialog-actions:not(.single) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (max-width: 719px) {
  .confirm-dialog.import-dialog { padding: 14px 16px; }
  .import-dialog :deep(.onboarding-options) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .import-drop { padding: 18px 12px; }
}
@media (max-width: 419px) {
  .import-dialog :deep(.onboarding-options), .import-dialog .dialog-actions:not(.single) { grid-template-columns: 1fr; }
  /* 特别窄时状态换到文件名下一行，不把名字挤没。 */
  .import-row { flex-wrap: wrap; }
}

.import-drop { display: flex; flex-direction: column; align-items: center; gap: 6px; width: 100%; padding: 26px 16px 22px; border: 1.5px dashed color-mix(in srgb, var(--ink) 22%, transparent); border-radius: var(--r-xl); background: color-mix(in srgb, var(--fill-3) 60%, transparent); box-shadow: none; color: var(--ink); cursor: pointer; transition: border-color var(--dur-2) var(--ease-out), background-color var(--dur-2) var(--ease-out); }
.import-drop:hover:not(:disabled), .import-drop:focus-visible { border-color: color-mix(in srgb, var(--accent) 70%, transparent); background: color-mix(in srgb, var(--accent) 7%, transparent); }
.import-drop.dragging { border-color: var(--accent); border-style: solid; background: color-mix(in srgb, var(--accent) 12%, transparent); }
/* 学习模式还没填完：按钮仍可点（点了会提示并聚焦缺失项），只是不再鼓励拖入。 */
.import-drop.is-blocked { border-color: color-mix(in srgb, var(--ink) 14%, transparent); background: color-mix(in srgb, var(--fill-3) 40%, transparent); }
.import-drop.is-blocked strong { color: var(--secondary); }
.import-drop:disabled { cursor: progress; opacity: .8; }
.import-drop-icon { display: grid; place-items: center; width: 48px; height: 48px; margin-bottom: 4px; border-radius: 50%; background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }
.import-drop strong { font-size: 15px; font-weight: 650; }
.import-drop > span:last-child { font-size: 12.5px; color: var(--secondary); }

.import-dialog .import-note { margin: 10px 2px 0; font-size: 11.5px; line-height: 1.6; color: var(--muted); }
.import-dialog .import-choose-error { margin: 6px 2px 0; font-size: 12px; color: var(--danger); }
.import-dialog .import-validation:empty { margin: 0; }
.import-exam-note { margin-top: 4px; }

.import-list { list-style: none; margin: 14px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.import-item { padding: 10px 12px; border: 1px solid var(--line-soft); border-radius: var(--r-lg); background: color-mix(in srgb, var(--surface, #fff) 40%, transparent); }
.import-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.import-kind { flex: none; color: var(--secondary); }
.import-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 550; }
.import-state { flex: none; display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; color: var(--secondary); }
.import-item.done .import-state { color: var(--success); }
.import-item.error .import-state { color: var(--danger); }

.import-bar { position: relative; height: 6px; margin-top: 9px; border-radius: 999px; background: var(--fill-3); overflow: hidden; }
.import-bar i { position: absolute; inset: 0; border-radius: inherit; background: var(--accent); transform-origin: left center; transition: transform .3s linear; }
.import-item.done .import-bar i { background: var(--success); }
.import-dialog .import-detail { margin: 6px 0 0; font-size: 11.5px; line-height: 1.5; color: var(--secondary); }

.import-error { margin-top: 8px; padding: 8px 10px; border-radius: 10px; background: var(--danger-soft); }
.import-dialog .import-reason { margin: 0; font-size: 12px; line-height: 1.6; color: var(--danger); }
.import-dialog .import-advice { margin: 4px 0 0; font-size: 12px; line-height: 1.6; color: var(--ink); }

.import-dialog .import-background { margin: 12px 2px 0; font-size: 11.5px; color: var(--muted); text-align: center; }
.import-dialog .dialog-actions { margin-top: 16px; }
.import-dialog .dialog-actions.single { grid-template-columns: 1fr; }
.import-dialog .dialog-actions .primary-button { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

@media (prefers-reduced-motion: reduce) { .import-bar i, .import-drop { transition: none; } }

.learn-mode { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line-soft); display: flex; flex-direction: column; gap: 8px; }
.learn-switch { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; font-weight: 600; cursor: pointer; }
.learn-switch input { margin: 0; }
.import-learn { flex: none; padding: 1px 7px; border-radius: var(--r-full); font-size: 10.5px; font-weight: 600; color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
</style>
