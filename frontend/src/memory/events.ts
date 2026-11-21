/** 学习事件总线：零运行时依赖（只有类型导入），谁都可以发，记忆引擎在就收。 */
import type { MemoryScope, OnboardingAnswers } from './types.ts'

export type LearningEvent =
  | { type: 'assistant-turn'; docId: string; title: string; conversationId: string; question: string; answer: string; at: number }
  | { type: 'chat-turn'; scope: MemoryScope; conversationId: string; question: string; answer: string; at: number; turnId?: string }
  | { type: 'opened'; docId: string; title: string; page: number; pageCount: number; progress: number; at: number }
  | { type: 'reading'; docId: string; title: string; page: number; pageCount: number; progress: number; at: number }
  | { type: 'onboarding'; docId: string; title: string; answers: OnboardingAnswers; importId: string; at: number }
  | { type: 'document-removed'; docId: string; title: string; at: number }

type Listener = (event: LearningEvent) => void
const listeners = new Set<Listener>()
const backlog: LearningEvent[] = []
const BACKLOG_MAX = 200

/** 同步分发；监听者抛出的异常被吞掉，不影响发事件的一方。 */
export function emitLearningEvent(event: LearningEvent): void {
  if (!listeners.size) {
    backlog.push(event)
    if (backlog.length > BACKLOG_MAX) backlog.shift()
    return
  }
  for (const listener of [...listeners]) {
    try { listener(event) } catch { /* 记忆是旁路功能，出错不能影响对话与阅读 */ }
  }
}

/** 注册监听者，返回取消函数。第一个监听者注册时，把暂存的事件按原顺序补发给它。 */
export function onLearningEvent(listener: Listener): () => void {
  listeners.add(listener)
  if (listeners.size === 1 && backlog.length) {
    const queued = backlog.splice(0)
    queueMicrotask(() => {
      for (const event of queued) {
        try { listener(event) } catch { /* 同上 */ }
      }
    })
  }
  return () => { listeners.delete(listener) }
}

/** 只给单测用：清空监听者与暂存。 */
export function resetLearningEvents(): void {
  listeners.clear()
  backlog.length = 0
}
