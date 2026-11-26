/**
 * 试卷结果页「导出并加入文档库」的装配层：导出会新建一条文档库记录，所以和「加入文档」共用同一道
 * 学习模式门禁。这里不 import sdk（原生命令由默认装配注入），Node 单测可以直接用假 client。
 */
import { admitImport, finishImportAdmission } from '../library/importer.ts'
import { emitLearningEvent, type LearningEvent } from '../memory/events.ts'
import type { ExportOutcome } from './types.ts'

export type LibraryExportDeps = {
  /** 本机 exam_export：弹「另存为」、写文件并入库，一次完成。 */
  exportMarkdown: (markdown: string, title: string) => Promise<ExportOutcome>
  /** 默认发到学习事件总线；测试可注入。 */
  emit?: (event: LearningEvent) => void
  now?: () => number
  uuid?: () => string
}

/**
 * 学习模式开启且没填完时直接返回 { cancelled: true }：不发原生命令、不写文件、不入库、不发记忆事件，
 * 已有的 finally 会收起 exporting。放行时先捕获答案快照，导出成功才用新文档 id 发一条 onboarding 事件，
 * 并只消费一次原快照（异步期间用户若改了草稿，finishImportAdmission 会跳过）。
 */
export function createLibraryExport(deps: LibraryExportDeps) {
  const emit = deps.emit ?? emitLearningEvent
  const now = deps.now ?? (() => Date.now())
  const uuid = deps.uuid ?? (() => crypto.randomUUID())
  return async function exportWithLearning(markdown: string, title: string): Promise<ExportOutcome> {
    const gate = admitImport('exam-export')
    if (!gate.ok) return { cancelled: true }
    const outcome = await deps.exportMarkdown(markdown, title)
    if (outcome.cancelled) return outcome
    if (gate.answers) {
      emit({
        type: 'onboarding', docId: outcome.document.id, title: outcome.name || title,
        answers: gate.answers, importId: uuid(), at: now(),
      })
    }
    finishImportAdmission(gate, 1)
    return outcome
  }
}
