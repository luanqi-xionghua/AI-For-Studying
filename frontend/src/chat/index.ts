/** 对话模式模块的对外入口：接上真实的本机存储、Harness 调用、用量账本与保存失败提示。 */
import { library } from '../sdk'
import { recordUsage } from '../ai/usage'
import { estimateTokens } from '../ai/workspace'
import { reportSaveFailure } from '../ui/save-errors'
import { emitLearningEvent } from '../memory/events'
import { joinStorageGate } from '../shared/storage-gate'
import { createChatStore } from './storage'
import { createChatState } from './state'

const store = createChatStore({
  getSetting: key => library.getSetting(key),
  setSetting: (key, value) => library.setSetting(key, value),
  deleteSetting: key => library.deleteSetting(key),
})
export const chat = createChatState({
  store,
  recordUsage,
  estimateTokens,
  emit: emitLearningEvent,
  reportFailure: reportSaveFailure,
  streamChat: async options => (await import('../ai/providers.mjs')).streamChat(options),
  now: () => Date.now(),
  uuid: () => crypto.randomUUID(),
})
joinStorageGate({ flush: () => chat.flush(), freeze: () => store.freeze(), unfreeze: () => store.unfreeze() })
export const chatBusy = () => chat.busy()
