/**
 * 模拟测试的前端契约：类型、常量、键名、标签、错误文案映射、依赖注入形状。
 *
 * 纯类型与纯函数，**不** import 任何东西：单测可以在 Node 里直接跑，
 * 也保证状态机不把 sdk / settings / document 这些桌面壳依赖带进来。
 */

export type DocKind = 'pdf' | 'markdown' | 'word'
export type ExamType = 'single' | 'multiple' | 'essay'
export type ExamDifficulty = 'easy' | 'medium' | 'hard'
export type ExamSubject = 'stem' | 'humanities' | 'mixed'
export type ExamTemplate = 'A' | 'B' | 'C' | 'custom'
export type ExamTemplateSource = 'auto' | 'user' | 'requirement'
export type ExamStatus = 'draft' | 'taking' | 'done'
export type BatchStatus = 'pending' | 'running' | 'ok' | 'failed' | 'stopped'
export type ExamView = 'loading' | 'setup' | 'generating' | 'taking' | 'result' | 'broken'

export type ExamMix = { single: number; multiple: number; essay: number }

export type ExamDocument = {
  id: string
  title: string
  kind: DocKind
  pageCount: number
  sourceMissing: boolean
}

export type ExamSlot = {
  slot: number
  type: ExamType
  difficulty: ExamDifficulty
  topic: string
  batch: number
}

export type ExamBatch = {
  index: number
  status: BatchStatus
  attempts: number
  error: string
  finishedAt: number
}

export type ExamOption = { key: 'A' | 'B' | 'C' | 'D'; text: string }
export type ExamRubricItem = { point: string; score: number }
export type ExamQuote = { id: string; page: number; line: number; text: string }
export type ExamSource = {
  docId: string
  kind: 'pdf' | 'markdown'
  pages: number[]
  lines: number[]
  evidenceIds: string[]
  quotes: ExamQuote[]
}

export type ExamQuestion = {
  version: 1
  examId: string
  id: string
  slot: number
  batch: number
  type: ExamType
  difficulty: ExamDifficulty
  stem: string
  options: ExamOption[]
  answer: string[] | string
  rubric: ExamRubricItem[]
  explanation: string
  knowledge: string[]
  answerStyle: 'stem' | 'humanities' | ''
  source: ExamSource
  grounded: boolean
  createdAt: number
}

export type ExamMeta = {
  version: 1
  id: string
  docId: string
  docTitle: string
  docKind: DocKind
  pages: number
  createdAt: number
  updatedAt: number
  requirement: string
  subject: ExamSubject
  subjectReason: string
  template: ExamTemplate
  templateSource: ExamTemplateSource
  mix: ExamMix
  topics: { name: string; pages: number[] }[]
  topicNote: string
  planNote: string
  slots: ExamSlot[]
  batches: ExamBatch[]
  grounded: boolean
  degradedReason: string
  model: { presetId: string; presetName: string; provider: string; model: string; effort: string }
  generation: { startedAt: number; finishedAt: number; calls: number; input: number; output: number; estimated: boolean }
}

export type ExamAnswerItem = {
  choice: string[]
  revealed: boolean
  revealedAt: number
  selfScore: number | null
  text?: string
}

export type ExamResult = {
  total: number
  max: number
  count: number
  byType: Record<ExamType, { score: number; max: number; count: number }>
  weak: { tag: string; lost: number; count: number }[]
  unanswered: number
  unscored: number
  elapsedMs: number
}

export type ExamAnswers = {
  version: 1
  examId: string
  startedAt: number
  elapsedMs: number
  updatedAt: number
  items: Record<string, ExamAnswerItem>
  submittedAt: number
  result: ExamResult | null
  memory: { want: boolean; sentAt: number; skipped: '' | 'unchecked' | 'doc-removed' }
  finalizedAt: number
  exported: { name: string; docId: string; at: number } | null
}

export type ExamIndexEntry = {
  id: string
  docId: string
  title: string
  docKind: DocKind
  createdAt: number
  updatedAt: number
  status: ExamStatus
  count: number
  max: number
  answered: number
  score: number | null
  template: ExamTemplate
  grounded: boolean
}

export type ExamIndex = {
  version: 1
  updatedAt: number
  activeId: string
  list: ExamIndexEntry[]
}

/** 交卷后交给学习记忆的事件：只有数字与标签，永远不含题干 / 选项 / 答案原文。 */
export type QuizResultEvent = {
  type: 'quiz-result'
  docId: string
  title: string
  examId: string
  total: number
  max: number
  byType: Record<ExamType, number>
  weak: { tag: string; lost: number }[]
  selfAssessed: true
  note: string
  at: number
}

export const EXAM_LIMITS = Object.freeze({
  questions: 20,
  perBatch: 5,
  batches: 4,
  points: 10,
  requirement: 200,
  stem: 600,
  option: 200,
  answer: 1500,
  explanation: 600,
  rubricPoint: 120,
  rubricMin: 3,
  rubricMax: 5,
  knowledge: 3,
  knowledgeChars: 12,
  perTopic: 3,
  topicsMin: 7,
  topicsMax: 12,
  evidencePerQuestion: 6,
  quotes: 2,
  quoteChars: 160,
  exams: 20,
  attempts: 2,
  planTimeoutMs: 120_000,
  batchTimeoutMs: 240_000,
  planOutputChars: 6_000,
  batchOutputChars: 40_000,
  answerDebounceMs: 400,
  settingBytes: 900 * 1024,
  exportBytes: 16 * 1024 * 1024,
  essayText: 4000,
})

export const EXAM_KEYS = {
  index: 'exam.v1.index',
  brokenIndex: 'exam.v1.index.broken',
  meta: (id: string) => `exam.v1.${id}.meta`,
  answers: (id: string) => `exam.v1.${id}.a`,
  question: (id: string, slot: number) => `exam.v1.${id}.q.${slot}`,
}

export const TEMPLATES: Record<'A' | 'B' | 'C', { name: string; mix: ExamMix; subject: ExamSubject }> = {
  A: { name: '计算/推导型', mix: { single: 10, multiple: 4, essay: 6 }, subject: 'stem' },
  B: { name: '记忆/论述型', mix: { single: 12, multiple: 3, essay: 5 }, subject: 'humanities' },
  C: { name: '混合/未知', mix: { single: 12, multiple: 4, essay: 4 }, subject: 'mixed' },
}

export const TYPE_LABELS: Record<ExamType, string> = { single: '单选', multiple: '多选', essay: '大题' }
export const TYPE_NAMES: Record<ExamType, string> = { single: '单选题', multiple: '多选题', essay: '大题' }
export const DIFFICULTY_LABELS: Record<ExamDifficulty, string> = { easy: '易', medium: '中', hard: '难' }
export const SUBJECT_LABELS: Record<ExamSubject, string> = {
  stem: '理工类', humanities: '文科类', mixed: '混合或未能判断',
}
export const TEMPLATE_LABELS: Record<ExamTemplate, string> = {
  A: 'A 计算/推导型', B: 'B 记忆/论述型', C: 'C 混合型', custom: '按出题要求',
}
export const STATUS_LABELS: Record<ExamStatus, string> = { draft: '未出完', taking: '作答中', done: '已交卷' }

export type ExamErrorCode =
  | 'no-preset' | 'no-model' | 'plan-timeout' | 'batch-timeout' | 'format'
  | 'invalid' | 'output' | 'no-topics' | 'model' | 'connection' | 'aborted'
  | 'batch-failed' | 'all-failed'

const ERROR_TEXTS: Record<ExamErrorCode, string> = {
  'no-preset': '还没有模型预设：请先在 设置 → AI 里点「新建预设」添加一个。',
  'no-model': '模拟测试用的模型预设没有选模型：请点模型按钮选一个。',
  'plan-timeout': '出卷规划超时（120 秒），请稍后重试。',
  'batch-timeout': '第 {batch} 批生成超时（240 秒）。',
  format: '模型返回的不是有效的 JSON。',
  invalid: '第 {batch} 批没有通过校验：{first}',
  output: '模型输出过长，已停止。',
  'no-topics': '没能从这本书里整理出知识点。可以换一个模型，或在出题要求里写明考查范围。',
  model: '模型请求失败：{message}',
  connection: '本机连接已断开，请重新打开模拟测试页。',
  aborted: '已停止。',
  'batch-failed': '第 {batch} 批生成失败，已保留 {count} 题。',
  'all-failed': '这次没能出成试卷：{message}',
}

/** 出题错误的成品文案（第 7.8 节）。`batch` 是第几批（从 1 起）。 */
export function friendlyExamError(
  code: ExamErrorCode | string,
  detail: { batch?: number; message?: string; count?: number; first?: string } = {},
): string {
  const text = ERROR_TEXTS[code as ExamErrorCode]
  if (!text) return detail.message || '出题失败，请稍后重试。'
  return text
    .replace('{batch}', String(detail.batch ?? 1))
    .replace('{count}', String(detail.count ?? 0))
    .replace('{first}', detail.first || '')
    .replace('{message}', (detail.message || '未知原因').replace(/\s+/g, ' ').slice(0, 80))
}

const EXPORT_TEXTS: Record<string, string> = {
  EXAM_ARGS: '导出失败：参数无效，请重新打开模拟测试页再试。',
  EXAM_EMPTY: '这套试卷没有可导出的内容。',
  EXAM_TOO_LARGE: '试卷内容超过 16 MB，无法导出。',
  EXAM_ENCODING: '试卷里有无法保存的字符，导出失败。',
  EXAM_DIR: '选择的保存位置不存在，请换一个文件夹。',
  EXAM_LOCATION: '不能保存到应用的数据目录，请换一个文件夹（例如「文档」）。',
  EXAM_NOT_FILE: '这个名字已经被一个文件夹占用，请换一个文件名。',
  EXAM_DENIED: '没有写入权限：文件可能正被其他程序打开，或位于只读位置。',
  EXAM_WRITE: '写入文件失败，请换一个位置再试。',
  EXAM_IMPORT: '文件已保存到你选的位置，但没能加入文档库。可以在文档库里手动「加入文档」。',
}

/** 从 "EXAM_xxx：中文说明" 里取出错误码；取不到返回 ''。 */
export function examErrorCode(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? '')
  const match = /^(EXAM_[A-Z_]+)[：:](.*)$/s.exec(text.trim())
  return match ? match[1] : ''
}

/** 导出 / 加入文档库失败时的页面文案（第 12.5 节）。永远不把路径透给页面。 */
export function friendlyExamExportError(error: unknown): string {
  const code = examErrorCode(error)
  if (code) return EXPORT_TEXTS[code] || '导出失败：本机连接出错，请重试。'
  return '导出失败：本机连接出错，请重试。'
}

export type OpenErrorCode = 'password' | 'missing' | 'open'

/** 打开原文失败的分类（第 7.7 节）。正则与 chat/attachments.ts 的 friendlyDocError 保持一致。 */
export function classifyOpenError(error: unknown): OpenErrorCode {
  const name = error instanceof Error ? error.name : ''
  const text = error instanceof Error ? error.message : String(error ?? '')
  if (name === 'PasswordException' || /PasswordException/i.test(text)) return 'password'
  if (/TEMP_MISSING|No such file|Errno 2|找不到|文件不存在|源文件缺失/i.test(text)) return 'missing'
  return 'open'
}

/** 第 7.7 节的降级选择卡文案。 */
export function degradeOfferText(code: OpenErrorCode, title: string): string {
  const name = title || '这本书'
  if (code === 'password') return `《${name}》已加密：请先在阅读器里打开并输入密码（本次运行内有效），再回来出题。`
  if (code === 'missing') return `《${name}》的原文件找不到或已被修改：请先在文档库里重新定位。`
  return `没能读取《${name}》的原文。`
}

export type Connection = {
  provider: string
  baseUrl: string
  protocol: string
  model: string
  effort: string
  vision: boolean
}

export type UsageNumbers = { input: number; output: number; reasoning: number; estimated: boolean }

export type CallHooks = {
  onProgress(text: string): void
  onEvidence(total: number): void
  onUsage(usage: UsageNumbers): void
}

export type PlanData = {
  subject: ExamSubject
  reason: string
  topics: { name: string; pages: number[] }[]
  mix: ExamMix | null
  note: string
}

export type PlanInput = {
  doc: { id: string; title: string; kind: DocKind }
  source: { context: unknown } | null
  requirement: string
  connection: Connection
  memory: string
  limits: unknown
  grounded: boolean
  degradedReason: string
}

export type PlanOutcome =
  | { ok: true; plan: PlanData; pages: number; evidenceCount: number }
  | { ok: false; code: 'password' | 'missing' | 'open' | 'scanned' | 'timeout' | 'format' | 'output' | 'empty' | 'model' | 'aborted'; error: string }

export type BatchInput = {
  examId: string
  doc: { id: string; title: string; kind: DocKind }
  source: { context: unknown } | null
  anchorPage: number
  meta: ExamMeta
  batch: number
  slots: ExamSlot[]
  displayNo: Record<number, number>
  previous: string[]
  saturated: string[]
  primaryCounts: Record<string, number>
  fingerprints: string[]
  attempt: 1 | 2
  retryErrors: string[]
  connection: Connection
  memory: string
  limits: unknown
}

export type BatchOutcome =
  | { ok: true; questions: ExamQuestion[] }
  | { ok: false; errors: string[]; reason: string; aborted?: true; timeout?: true }

export type ExportOutcome =
  | { cancelled: true }
  | { cancelled?: false; document: { id: string; name?: string }; name: string; bytes: number }

export type LoadedExam = {
  id: string
  meta: ExamMeta | null
  newer: boolean
  answers: ExamAnswers
  answersBroken: boolean
  questions: ExamQuestion[]
  missingSlots: number[]
}

/** `exam/storage.ts` 的实现形状。放这里是为了让状态机与单测不必 import storage.ts。 */
export type ExamStore = {
  loadIndex(): Promise<{ index: ExamIndex; broken: boolean; newer: boolean }>
  saveIndex(index: ExamIndex): Promise<void>
  mutateIndex<T>(mutate: (index: ExamIndex) => ExamIndex | Promise<ExamIndex>, after?: (index: ExamIndex) => T | Promise<T>): Promise<T>
  saveEntry(entry: ExamIndexEntry, activeId?: string): Promise<void>
  loadMeta(id: string): Promise<ExamMeta | null | 'newer'>
  saveMeta(meta: ExamMeta): Promise<void>
  deleteMeta(id: string): Promise<void>
  loadAnswers(id: string): Promise<{ answers: ExamAnswers; broken: boolean }>
  saveAnswers(answers: ExamAnswers): Promise<void>
  deleteAnswers(id: string): Promise<void>
  loadQuestion(examId: string, slot: number): Promise<ExamQuestion | null>
  saveQuestion(question: ExamQuestion): Promise<void>
  deleteQuestion(examId: string, slot: number): Promise<void>
  loadExam(id: string): Promise<LoadedExam>
  evict(id: string): Promise<void>
  evictForRoom(keepId: string, busyId?: string): Promise<string[]>
  saveBrokenIndex(raw: string): Promise<void>
  flush(): Promise<void>
  freeze(): void
  unfreeze(): void
  frozen(): boolean
}

export type ExamDeps = {
  store: ExamStore
  plan(input: PlanInput, signal: AbortSignal, hooks: CallHooks): Promise<PlanOutcome>
  batch(input: BatchInput, signal: AbortSignal, hooks: CallHooks): Promise<BatchOutcome>
  openSource(doc: { id: string; title: string; kind: DocKind }, signal: AbortSignal): Promise<{ context: unknown; close(): Promise<void> | void }>
  memory(doc: { id: string; title: string }): Promise<string>
  emit(event: QuizResultEvent): void
  exportMarkdown(markdown: string, title: string): Promise<ExportOutcome>
  settings(): any
  choiceStorage?: Pick<Storage, 'getItem' | 'setItem'> | null
  notify(message: string): void
  reportFailure(id: string, label: string, error: unknown, retry: () => Promise<void>): void
  clearFailure(id: string): void
  setBusy(on: boolean): void
  now(): number
  uuid(): string
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
}
