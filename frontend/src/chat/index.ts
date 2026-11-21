/** 对话模式模块的对外入口：接上真实的本机存储、Harness 调用、用量账本与保存失败提示。 */
import { library, tempDocs } from '../sdk'
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
  // 带附件回合走 chat/compare.ts；文档管道（pdf.js）只在实际打开文档时才加载。
  runAttachmentTurn: async (input: any) => {
    const [{ runAttachmentTurn }, { streamChat }] = await Promise.all([import('./compare.ts'), import('../ai/providers.mjs')])
    return runAttachmentTurn(input, {
      streamChat,
      streamDocumentChat: async (options: any, document: any, seed: any) =>
        (await import('../ai/document-chat.mjs')).streamDocumentChat(options, document, seed),
      openSource: async (descriptor: any, snapshot: any, signal: AbortSignal) =>
        (await import('../document/ai-context.mjs')).openAiContext(descriptor, snapshot, signal),
      createSession: async (context: any, descriptor: any, limits: any, vision: boolean, onEvidence: any, signal: AbortSignal) =>
        (await import('../document/session.mjs')).createDocumentSession(context, descriptor, limits, vision, onEvidence, signal),
      readTemp: (handle: string) => tempDocs.read(handle),
      recordUsage,
      estimateTokens,
      now: () => Date.now(),
    })
  },
  releaseTemp: handles => tempDocs.release(handles),
  now: () => Date.now(),
  uuid: () => crypto.randomUUID(),
})
joinStorageGate({ flush: () => chat.flush(), freeze: () => store.freeze(), unfreeze: () => store.unfreeze() })
export const chatBusy = () => chat.busy()
