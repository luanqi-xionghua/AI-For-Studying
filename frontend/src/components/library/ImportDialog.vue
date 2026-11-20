<script setup lang="ts">
// 「加入文档」窗口：上面拖入或选择文件；下面一行小字说明支持的格式；再下面逐份列出进度。
// Word 会先转成 PDF，转换时显示进度条；失败时写明原因，并建议先手动另存为 PDF。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '../ui/AppIcon.vue'
import { importer, wordProgress, stageText, failureAdvice, learning, learningReady, setLearningEnabled, resetLearningAnswers, type ImportItem } from '../../library/importer'
import OnboardingFields from '../memory/OnboardingFields.vue'
import { selectDocuments } from '../../sdk'
import { documentTitle } from '../../library/kinds'
import type { Doc } from '../../sdk/types'

const props = defineProps<{ dragging?: boolean }>()
const emit = defineEmits<{ close: []; add: [paths: string[]]; open: [doc: Doc] }>()
const dropzone = ref<HTMLButtonElement>()
const choosing = ref(false)
const chooseError = ref('')
const learnError = ref(false)
const learnFields = ref<{ focusFirstUnanswered?: () => void }>()

// 重新作答就收起「已记下」与校验提示。
watch(() => [learning.docLevel, learning.fieldLevel, learning.note], () => {
  learnError.value = false
  if (learning.docLevel || learning.fieldLevel || learning.note) learning.recorded = 0
})

// 有 Word 正在转换时每 250 毫秒刷新一次：进度条和「已用 N 秒」跟着走。
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | undefined
const converting = computed(() => importer.items.some(item => item.word && item.status === 'working'))
watch(converting, value => {
  clearInterval(ticker); ticker = undefined
  if (value) { now.value = Date.now(); ticker = setInterval(() => { now.value = Date.now() }, 250) }
}, { immediate: true })
onBeforeUnmount(() => clearInterval(ticker))
// 关闭弹窗：清空两题与补充，开关状态保留。
onBeforeUnmount(() => resetLearningAnswers())
onMounted(() => { void nextTick(() => dropzone.value?.focus()) })

async function choose() {
  if (choosing.value) return
  if (!learningReady()) { learnError.value = true; void nextTick(() => learnFields.value?.focusFirstUnanswered?.()); return }
  choosing.value = true; chooseError.value = ''
  try { const paths = await selectDocuments(); if (paths.length) emit('add', paths) }
  catch (error: any) { chooseError.value = `无法打开选择文件的窗口：${error?.message || error}` }
  finally { choosing.value = false }
}

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

      <button ref="dropzone" type="button" class="import-drop" :class="{ dragging: props.dragging }" :disabled="choosing" aria-describedby="import-note" @click="choose">
        <span class="import-drop-icon"><AppIcon name="import" :size="26" /></span>
        <strong>{{ props.dragging ? '松开即可加入' : '把文件拖到这里' }}</strong>
        <span>{{ choosing ? '正在打开选择窗口…' : '或点击选择文件，一次可以选多份' }}</span>
      </button>
      <p id="import-note" class="import-note">原生支持 PDF 与 Markdown；Word 文档（.doc / .docx）会先转换为 PDF 再加入。导入不会移动或修改原文件。</p>
      <p v-if="chooseError" class="import-choose-error" role="alert">{{ chooseError }}</p>

      <section class="learn-mode" aria-label="学习模式">
        <label class="learn-switch"><span>开启学习模式</span><input type="checkbox" role="switch" aria-label="开启学习模式" aria-describedby="learn-help" :checked="learning.enabled" @change="setLearningEnabled(($event.target as HTMLInputElement).checked)" /></label>
        <p id="learn-help" class="import-note">先回答两个小问题，答案会作为这批文档的初始学习记忆，只保存在本机。</p>
        <template v-if="learning.enabled">
          <OnboardingFields ref="learnFields" v-model:doc-level="learning.docLevel" v-model:field-level="learning.fieldLevel" v-model:note="learning.note" doc-question="你对要加入的文档内容了解多少？" />
          <p class="import-note">一次加入多份文档时，这组回答会用在这一批的每一份上。</p>
          <p v-if="learnError" class="import-choose-error" role="alert">学习模式已开启：请先回答上面两个问题，再选择文件。</p>
          <p v-else-if="learning.recorded" class="import-note" role="status">已记下这批 {{ learning.recorded }} 份文档的自评。要再加入别的文档，请重新回答。</p>
        </template>
      </section>

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
    </section>
  </div>
</template>

<style scoped>
.import-dialog { width: 480px; max-width: 92vw; max-height: min(720px, 88vh); display: flex; flex-direction: column; text-align: left; padding: 18px 20px 20px; }
.import-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.import-head h2 { margin: 0; }
.import-head .icon-button { width: 32px; height: 32px; }

.import-drop { display: flex; flex-direction: column; align-items: center; gap: 6px; width: 100%; padding: 26px 16px 22px; border: 1.5px dashed color-mix(in srgb, var(--ink) 22%, transparent); border-radius: var(--r-xl); background: color-mix(in srgb, var(--fill-3) 60%, transparent); box-shadow: none; color: var(--ink); cursor: pointer; transition: border-color var(--dur-2) var(--ease-out), background-color var(--dur-2) var(--ease-out); }
.import-drop:hover:not(:disabled), .import-drop:focus-visible { border-color: color-mix(in srgb, var(--accent) 70%, transparent); background: color-mix(in srgb, var(--accent) 7%, transparent); }
.import-drop.dragging { border-color: var(--accent); border-style: solid; background: color-mix(in srgb, var(--accent) 12%, transparent); }
.import-drop:disabled { cursor: progress; opacity: .8; }
.import-drop-icon { display: grid; place-items: center; width: 48px; height: 48px; margin-bottom: 4px; border-radius: 50%; background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }
.import-drop strong { font-size: 15px; font-weight: 650; }
.import-drop > span:last-child { font-size: 12.5px; color: var(--secondary); }

.import-dialog .import-note { margin: 10px 2px 0; font-size: 11.5px; line-height: 1.6; color: var(--muted); }
.import-dialog .import-choose-error { margin: 6px 2px 0; font-size: 12px; color: var(--danger); }

.import-list { list-style: none; margin: 14px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; min-height: 0; }
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
