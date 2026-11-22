/**
 * 模拟测试的模型调用（P1 占位）。
 *
 * P2 会在这里实现：出卷规划（EXAM_SYSTEM + 规划 user 模板）、4 批出题、
 * 文档会话与证据索引、降级路径（streamChat）与超时/输出长度守卫。
 * 现在只返回失败，让页面能显示成品错误文案，而不是白屏。
 */

import type { BatchInput, BatchOutcome, CallHooks, PlanInput, PlanOutcome } from '../exam/types.ts'

export async function runPlanCall(_input: PlanInput, _signal: AbortSignal, _hooks: CallHooks): Promise<PlanOutcome> {
  return { ok: false, code: 'model', error: '出题功能尚未接入：P2 会接上模型调用。' }
}

export async function runBatchCall(_input: BatchInput, _signal: AbortSignal, _hooks: CallHooks): Promise<BatchOutcome> {
  return { ok: false, errors: ['出题功能尚未接入：P2 会接上模型调用。'], reason: '出题功能尚未接入' }
}
