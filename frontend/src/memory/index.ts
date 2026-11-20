/** 记忆引擎的默认实例：接上真实的存储、模型调用、用量账本与保存失败提示。 */
import { library } from '../sdk'
import type { Doc } from '../sdk/types'
import { reportSaveFailure, clearSaveFailure } from '../ui/save-errors'
import { joinStorageGate } from '../shared/storage-gate'
import { createMemoryStore } from './store'
import { createMemoryEngine } from './engine'
import { callMemoryModel, memoryConfigView } from './summarize'

const store = createMemoryStore({
  getSetting: key => library.getSetting(key),
  setSetting: (key, value) => library.setSetting(key, value),
  deleteSetting: key => library.deleteSetting(key),
})
let options: { notify: (text: string) => void; foregroundBusy: () => boolean } = { notify: () => {}, foregroundBusy: () => false }
const engine = createMemoryEngine({
  store,
  callModel: callMemoryModel,
  configView: memoryConfigView,
  notify: text => options.notify(text),
  foregroundBusy: () => options.foregroundBusy(),
  now: () => Date.now(),
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  reportFailure: reportSaveFailure,
  clearFailure: clearSaveFailure,
})
joinStorageGate({ flush: () => engine.flush(), freeze: () => engine.freeze(), unfreeze: () => engine.unfreeze() })
const onHide = () => { void engine.flush() }

export const memoryState = engine.state
export function startMemoryEngine(next: typeof options): Promise<void> {
  options = next
  window.addEventListener('pagehide', onHide)
  document.addEventListener('visibilitychange', onHide)
  return engine.start()
}
export function stopMemoryEngine(): Promise<void> {
  window.removeEventListener('pagehide', onHide)
  document.removeEventListener('visibilitychange', onHide)
  return engine.stop()
}
export const syncMemoryDocuments = (docs: Doc[]) => engine.syncDocuments(docs.map(doc => ({
  id: doc.id, name: doc.name, page: doc.page, pageCount: doc.pageCount, progress: doc.progress, lastOpenedAt: doc.lastOpenedAt,
})))
export const refreshMemoryConfig = () => engine.refreshConfig()
export const {
  loadDocument: loadDocumentMemory,
  loadGlobal: loadGlobalMemory,
  initDocument: initDocumentMemory,
  editDocument: editDocumentMemory,
  editGlobal: editGlobalMemory,
  removeItem: removeMemoryItem,
  removeEvidenceItem: removeMemoryEvidence,
  unlock: unlockMemoryField,
  clearDocument: clearDocumentMemory,
  clearGlobal: clearGlobalMemory,
  summarizeDocumentNow,
  summarizeGlobalNow,
  cancelRun: cancelMemoryRun,
  setAutoUpdate,
  resumeAutoUpdate,
  injectionFor,
} = engine
