/**
 * 出题进度区的纯函数：失败批次从 meta 恢复、阶段文案。
 * 不依赖 Vue 与运行时，单测直接在 Node 里跑。
 */

import type { ExamMeta } from './types.ts'

/** meta.batches 里 status 为 failed 的批次序号（升序）。刷新后单批重试按钮靠它恢复。 */
export function failedBatchesOf(meta: Pick<ExamMeta, 'batches'> | null | undefined): number[] {
  if (!meta || !Array.isArray(meta.batches)) return []
  return meta.batches
    .filter(batch => batch && batch.status === 'failed')
    .map(batch => batch.index)
    .filter(index => Number.isInteger(index) && index >= 0)
    .sort((a, b) => a - b)
}

export type PhaseInput = {
  phase: 'idle' | 'plan' | 'batch'
  running: boolean
  batch: number
  done: number
  total: number
  error: string
  stopped: boolean
  failedBatches: number[]
  degradeOffer: null | { reason: string }
}

/**
 * 出题区标题下那一行。只有真的在跑时才说「正在…」；
 * 失败、停止、等用户决定降级、刷新后的半成品都给各自的结论，不再残留「正在准备出题…」。
 */
export function generationPhaseText(generation: PhaseInput, batchNumbers: number[] = []): string {
  if (generation.running) {
    if (generation.phase === 'plan') return '正在规划试卷：读目录和前几页，判断学科类型与知识点…'
    if (generation.phase === 'batch') {
      const numbers = batchNumbers.filter(number => Number.isFinite(number) && number > 0)
      if (numbers.length) {
        return `正在出第 ${generation.batch + 1} 批（第 ${Math.min(...numbers)}–${Math.max(...numbers)} 题）… 已生成 ${generation.done}/${generation.total}`
      }
      return `正在出第 ${generation.batch + 1} 批…`
    }
    return '正在准备出题…'
  }
  if (generation.degradeOffer) return '已暂停：没能读取原文，等你决定是否继续。'
  if (generation.error) return '出题失败。'
  if (generation.failedBatches.length) {
    const list = generation.failedBatches.map(index => index + 1).join('、')
    return `出题未完成：第 ${list} 批生成失败，已生成 ${generation.done}/${generation.total}。`
  }
  if (generation.stopped) return '已停止出题。'
  return `出题未完成：已生成 ${generation.done}/${generation.total}，可以继续出题。`
}
