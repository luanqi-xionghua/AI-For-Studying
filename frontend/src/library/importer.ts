/**
 * 加入文档的队列：一份一份地交给后端（Word 转换本来就只能排队做），一份失败不影响其余的，
 * 每份的状态、Word 转换走到哪一步、失败原因都记在这里，「加入文档」窗口关了再开也还在。
 * 真正的导入函数由调用方传进来，这个模块不碰桌面接口，单元测试可以直接用。
 */
import { reactive, watch } from 'vue'
import { DOCUMENT_PATTERN, WORD_PATTERN } from './kinds.ts'
import type { Doc } from '../sdk/types.ts'
import { LIMITS, type OnboardingAnswers, type SelfLevel } from '../memory/types.ts'

/** Word 转换走到哪一步：先用 Word / WPS，不行再用 LibreOffice，最后写进文档库。 */
export type ImportStage = 'office' | 'libreoffice' | 'adding'
export type ImportStatus = 'waiting' | 'working' | 'done' | 'error'
export type ImportItem = {
  id: string; path: string; name: string; word: boolean; status: ImportStatus
  stage?: ImportStage; error?: string; docs?: Doc[]
  /** 开始处理、进入当前步骤、结束的时间（毫秒）。 */
  startedAt?: number; stageAt?: number; finishedAt?: number
  /** 进入当前步骤时进度条已经走到的位置：换步骤时进度条只往前走。 */
  base?: number
  /** 学习模式的自评：只有受支持的条目才带；导入成功后据此写入初始学习记忆。 */
  onboarding?: OnboardingAnswers
}
export type ImportOne = (path: string, onStage?: (stage: ImportStage) => void) => Promise<Doc[]>

export const UNSUPPORTED = '不支持这种文件：只能加入 PDF、Markdown 或 Word 文档。'
export const importer = reactive({ items: [] as ImportItem[], running: false })

// ---- 学习模式：开关、两道四档自评、学习目标、偏好说明与一句话补充（导入弹窗与拖放共用同一份状态）----
const LEARNING_KEY = 'kaizhi.import.learning.v1'
function readLearningEnabled(): boolean {
  try { return globalThis.localStorage?.getItem(LEARNING_KEY) === '1' } catch { return false }
}
export const learning = reactive({
  enabled: readLearningEnabled(),
  docLevel: 0 as 0 | SelfLevel,
  fieldLevel: 0 as 0 | SelfLevel,
  goal: '',
  preference: '',
  note: '',
  /** 最近一批记下了几份；0 = 不显示「已记下」那行。 */
  recorded: 0,
})
/** 学习模式里缺的第一项（只看内存里的草稿，不做 UI 副作用）；开关关着或都填了返回 null。 */
export type LearningField = 'docLevel' | 'fieldLevel' | 'goal'
function answered(level: number): boolean { return Number.isInteger(level) && level >= 1 && level <= 4 }
export function firstMissingLearningField(): LearningField | null {
  if (!learning.enabled) return null
  if (!answered(learning.docLevel)) return 'docLevel'
  if (!answered(learning.fieldLevel)) return 'fieldLevel'
  if (!learning.goal.trim()) return 'goal'
  return null
}
/** 学习模式关着，或开着且两题都答了、学习目标也写了。 */
export function learningReady(): boolean {
  return firstMissingLearningField() === null
}
/** 开着且答完 → 返回一份答案（source: 'import'，answeredAt: now）；否则 null。不改状态。 */
export function currentLearningAnswers(now = Date.now()): OnboardingAnswers | null {
  if (!learning.enabled || firstMissingLearningField()) return null
  return {
    docLevel: learning.docLevel as SelfLevel, fieldLevel: learning.fieldLevel as SelfLevel,
    goal: learning.goal.trim().slice(0, LIMITS.goal), preference: learning.preference.trim().slice(0, LIMITS.preference), note: learning.note.trim().slice(0, LIMITS.note),
    answeredAt: now, source: 'import',
  }
}
/** 草稿修订号：开关和五个答案值同步一变就加一；用来判断放行凭据是否还对得上当前草稿。不持久化。 */
let draftRevision = 0
watch(() => [learning.enabled, learning.docLevel, learning.fieldLevel, learning.goal, learning.preference, learning.note] as const,
  () => { draftRevision++ }, { flush: 'sync' })

/** 所有「新建库文档」的操作都走这里：学习模式没填完就拒绝，并发出一次需要展示校验的通知。 */
export type ImportIntent = 'library' | 'exam-export'
export type Admission = { ok: false } | { ok: true; answers: OnboardingAnswers | null; revision: number }
export const IMPORT_INCOMPLETE_MESSAGE = '学习模式已开启：请先完成两道自评并填写学习目标，再加入文档。'
/** seq 每次被拒 +1；App 只监听这个信号决定要不要打开表单并提示。intent 说明是哪个入口被拒。 */
export const importFeedback = reactive({ seq: 0, intent: 'library' as ImportIntent })
export function admitImport(intent: ImportIntent): Admission {
  if (firstMissingLearningField()) {
    importFeedback.intent = intent
    importFeedback.seq++
    return { ok: false }
  }
  return { ok: true, answers: currentLearningAnswers(), revision: draftRevision }
}
export function resetLearningAnswers() {
  learning.docLevel = 0
  learning.fieldLevel = 0
  learning.goal = ''
  learning.preference = ''
  learning.note = ''
  learning.recorded = 0
}
export function markLearningRecorded(count: number) {
  resetLearningAnswers()
  learning.recorded = count
}
/** 一批被接纳时只用一次草稿：有带快照的新条目，且草稿在放行后没再改过。 */
export function finishImportAdmission(gate: Extract<Admission, { ok: true }>, n: number) {
  if (n > 0 && gate.answers && gate.revision === draftRevision) markLearningRecorded(n)
}
export function setLearningEnabled(value: boolean) {
  learning.enabled = value
  // 关掉学习模式只停用这组回答：清掉提示状态，草稿留着，再打开还能接着改。
  if (!value) learning.recorded = 0
  try { globalThis.localStorage?.setItem(LEARNING_KEY, value ? '1' : '0') } catch { /* 存不下就只在这次有效 */ }
}

export function fileName(path: string) { return path.split(/[\\/]/).pop() || path }

/**
 * 排进队列，返回这次新排进去的条目。学习模式没填完时整批拒绝：不生成任何条目（连「不支持」的错误行也没有）、
 * 不发记忆事件；被接纳时这一批的每份受支持文档都带一份同一时刻的答案快照。正在排队的同一个文件不重复排。
 */
export function enqueue(paths: string[]): ImportItem[] {
  const unique = [...new Set(paths.filter(Boolean))]
  if (!unique.length) return []
  const gate = admitImport('library')
  if (!gate.ok) return []
  const added = appendAccepted(unique, gate.answers)
  finishImportAdmission(gate, added.filter(item => item.onboarding).length)
  return added
}
function appendAccepted(paths: string[], answers: OnboardingAnswers | null): ImportItem[] {
  const added: ImportItem[] = []
  for (const path of paths) {
    if (importer.items.some(item => item.path === path && (item.status === 'waiting' || item.status === 'working'))) continue
    const supported = DOCUMENT_PATTERN.test(path)
    const entry: ImportItem = { id: crypto.randomUUID(), path, name: fileName(path), word: WORD_PATTERN.test(path), status: supported ? 'waiting' : 'error', ...(supported ? {} : { error: UNSUPPORTED }) }
    if (supported && answers) entry.onboarding = { ...answers }
    importer.items.push(entry)
    added.push(entry)
  }
  return added
}

/** 依次处理还在等的文件，直到队列空了。每加入成功一份就调用 onImported。 */
export async function runQueue(importOne: ImportOne, onImported: (docs: Doc[], item: ImportItem) => void): Promise<void> {
  if (importer.running) return
  importer.running = true
  try {
    for (let item = next(); item; item = next()) {
      const current = item
      current.status = 'working'
      current.startedAt = current.stageAt = Date.now()
      current.base = 0.04
      try {
        const docs = await importOne(current.path, current.word ? stage => enterStage(current, stage) : undefined)
        current.docs = docs
        current.status = 'done'
        onImported(docs, current)
      } catch (error: any) {
        current.status = 'error'
        current.error = error?.message || String(error)
      } finally { current.finishedAt = Date.now() }
    }
  } finally { importer.running = false }
}
function next() { return importer.items.find(item => item.status === 'waiting') }
function enterStage(item: ImportItem, stage: ImportStage) {
  if (item.stage === stage) return
  const now = Date.now()
  item.base = wordProgress(item, now)
  item.stage = stage
  item.stageAt = now
}

/** 窗口关上时清掉已经结束的条目；还在转换的留着。 */
export function clearFinished() {
  const keep = importer.items.filter(item => item.status === 'waiting' || item.status === 'working')
  importer.items.splice(0, importer.items.length, ...keep)
}

/**
 * Word 的进度条（0–1）。Word / WPS / LibreOffice 都不报告百分比：每一步里按已用时间估一个慢慢逼近上限的值，
 * 换到下一步时从当前位置接着走，真正转换完、写进文档库后才到 100%。
 */
export function wordProgress(item: ImportItem, now = Date.now()): number {
  if (item.status === 'done') return 1
  if (item.status !== 'working') return 0
  const base = item.base ?? 0.04
  const [cap, pace] = item.stage === 'adding' ? [0.98, 0.6] : item.stage === 'libreoffice' ? [0.92, 10] : [0.92, 12]
  const seconds = Math.max(0, now - (item.stageAt ?? now)) / 1000
  return Math.max(base, base + (cap - base) * (1 - Math.exp(-seconds / pace)))
}

/** 进度条下面的那行字。 */
export function stageText(item: ImportItem): string {
  if (item.stage === 'adding') return '已转换为 PDF，正在加入文档库…'
  if (item.stage === 'libreoffice') return 'Word / WPS 没能完成，正在改用 LibreOffice 转换为 PDF…'
  return '正在用 Word / WPS 转换为 PDF…'
}

/** 失败后给的建议：Word 转换失败建议先手动另存为 PDF。 */
export function failureAdvice(item: ImportItem): string {
  if (item.error === UNSUPPORTED || item.error?.includes('找不到这个文件')) return ''
  if (item.word) return '建议先在 Word 或 WPS 里打开这份文档，用「另存为 → PDF」手动转换，再把 PDF 加入文档库。'
  return ''
}
