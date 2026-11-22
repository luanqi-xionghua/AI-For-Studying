/** 模拟测试的默认装配：把状态机接到 sdk 存储、模型调用、记忆与保存失败提示上。 */

import { loadAiSettings } from '../ai/settings.mjs'
import { library } from '../sdk'
import { emitLearningEvent } from '../memory/events.ts'
import { clearSaveFailure, reportSaveFailure } from '../ui/save-errors.ts'
import { joinStorageGate } from '../shared/storage-gate.ts'
import { setExamBusy } from './activity.ts'
import { createExamState } from './state.ts'
import { createExamStore } from './storage.ts'

let notifyHandler: (text: string) => void = () => {}

/** 页面挂载时把 App 的 notify 接进来（出完后提示、分数等由状态机发出）。 */
export function setExamNotify(handler: (text: string) => void): void {
  notifyHandler = handler
}

const store = createExamStore(
  {
    getSetting: key => library.getSetting(key),
    setSetting: (key, value) => library.setSetting(key, value),
    deleteSetting: key => library.deleteSetting(key),
  },
  { reportFailure: reportSaveFailure },
)

export const exam = createExamState({
  store,
  plan: async (input, signal, hooks) => (await import('../ai/exam.ts')).runPlanCall(input, signal, hooks),
  batch: async (input, signal, hooks) => (await import('../ai/exam.ts')).runBatchCall(input, signal, hooks),
  openSource: async (doc, signal) =>
    (await import('../document/ai-context.mjs')).openAiContext(
      { id: doc.id, kind: doc.kind, title: doc.title, passwordId: doc.id },
      { page: 1 },
      signal,
    ),
  // P2 会补记忆注入的用途枚举；这里先按同一条管道接上（'exam' 在 P2-01 加进 MemoryPurpose）。
  memory: async doc => (await import('../ai/memory-context.ts')).memoryInjection(doc, 'exam' as never),
  emit: event => emitLearningEvent(event as never),
  exportMarkdown: async () => ({ cancelled: true }),
  settings: () => loadAiSettings(),
  choiceStorage: typeof localStorage === 'undefined' ? null : localStorage,
  notify: text => notifyHandler(text),
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
