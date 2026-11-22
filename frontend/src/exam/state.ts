/**
 * 模拟测试的响应式状态机。
 *
 * 只依赖注入进来的 deps（store / plan / batch / openSource / memory / emit / 设置读取…），
 * **不** import sdk、settings 或 document：单测可以在 Node 里直接跑，不必拉起桌面壳。
 */

import { computed, reactive } from 'vue'
import type {
  BatchInput, BatchOutcome, CallHooks, ExamAnswers, ExamDeps, ExamDocument, ExamIndexEntry, ExamMeta,
  ExamQuestion, ExamResult, ExamSlot, ExamStatus, ExamTemplate, ExamView, PlanData, PlanOutcome,
  QuizResultEvent,
} from './types.ts'
import { EXAM_LIMITS, STATUS_LABELS, TEMPLATES, friendlyExamError } from './types.ts'
import { buildSlots, displayNumbers, mixPreview, resolveMix, topicCap } from './slots.ts'
import { fingerprintOf, primaryCountsOf } from './validate.ts'
import { completedCount, liveScore, pendingSummary, scoreExam } from './scoring.ts'
import { loadExamChoice, resolveExamChoice, saveExamChoice } from './choice.ts'
import type { ChatModelChoice } from '../chat/types.ts'

type SetupTemplate = 'auto' | 'A' | 'B' | 'C'

export function createExamState(deps: ExamDeps) {
  const state = reactive({
    ready: false,
    view: 'loading' as ExamView,
    indexBroken: false,
    indexNewer: false,
    list: [] as ExamIndexEntry[],
    setup: { docId: '', query: '', requirement: '', template: 'auto' as SetupTemplate },
    choice: loadExamChoice(deps.choiceStorage) as ChatModelChoice,
    current: null as null | {
      id: string
      meta: ExamMeta
      questions: ExamQuestion[]
      answers: ExamAnswers
      readOnly: boolean
      newer: boolean
      banner: string
    },
    generation: {
      examId: '',
      running: false,
      stopping: false,
      phase: 'idle' as 'idle' | 'plan' | 'batch',
      batch: -1,
      attempt: 0,
      done: 0,
      total: Number(EXAM_LIMITS.questions),
      note: '',
      evidence: 0,
      error: '',
      failedBatches: [] as number[],
      onlyBatch: -1,
      degradeOffer: null as null | { reason: string },
      stopped: false,
    },
    submitting: false,
    exporting: false,
    exportError: '',
    settingsVersion: 0,
  })

  const docState = reactive({ list: [] as ExamDocument[] })
  let visible = true
  let visibleSince = 0
  let answerTimer: unknown = null
  let generationController: AbortController | null = null
  let generationTask: Promise<void> | null = null
  /** 正在生成的那套卷：允许用户在出题中打开另一套试卷，写入仍落在这里。 */
  let generating: { id: string; meta: ExamMeta; questions: ExamQuestion[] } | null = null
  let generationEpoch = 0
  let generationToken = 0

  // ---------------------------------------------------------------- 派生值

  const view = computed(() => state.view)
  const current = computed(() => state.current)
  const list = computed(() => state.list)
  const resolved = computed(() => {
    void state.settingsVersion
    return resolveExamChoice(deps.settings(), state.choice)
  })
  const selectedDoc = computed(() => docState.list.find(doc => doc.id === state.setup.docId) || null)
  const docMissing = computed(() => Boolean(state.current && !docState.list.some(doc => doc.id === state.current!.meta.docId)))
  const maxScore = computed(() => (state.current?.questions.length || 0) * EXAM_LIMITS.points)
  const live = computed(() => (state.current ? liveScore(state.current.questions, state.current.answers) : 0))
  const completed = computed(() => (state.current ? completedCount(state.current.questions, state.current.answers) : 0))
  const pending = computed(() => pendingSummary(state.current?.questions || [], state.current?.answers || blankAnswers()))
  const displayNo = computed(() => {
    const meta = state.current?.meta
    if (!meta) return {} as Record<number, number>
    return displayNumbers(meta.slots, (state.current?.questions || []).map(question => question.slot))
  })

  const startBlocker = computed(() => {
    if (!state.setup.docId) return '先选一本书。'
    const doc = selectedDoc.value
    if (!doc || doc.sourceMissing) return '原文件已移动，请先在文档库里重新定位。'
    if (!resolved.value) return friendlyExamError('no-preset')
    if (!resolved.value.model) return friendlyExamError('no-model')
    if (state.generation.running) return '正在给另一套试卷出题，请等它完成或先停止。'
    return ''
  })

  const preview = computed(() => mixPreview(state.setup.template === 'auto' ? null : state.setup.template))

  const recent = computed(() => state.list.map(entry => {
    const missing = !docState.list.some(doc => doc.id === entry.docId)
    const parts: string[] = []
    if (entry.status === 'draft') parts.push(`未出完 · 已生成 ${entry.count}/20 题`)
    else if (entry.status === 'taking') parts.push(`作答中 · 已完成 ${entry.answered}/${entry.count}`)
    else parts.push(`已交卷 · 自评 ${entry.score ?? 0}/${entry.max}`)
    if (missing) parts.push('原书已从文档库移除')
    if (!entry.grounded) parts.push('未读取原文')
    return { entry, statusText: parts.join(' · '), missing, label: STATUS_LABELS[entry.status] }
  }))

  // ---------------------------------------------------------------- 本地工具

  function blankAnswers(): ExamAnswers {
    return {
      version: 1, examId: '', startedAt: 0, elapsedMs: 0, updatedAt: 0, items: {}, submittedAt: 0,
      result: null, memory: { want: true, sentAt: 0, skipped: '' }, finalizedAt: 0, exported: null,
    }
  }

  function docExists(id: string): boolean {
    return docState.list.some(doc => doc.id === id)
  }

  function cancelAnswerTimer(): void {
    if (answerTimer !== null) {
      deps.clearTimer(answerTimer)
      answerTimer = null
    }
  }

  function scheduleAnswers(): void {
    cancelAnswerTimer()
    answerTimer = deps.setTimer(() => {
      answerTimer = null
      void saveAnswers()
    }, EXAM_LIMITS.answerDebounceMs)
  }

  async function saveAnswers(): Promise<void> {
    const entry = state.current
    if (!entry) return
    entry.answers.updatedAt = deps.now()
    await deps.store.saveAnswers(entry.answers)
  }

  async function patchEntry(id: string, patch: Partial<ExamIndexEntry>): Promise<void> {
    await deps.store.mutateIndex(index => ({
      ...index,
      list: index.list.map(entry => (entry.id === id ? { ...entry, ...patch, updatedAt: deps.now() } : entry)),
    }))
    const fresh = await deps.store.loadIndex()
    state.list = fresh.index.list
  }

  function syncClock(): void {
    const entry = state.current
    const counting = Boolean(entry && state.view === 'taking' && visible && !entry.readOnly && !entry.answers.submittedAt)
    if (counting && visibleSince === 0) {
      visibleSince = deps.now()
      return
    }
    if (!counting && visibleSince > 0 && entry) {
      entry.answers.elapsedMs += Math.max(0, deps.now() - visibleSince)
      visibleSince = 0
    }
  }

  function stopClock(): void {
    if (visibleSince > 0 && state.current) {
      state.current.answers.elapsedMs += Math.max(0, deps.now() - visibleSince)
      visibleSince = 0
    }
  }

  function generationHooks(): CallHooks {
    return {
      onProgress: text => { state.generation.note = text },
      onEvidence: total => { state.generation.evidence = total },
      onUsage: usage => {
        const meta = state.current?.meta
        if (!meta) return
        meta.generation.calls += 1
        meta.generation.input += usage.input
        meta.generation.output += usage.output
        meta.generation.estimated = meta.generation.estimated || usage.estimated
      },
    }
  }

  function connectionOf(): BatchInput['connection'] {
    const resolvedValue = resolved.value
    return {
      provider: resolvedValue?.provider || '',
      baseUrl: resolvedValue?.baseUrl || '',
      protocol: resolvedValue?.protocol || '',
      model: resolvedValue?.model || '',
      effort: resolvedValue?.effort || '',
      vision: true,
    }
  }

  function entryOf(meta: ExamMeta, patches: Partial<ExamIndexEntry> = {}, status?: ExamStatus): ExamIndexEntry {
    const count = state.current?.questions.length ?? 0
    return {
      id: meta.id,
      docId: meta.docId,
      title: meta.docTitle,
      docKind: meta.docKind,
      createdAt: meta.createdAt,
      updatedAt: deps.now(),
      status: status || (count ? 'taking' : 'draft'),
      count,
      max: count * EXAM_LIMITS.points,
      answered: completed.value,
      score: null,
      template: meta.template,
      grounded: meta.grounded,
      ...patches,
    }
  }

  function buildEvent(meta: ExamMeta, answers: ExamAnswers): QuizResultEvent | null {
    const result = answers.result
    if (!result) return null
    const notes: string[] = []
    if (result.unanswered) notes.push(`未作答 ${result.unanswered} 题`)
    if (result.unscored) notes.push(`大题未自评 ${result.unscored} 道`)
    if (!meta.grounded) notes.push('本次未读取原文')
    return {
      type: 'quiz-result',
      docId: meta.docId,
      title: meta.docTitle,
      examId: meta.id,
      total: result.total,
      max: result.max,
      byType: {
        single: result.byType.single.score,
        multiple: result.byType.multiple.score,
        essay: result.byType.essay.score,
      },
      weak: result.weak.map(item => ({ tag: item.tag, lost: item.lost })),
      selfAssessed: true,
      note: notes.join('；'),
      at: deps.now(),
    }
  }

  /** 离开结果页时写记忆（第 11.6 节）：整套只写一次，发出的事件撤不回，所以只在这里发。 */
  function finalizeRecord(meta: ExamMeta, answers: ExamAnswers): boolean {
    if (!answers.submittedAt || answers.finalizedAt > 0) return false
    answers.finalizedAt = deps.now()
    if (!answers.memory.want || answers.memory.sentAt > 0) return true
    if (!docExists(meta.docId)) {
      answers.memory.skipped = 'doc-removed'
      return true
    }
    const event = buildEvent(meta, answers)
    if (event) {
      deps.emit(event)
      answers.memory.sentAt = deps.now()
      answers.memory.skipped = ''
    }
    return true
  }

  // ---------------------------------------------------------------- 初始化与恢复

  async function init(): Promise<void> {
    if (state.ready) return
    const loaded = await deps.store.loadIndex()
    state.indexBroken = loaded.broken
    state.indexNewer = loaded.newer
    state.list = loaded.index.list
    state.ready = true
    state.view = 'setup'

    if (loaded.newer || loaded.broken) return

    // 恢复：出题中关窗 → running 批改 stopped；结果页关窗 → 补发记忆；0 题的草稿删掉。
    for (const item of [...state.list]) {
      const meta = await deps.store.loadMeta(item.id)
      if (meta === 'newer' || !meta) continue
      if (item.status === 'draft') {
        if (meta.batches.some(batch => batch.status === 'running')) {
          meta.batches = meta.batches.map(batch => (batch.status === 'running' ? { ...batch, status: 'stopped' } : batch))
          await deps.store.saveMeta(meta)
        }
        const questions = await deps.store.loadExam(item.id)
        if (!questions.questions.length && !questions.missingSlots.length) {
          await deps.store.evict(item.id)
          state.list = state.list.filter(entry => entry.id !== item.id)
        }
        continue
      }
      if (item.status === 'done') {
        const answers = (await deps.store.loadAnswers(item.id)).answers
        if (answers.submittedAt && answers.finalizedAt === 0 && finalizeRecord(meta, answers)) {
          await deps.store.saveAnswers(answers)
        }
      }
    }

    const active = loaded.index.activeId
    const activeEntry = state.list.find(item => item.id === active)
    if (activeEntry && activeEntry.status === 'taking') await open(active)
  }

  function setDocuments(next: ExamDocument[]): void {
    docState.list = (Array.isArray(next) ? next : []).map(doc => ({
      id: String(doc.id || ''),
      title: String(doc.title || ''),
      kind: doc.kind === 'markdown' || doc.kind === 'word' ? doc.kind : 'pdf',
      pageCount: Number(doc.pageCount) || 0,
      sourceMissing: Boolean(doc.sourceMissing),
    }))
    if (state.current && state.view === 'taking') syncClock()
  }

  function selectDocument(id: string): void {
    if (state.generation.running) return
    state.setup.docId = id
  }

  function setRequirement(text: string): void {
    state.setup.requirement = String(text ?? '').slice(0, EXAM_LIMITS.requirement)
  }

  function setTemplate(template: SetupTemplate): void {
    state.setup.template = template
  }

  function setChoice(next: ChatModelChoice): void {
    state.choice = next
    saveExamChoice(next, deps.choiceStorage)
  }

  /** 设置里改了预设 / 模型后由页面调用，让 resolved 重新解析。 */
  function refreshSettings(): void {
    state.settingsVersion += 1
  }

  function setVisible(on: boolean): void {
    if (visible === on) return
    syncClock()
    visible = on
    syncClock()
  }

  // ---------------------------------------------------------------- 打开与作答

  async function open(id: string): Promise<void> {
    if (state.current?.id && state.current.id !== id) await leave()
    const loaded = await deps.store.loadExam(id)
    const entry = state.list.find(item => item.id === id)
    if (loaded.newer) {
      if (loaded.meta) {
        state.current = {
          id, meta: loaded.meta, questions: [], answers: loaded.answers, readOnly: true, newer: true,
          banner: '这套试卷由更新版本创建，请升级后再打开。',
        }
        state.view = 'broken'
      }
      return
    }
    if (!loaded.meta) {
      state.list = state.list.filter(item => item.id !== id)
      deps.notify('这套试卷的数据已损坏，已从清单里移除。')
      state.view = 'setup'
      return
    }
    stopClock()
    const readOnly = loaded.answers.finalizedAt > 0 || loaded.newer
    state.current = {
      id,
      meta: loaded.meta,
      questions: loaded.questions,
      answers: loaded.answers,
      readOnly,
      newer: false,
      banner: loaded.answersBroken ? '作答记录损坏，已重置。' : '',
    }
    if (loaded.missingSlots.length) {
      state.current.banner = `${state.current.banner ? `${state.current.banner} ` : ''}第 ${loaded.missingSlots[0] + 1} 题数据损坏，已跳过。`
    }
    if (loaded.answers.submittedAt) state.view = 'result'
    else if (loaded.questions.length) state.view = 'taking'
    else if (entry && entry.status === 'draft') state.view = 'generating'
    else state.view = 'setup'
    if (state.view === 'taking') syncClock()
    await patchEntry(id, { updatedAt: deps.now() })
    await deps.store.mutateIndex(index => ({ ...index, activeId: id }))
  }

  function choose(slot: number, key: string): void {
    const entry = state.current
    if (!entry || state.view !== 'taking' || entry.readOnly || entry.answers.submittedAt) return
    const question = entry.questions.find(item => item.slot === slot)
    if (!question || question.type === 'essay') return
    const item = entry.answers.items[String(slot)] || (entry.answers.items[String(slot)] = {
      choice: [], revealed: false, revealedAt: 0, selfScore: null,
    })
    if (item.revealed) return
    if (question.type === 'single') {
      item.choice = [key]
    } else {
      const set = new Set(item.choice)
      if (set.has(key)) set.delete(key)
      else set.add(key)
      item.choice = [...set].sort()
    }
    if (!entry.answers.startedAt) entry.answers.startedAt = deps.now()
    if (entry.meta.batches.every(batch => batch.status === 'ok') && state.list.find(one => one.id === entry.id)?.status === 'draft') {
      void patchEntry(entry.id, { status: 'taking' })
    }
    scheduleAnswers()
  }

  function reveal(slot: number): void {
    const entry = state.current
    if (!entry) return
    const item = entry.answers.items[String(slot)] || (entry.answers.items[String(slot)] = {
      choice: [], revealed: false, revealedAt: 0, selfScore: null,
    })
    item.revealed = !item.revealed
    if (item.revealed && !item.revealedAt) item.revealedAt = deps.now()
    scheduleAnswers()
  }

  function selfScore(slot: number, value: number): void {
    const entry = state.current
    if (!entry || entry.readOnly || !Number.isFinite(value)) return
    const submitted = entry.answers.submittedAt > 0
    // 结果页可以改自评；离开结果页（finalize 之后）只读（第 17 章 Q10）。
    if (submitted && (entry.answers.finalizedAt > 0 || state.view !== 'result')) return
    const question = entry.questions.find(item => item.slot === slot)
    const item = entry.answers.items[String(slot)]
    if (!question || question.type !== 'essay' || !item?.revealed) return
    item.selfScore = Math.max(0, Math.min(EXAM_LIMITS.points, Math.round(value)))
    item.revealedAt = item.revealedAt || deps.now()
    if (submitted) {
      entry.answers.result = scoreExam(entry.questions, entry.answers)
      cancelAnswerTimer()
      void saveAnswers()
      void patchEntry(entry.id, { score: entry.answers.result.total, answered: completedCount(entry.questions, entry.answers) })
    } else {
      scheduleAnswers()
    }
  }

  async function submit(): Promise<void> {
    const entry = state.current
    if (!entry || state.submitting || entry.answers.submittedAt || state.view !== 'taking') return
    state.submitting = true
    try {
      stopClock()
      cancelAnswerTimer()
      const answers = entry.answers
      answers.submittedAt = deps.now()
      answers.result = scoreExam(entry.questions, answers)
      answers.memory = { want: true, sentAt: 0, skipped: docExists(entry.meta.docId) ? '' : 'doc-removed' }
      answers.updatedAt = deps.now()
      await deps.store.saveAnswers(answers)
      await patchEntry(entry.id, {
        status: 'done',
        count: entry.questions.length,
        max: answers.result.max,
        answered: completedCount(entry.questions, answers),
        score: answers.result.total,
        grounded: entry.meta.grounded,
      })
      state.view = 'result'
    } finally {
      state.submitting = false
    }
  }

  async function setMemoryWant(on: boolean): Promise<void> {
    const entry = state.current
    if (!entry || state.view !== 'result' || entry.answers.finalizedAt > 0 || !docExists(entry.meta.docId)) return
    entry.answers.memory.want = Boolean(on)
    entry.answers.memory.skipped = on ? '' : 'unchecked'
    cancelAnswerTimer()
    await saveAnswers()
  }

  async function finalize(): Promise<void> {
    const entry = state.current
    if (!entry) return
    if (!finalizeRecord(entry.meta, entry.answers)) return
    cancelAnswerTimer()
    await saveAnswers()
    await patchEntry(entry.id, {})
  }

  async function leave(): Promise<void> {
    stopClock()
    cancelAnswerTimer()
    if (state.current && state.view === 'taking') saveAnswers()
    if (state.view === 'result') await finalize()
    await deps.store.flush()
  }

  async function again(): Promise<void> {
    const entry = state.current
    const meta = entry?.meta
    await finalize()
    if (meta) {
      state.setup.docId = meta.docId
      state.setup.requirement = meta.requirement
      state.setup.template = meta.template === 'custom' ? 'auto' : meta.template
    }
    state.current = null
    state.view = 'setup'
  }

  async function remove(id: string): Promise<void> {
    if (state.generation.examId === id && state.generation.running) await stop()
    await finalizeIfCurrent(id)
    await deps.store.evict(id)
    state.list = state.list.filter(entry => entry.id !== id)
    if (state.current?.id === id) {
      state.current = null
      state.view = 'setup'
    }
  }

  async function finalizeIfCurrent(id: string): Promise<void> {
    if (state.current?.id === id && state.view === 'result') await finalize()
  }

  async function flush(): Promise<void> {
    if (answerTimer !== null) {
      cancelAnswerTimer()
      await saveAnswers()
    }
    await deps.store.flush()
  }

  function freeze(): void {
    cancelAnswerTimer()
    generationController?.abort()
    deps.store.freeze()
  }

  function unfreeze(): void {
    deps.store.unfreeze()
  }

  // ---------------------------------------------------------------- 出题

  async function start(): Promise<void> {
    if (state.generation.running || startBlocker.value) return
    const doc = selectedDoc.value
    const resolvedValue = resolved.value
    if (!doc || !resolvedValue) return
    state.generation.running = true
    state.generation.stopping = false
    state.generation.stopped = false
    state.generation.error = ''
    state.generation.failedBatches = []
    state.generation.onlyBatch = -1
    state.generation.degradeOffer = null
    state.generation.phase = 'plan'
    state.generation.done = 0
    state.generation.note = ''
    state.view = 'generating'

    const examId = deps.uuid()
    state.generation.examId = examId
    await deps.store.evictForRoom(examId, '')
    const meta = newMeta(examId, doc, resolvedValue.preset.name)
    await deps.store.saveMeta(meta)
    await deps.store.saveEntry(entryOf(meta, { count: 0, max: 0, answered: 0 }, 'draft'))
    state.current = {
      id: examId, meta, questions: [], answers: { ...blankAnswers(), examId }, readOnly: false, newer: false, banner: '',
    }
    await deps.store.mutateIndex(index => ({ ...index, activeId: examId }))
    await trackGeneration(examId)
  }

  /** 把一次出题挂到当前任务上：stop() / remove() 要等它真正收尾再动存储。 */
  function trackGeneration(examId: string): Promise<void> {
    const task = runGeneration(examId).catch(() => {})
    generationTask = task
    void task.finally(() => { if (generationTask === task) generationTask = null })
    return task
  }

  function newMeta(examId: string, doc: ExamDocument, presetName: string): ExamMeta {
    const resolvedValue = resolved.value
    return {
      version: 1,
      id: examId,
      docId: doc.id,
      docTitle: doc.title,
      docKind: doc.kind,
      pages: Math.max(1, doc.pageCount || 1),
      createdAt: deps.now(),
      updatedAt: deps.now(),
      requirement: state.setup.requirement,
      subject: 'mixed',
      subjectReason: '',
      template: 'A',
      templateSource: 'auto',
      mix: { ...TEMPLATES.A.mix },
      topics: [],
      topicNote: '',
      planNote: '',
      slots: [],
      batches: [0, 1, 2, 3].map(index => ({ index, status: 'pending', attempts: 0, error: '', finishedAt: 0 })),
      grounded: true,
      degradedReason: '',
      model: {
        presetId: resolvedValue?.preset.id || '',
        presetName,
        provider: resolvedValue?.provider || '',
        model: resolvedValue?.model || '',
        effort: resolvedValue?.effort || '',
      },
      generation: { startedAt: deps.now(), finishedAt: 0, calls: 0, input: 0, output: 0, estimated: false },
    }
  }

  async function runGeneration(examId: string): Promise<void> {
    const epoch = ++generationEpoch
    const token = ++generationToken
    const controller = new AbortController()
    generationController = controller
    const meta = state.current?.id === examId ? state.current.meta : await deps.store.loadMeta(examId)
    if (!meta || meta === 'newer' || state.current?.id !== examId) {
      state.generation.running = false
      return
    }
    const doc = docState.list.find(item => item.id === meta.docId) || {
      id: meta.docId, title: meta.docTitle, kind: meta.docKind, pageCount: meta.pages, sourceMissing: false,
    }
    state.generation.running = true
    deps.setBusy(true)
    state.generation.error = ''
    // 出题期间的「本卷题」跟随 generation 自己，不跟随 state.current：
    // 用户可以在出题中打开另一套试卷，写入仍要落在正在生成的那一套上（第 8.7 节）。
    if (state.current?.id === examId) {
      generating = { id: examId, meta, questions: state.current.questions }
    } else {
      const loaded = await deps.store.loadExam(examId)
      generating = { id: examId, meta, questions: loaded.questions }
    }
    let source: { context: unknown; close(): Promise<void> | void } | null = null
    try {
      if (meta.grounded) {
        try {
          source = await deps.openSource({ id: doc.id, title: doc.title, kind: doc.kind }, controller.signal)
        } catch (error) {
          if (controller.signal.aborted) return
          state.generation.degradeOffer = { reason: openFailureText(error, doc.title) }
          state.generation.running = false
          return
        }
      }

      const memory = await deps.memory({ id: doc.id, title: doc.title }).catch(() => '')

      if (!meta.topics.length) {
        state.generation.phase = 'plan'
        state.generation.note = ''
        const outcome = await deps.plan({
          doc: { id: doc.id, title: doc.title, kind: doc.kind },
          source, requirement: meta.requirement, connection: connectionOf(), memory,
          limits: null, grounded: meta.grounded, degradedReason: meta.degradedReason,
        }, controller.signal, generationHooks())
        if (token !== generationToken) return
        if (!outcome.ok) {
          const mapped: Record<string, string> = { timeout: 'plan-timeout', empty: 'no-topics', output: 'output' }
          if (outcome.code !== 'aborted') state.generation.error = friendlyExamError(mapped[outcome.code] || outcome.code, { message: outcome.error })
          state.generation.running = false
          return
        }
        applyPlan(meta, outcome)
        await deps.store.saveMeta(meta)
        await patchEntry(examId, {
          count: 0, max: 0, status: 'draft', template: meta.template, grounded: meta.grounded,
        })
      }

      const slots = meta.slots
      const only = state.generation.onlyBatch
      const batchOrder = generationToken === token
        ? [0, 1, 2, 3].filter(index => (only < 0 || index === only)
            && (meta.batches[index].status === 'pending' || meta.batches[index].status === 'failed' || meta.batches[index].status === 'stopped'))
        : []
      for (const batchIndex of batchOrder) {
        if (controller.signal.aborted) break
        const questions = generating?.questions || []
        let previousErrors: string[] = []
        let succeeded = false
        for (let attempt = 1; attempt <= EXAM_LIMITS.attempts; attempt++) {
          if (controller.signal.aborted) break
          state.generation.phase = 'batch'
          state.generation.batch = batchIndex
          state.generation.attempt = attempt
          meta.batches[batchIndex] = { ...meta.batches[batchIndex], status: 'running', attempts: attempt }
          await deps.store.saveMeta(meta)
          const outcome = await runBatch(meta, doc, source, batchIndex, attempt as 1 | 2, previousErrors, controller.signal, token, memory)
          if (!outcome) return
          // 停止出题之后迟到的结果不落库（第 8.7 节）。
          if (controller.signal.aborted) break
          if (outcome.ok) {
            const saved = await persistBatch(meta, outcome.questions)
            if (!saved) return
            succeeded = true
            break
          }
          if (outcome.aborted) break
          previousErrors = outcome.errors
          state.generation.note = previousErrors[0] || ''
        }
        if (controller.signal.aborted) {
          meta.batches[batchIndex] = { ...meta.batches[batchIndex], status: 'stopped' }
          break
        }
        if (!succeeded) {
          meta.batches[batchIndex] = {
            ...meta.batches[batchIndex], status: 'failed', finishedAt: deps.now(),
            error: (previousErrors[0] || '生成失败').slice(0, 120),
          }
          state.generation.failedBatches = [...new Set([...state.generation.failedBatches, batchIndex])]
        }
        await deps.store.saveMeta(meta)
        state.generation.done = generating?.questions.length || 0
      }

      state.generation.phase = 'idle'
      state.generation.stopped = controller.signal.aborted
      if (!controller.signal.aborted) {
        const settled = meta.batches.every(batch => batch.status === 'ok' || batch.status === 'failed')
        const count = generating?.questions.length || 0
        if (settled && count > 0) {
          await patchEntry(examId, { status: 'taking', count, max: count * EXAM_LIMITS.points, answered: 0 })
          // 用户可能已经切到别的试卷/别的整页：只在本页正是这一套时才切换视图。
          if (state.current?.id === examId && state.generation.examId === examId) {
            state.view = 'taking'
            state.current.answers.startedAt ||= deps.now()
            syncClock()
          }
          deps.notify(`《${meta.docTitle}》的模拟测试已出好，共 ${count} 题。`)
        } else if (!count) {
          state.generation.error = state.generation.error || friendlyExamError('all-failed', { message: meta.batches.map(batch => batch.error).filter(Boolean)[0] || '没有生成任何题目' })
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        state.generation.error = friendlyExamError('model', { message: error instanceof Error ? error.message : String(error) })
      }
    } finally {
      try { await source?.close() } catch { /* 关会话失败不影响结果 */ }
      deps.setBusy(false)
      if (token === generationToken) {
        state.generation.running = false
        state.generation.stopping = false
      }
      if (state.generation.examId === examId && state.view === 'generating' && state.generation.error) state.view = 'generating'
      await deps.store.saveMeta(meta).catch(() => {})
      state.list = (await deps.store.loadIndex()).index.list
      if (generating?.id === examId) generating = null
      state.generation.onlyBatch = -1
    }
  }

  function openFailureText(error: unknown, title: string): string {
    const name = error instanceof Error ? error.name : ''
    const text = error instanceof Error ? error.message : String(error ?? '')
    if (name === 'PasswordException' || /PasswordException/i.test(text)) {
      return `《${title}》已加密：请先在阅读器里打开并输入密码（本次运行内有效），再回来出题。`
    }
    if (/TEMP_MISSING|No such file|Errno 2|找不到|文件不存在|源文件缺失/i.test(text)) {
      return `《${title}》的原文件找不到或已被修改：请先在文档库里重新定位。`
    }
    return `没能读取《${title}》的原文。`
  }

  function applyPlan(meta: ExamMeta, outcome: Extract<PlanOutcome, { ok: true }>): void {
    const plan: PlanData = outcome.plan
    const resolvedMix = resolveMix(state.setup.template, { subject: plan.subject, mix: plan.mix })
    const built = buildSlots(resolvedMix.mix, plan.topics.map(topic => topic.name))
    meta.subject = plan.subject
    meta.subjectReason = plan.reason
    meta.topics = plan.topics
    meta.mix = resolvedMix.mix
    meta.template = resolvedMix.template
    meta.templateSource = resolvedMix.templateSource
    meta.slots = built.slots
    meta.topicNote = built.topicNote
    meta.planNote = plan.note
    meta.pages = Math.max(1, outcome.pages || meta.pages)
    meta.updatedAt = deps.now()
    state.generation.total = built.slots.length
    state.generation.evidence = outcome.evidenceCount
  }

  async function runBatch(
    meta: ExamMeta,
    doc: { id: string; title: string; kind: ExamDocument['kind'] },
    source: { context: unknown } | null,
    batchIndex: number,
    attempt: 1 | 2,
    retryErrors: string[],
    signal: AbortSignal,
    token: number,
    memory: string,
  ): Promise<BatchOutcome | null> {
    const questions = generating?.questions || []
    const slots = meta.slots.filter(slot => slot.batch === batchIndex)
    const present = questions.map(question => question.slot)
    const numbers = displayNumbers(meta.slots, present)
    const cap = topicCap(meta.topics.length)
    const previous = questions.slice(0, 15).map(question => question.stem.slice(0, 40))
    const counts = primaryCountsOf(questions)
    const fingerprints = questions.map(question => fingerprintOf(question.stem))
    const limited = withTimeout(signal, EXAM_LIMITS.batchTimeoutMs)
    try {
      const outcome = await deps.batch({
        examId: meta.id,
        doc: { id: doc.id, title: doc.title, kind: doc.kind },
        source,
        anchorPage: anchorFor(meta, slots),
        meta,
        batch: batchIndex,
        slots,
        displayNo: numbers,
        previous,
        saturated: meta.topics.map(topic => topic.name).filter(name => (counts[name] || 0) >= cap),
        primaryCounts: counts,
        fingerprints,
        attempt,
        retryErrors,
        connection: connectionOf(),
        memory,
        limits: null,
      }, limited.signal, generationHooks())
      if (token !== generationToken) return null
      state.generation.done = state.current?.questions.length || 0
      return outcome
    } finally {
      limited.done()
    }
  }

  function anchorFor(meta: ExamMeta, slots: ExamSlot[]): number {
    const first = slots[0]
    const topic = meta.topics.find(item => item.name === first?.topic)
    const page = topic?.pages?.[0]
    if (page) return page
    if (meta.docKind === 'markdown') return 1
    return 1
  }

  function withTimeout(signal: AbortSignal, ms: number): { signal: AbortSignal; done(): void } {
    const controller = new AbortController()
    const relay = () => controller.abort(signal.reason)
    if (signal.aborted) controller.abort(signal.reason)
    else signal.addEventListener('abort', relay, { once: true })
    const timer = deps.setTimer(() => controller.abort(new Error('timeout')), ms)
    return {
      signal: controller.signal,
      done() {
        deps.clearTimer(timer)
        signal.removeEventListener('abort', relay)
      },
    }
  }

  async function persistBatch(meta: ExamMeta, questions: ExamQuestion[]): Promise<boolean> {
    const batchIndex = questions[0]?.batch ?? 0
    const owner = generating && generating.id === meta.id ? generating : null
    try {
      for (const question of questions) await deps.store.saveQuestion(question)
      const merged = owner
        ? [...owner.questions, ...questions].sort((a, b) => a.slot - b.slot)
        : questions
      if (owner) owner.questions = merged
      if (state.current?.id === meta.id) state.current.questions = merged
      meta.batches[batchIndex] = { ...meta.batches[batchIndex], status: 'ok', finishedAt: deps.now(), error: '' }
      meta.updatedAt = deps.now()
      await deps.store.saveMeta(meta)
      await patchEntry(meta.id, { count: merged.length, max: merged.length * EXAM_LIMITS.points })
      state.generation.done = merged.length
      return true
    } catch (error) {
      meta.batches[batchIndex] = { ...meta.batches[batchIndex], status: 'failed', error: '保存失败' }
      deps.reportFailure(`exam:${meta.id}:batch`, '模拟测试', error, () => persistBatch(meta, questions).then(() => undefined))
      return false
    }
  }

  async function stop(): Promise<void> {
    if (!state.generation.running) return
    state.generation.stopping = true
    generationController?.abort()
    await generationTask
    await deps.store.flush()
  }

  async function acceptDegrade(): Promise<void> {
    const offer = state.generation.degradeOffer
    const meta = state.current?.meta
    if (!offer || !meta) return
    state.generation.degradeOffer = null
    meta.grounded = false
    meta.degradedReason = offer.reason.slice(0, 120)
    await deps.store.saveMeta(meta)
    state.generation.running = false
    state.generation.onlyBatch = -1
    await trackGeneration(meta.id)
  }

  async function rejectDegrade(): Promise<void> {
    const meta = state.current?.meta
    state.generation.degradeOffer = null
    state.generation.running = false
    if (meta) {
      await deps.store.evict(meta.id)
      state.list = state.list.filter(entry => entry.id !== meta.id)
    }
    state.current = null
    state.view = 'setup'
  }

  async function continueGeneration(id: string): Promise<void> {
    if (state.generation.running) return
    await open(id)
    const entry = state.current
    if (!entry || entry.answers.submittedAt) return
    state.view = 'generating'
    state.generation.onlyBatch = -1
    await trackGeneration(id)
  }

  async function retryBatch(id: string, batchIndex: number): Promise<void> {
    if (state.generation.running) return
    await open(id)
    const entry = state.current
    if (!entry) return
    const batch = entry.meta.batches[batchIndex]
    if (!batch) return
    entry.meta.batches[batchIndex] = { ...batch, status: 'pending', error: '', attempts: 0 }
    await deps.store.saveMeta(entry.meta)
    state.view = 'generating'
    state.generation.onlyBatch = batchIndex
    await trackGeneration(id)
  }

  async function switchTemplate(id: string, template: 'A' | 'B' | 'C'): Promise<void> {
    if (state.generation.running) return
    await open(id)
    const entry = state.current
    if (!entry || entry.answers.submittedAt) return
    for (const question of entry.questions) await deps.store.deleteQuestion(id, question.slot)
    entry.questions = []
    entry.answers = { ...blankAnswers(), examId: id }
    await deps.store.saveAnswers(entry.answers)
    const mix = resolveMix(template, { subject: entry.meta.subject, mix: null })
    const built = buildSlots(mix.mix, entry.meta.topics.map(topic => topic.name))
    entry.meta.mix = mix.mix
    entry.meta.template = mix.template
    entry.meta.templateSource = mix.templateSource
    entry.meta.slots = built.slots
    entry.meta.topicNote = built.topicNote
    entry.meta.batches = [0, 1, 2, 3].map(index => ({ index, status: 'pending', attempts: 0, error: '', finishedAt: 0 }))
    await deps.store.saveMeta(entry.meta)
    await patchEntry(id, { count: 0, max: 0, status: 'draft', template: entry.meta.template })
    state.view = 'generating'
    state.generation.onlyBatch = -1
    await trackGeneration(id)
  }

  async function acceptPartial(): Promise<void> {
    const entry = state.current
    if (!entry || state.generation.running || !entry.questions.length) return
    await patchEntry(entry.id, { status: 'taking', count: entry.questions.length, max: entry.questions.length * EXAM_LIMITS.points })
    entry.answers.startedAt ||= deps.now()
    state.view = 'taking'
    syncClock()
  }

  return {
    state, view, current, list, resolved, selectedDoc, startBlocker, preview, displayNo, live, completed,
    maxScore, pending, docMissing, recent,
    init, setDocuments, selectDocument, setRequirement, setTemplate, setChoice, refreshSettings, setVisible,
    open, choose, reveal, selfScore, submit, setMemoryWant, finalize, again, remove, leave, flush, freeze, unfreeze,
    start, stop, acceptDegrade, rejectDegrade, continueGeneration, retryBatch, switchTemplate, acceptPartial,
    finalizeRecord, buildEvent,
  }
}

export type ExamApi = ReturnType<typeof createExamState>
