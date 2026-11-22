/** 模拟测试的默认装配：把状态机接到 sdk 存储、模型调用、记忆与保存失败提示上。 */

import { loadAiSettings } from '../ai/settings.mjs'
import { getModel } from '../ai/providers.mjs'
import { library } from '../sdk'
import { emitLearningEvent } from '../memory/events.ts'
import { clearSaveFailure, reportSaveFailure } from '../ui/save-errors.ts'
import { joinStorageGate } from '../shared/storage-gate.ts'
import { setExamBusy } from './activity.ts'
import { createExamState } from './state.ts'
import { createExamStore } from './storage.ts'
import { examClient } from './client.ts'

import { createNotifyRelay } from './notify.ts'

const relay = createNotifyRelay()

/**
 * 页面挂载时把 App 的 notify 接进来（出完后提示、分数等由状态机发出）；卸载时传 null 断开，
 * 断开期间的提示留到下次挂载补发（见 notify.ts）。
 */
export function setExamNotify(handler: ((text: string) => void) | null): void {
  relay.set(handler)
}

const store = createExamStore(  {
    getSetting: key => library.getSetting(key),
    setSetting: (key, value) => library.setSetting(key, value),
    deleteSetting: key => library.deleteSetting(key),
  },
  { reportFailure: reportSaveFailure },
)

/** 出题预算要知道模型认不认图；与阅读助手用同一个判断（未登记能力的模型按支持处理）。 */
function withVision<T extends { connection: { provider: string; model: string; vision: boolean } }>(input: T): T {
  const known = getModel(input.connection.provider, input.connection.model)
  return { ...input, connection: { ...input.connection, vision: known?.vision !== false } }
}

export const exam = createExamState({
  store,
  plan: async (input, signal, hooks) => (await import('../ai/exam.ts')).runPlanCall(withVision(input), signal, hooks),
  batch: async (input, signal, hooks) => (await import('../ai/exam.ts')).runBatchCall(withVision(input), signal, hooks),
  openSource: async (doc, signal) =>
    (await import('../document/ai-context.mjs')).openAiContext(
      { id: doc.id, kind: doc.kind, title: doc.title, passwordId: doc.id },
      { page: 1 },
      signal,
    ),
  // P2 会补记忆注入的用途枚举；这里先按同一条管道接上（'exam' 在 P2-01 加进 MemoryPurpose）。
  memory: async doc => (await import('../ai/memory-context.ts')).memoryInjection(doc, 'exam' as never),
  emit: event => emitLearningEvent(event),
  exportMarkdown: (markdown, title) => examClient.exportMarkdown(markdown, title),
  settings: () => loadAiSettings(),
  choiceStorage: typeof localStorage === 'undefined' ? null : localStorage,
  notify: text => relay.notify(text),
  reportFailure: reportSaveFailure,
  clearFailure: clearSaveFailure,
  setBusy: setExamBusy,
  now: () => Date.now(),
  uuid: () => crypto.randomUUID(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
})

joinStorageGate({
  flush: () => exam.flush(),
  freeze: () => exam.freeze(),
  unfreeze: () => exam.unfreeze(),
})
