/**
 * 记忆数据的读写：每个键一条串行链、可冻结。存储通过参数注入，本文件不导入 sdk。
 * store 只管「把一个值可靠地写到一个键」；防抖、脏标记、索引顺序由 engine 负责。
 */
import { LIMITS, MEMORY_KEYS, docMemoryKey, type DocumentMemory, type GlobalMemory, type MemoryIndex, type MemorySettings } from './types.ts'
import {
  emptyGlobalMemory, normalizeDocumentMemory, normalizeGlobalMemory, normalizeMemoryIndex,
  normalizeMemorySettings, parseJsonSafe, utf8Bytes,
} from './normalize.ts'

export type MemoryStorage = {
  getSetting(key: string): Promise<string | null>
  setSetting(key: string, value: string): Promise<void>
  deleteSetting(key: string): Promise<void>
}

export type MemoryStore = {
  loadSettings(): Promise<MemorySettings>
  saveSettings(value: MemorySettings): Promise<void>
  /** 索引不存在 → 空索引；存在但损坏 → null（调用方据此重建）。 */
  loadIndex(): Promise<MemoryIndex | null>
  saveIndex(value: MemoryIndex): Promise<void>
  /** 不存在或损坏 → null；newer 表示是更新版本写的，不能读也不能覆盖。 */
  loadDoc(docId: string): Promise<{ memory: DocumentMemory | null; newer: boolean }>
  saveDoc(memory: DocumentMemory): Promise<void>
  deleteDoc(docId: string): Promise<void>
  loadGlobal(): Promise<GlobalMemory>
  saveGlobal(memory: GlobalMemory): Promise<void>
  deleteGlobal(): Promise<void>
  flush(): Promise<void>
  freeze(): void
  unfreeze(): void
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const emptyIndex = (): MemoryIndex => ({
  version: 1, updatedAt: 0, docs: [], globalStale: false, docUpdatesSinceGlobal: 0, lastRun: null,
})
const WRITE_LIMIT_MESSAGE = '学习记忆超过本机保存上限，请清理证据或待总结记录后重试。'

export function createMemoryStore(storage: MemoryStorage): MemoryStore {
  const chains = new Map<string, Promise<void>>()
  let frozen = false
  /** 同一个键的写入按调用顺序执行；前一次失败不阻塞后一次；冻结后执行到的一律跳过。 */
  function enqueue(key: string, task: () => Promise<void>): Promise<void> {
    const previous = chains.get(key) || Promise.resolve()
    const next = previous.catch(() => {}).then(async () => {
      if (frozen) return
      await task()
    })
    chains.set(key, next)
    void next.finally(() => { if (chains.get(key) === next) chains.delete(key) }).catch(() => {})
    return next
  }
  function write(key: string, value: unknown, maxBytes: number): Promise<void> {
    const text = JSON.stringify(value)
    if (utf8Bytes(text) > Math.min(maxBytes, LIMITS.settingBytes)) return Promise.reject(new Error(WRITE_LIMIT_MESSAGE))
    return enqueue(key, () => storage.setSetting(key, text))
  }
  return {
    async loadSettings() {
      const raw = await storage.getSetting(MEMORY_KEYS.settings)
      if (!raw) return normalizeMemorySettings({})
      return normalizeMemorySettings(parseJsonSafe(raw))
    },
    saveSettings(value) { return write(MEMORY_KEYS.settings, value, LIMITS.settingBytes) },
    async loadIndex() {
      const raw = await storage.getSetting(MEMORY_KEYS.index)
      if (!raw) return emptyIndex()
      return normalizeMemoryIndex(parseJsonSafe(raw))
    },
    saveIndex(value) { return write(MEMORY_KEYS.index, value, LIMITS.indexBytes) },
    async loadDoc(docId) {
      const raw = await storage.getSetting(docMemoryKey(docId))
      if (!raw) return { memory: null, newer: false }
      const parsed = parseJsonSafe(raw)
      if (isRecord(parsed) && typeof parsed.version === 'number' && parsed.version > 1) return { memory: null, newer: true }
      return { memory: normalizeDocumentMemory(parsed, docId), newer: false }
    },
    saveDoc(memory) { return write(docMemoryKey(memory.docId), memory, LIMITS.docBytes) },
    deleteDoc(docId) {
      const key = docMemoryKey(docId)
      return enqueue(key, () => storage.deleteSetting(key))
    },
    async loadGlobal() {
      const raw = await storage.getSetting(MEMORY_KEYS.global)
      if (!raw) return emptyGlobalMemory(Date.now())
      return normalizeGlobalMemory(parseJsonSafe(raw))
    },
    saveGlobal(memory) { return write(MEMORY_KEYS.global, memory, LIMITS.globalBytes) },
    deleteGlobal() { return enqueue(MEMORY_KEYS.global, () => storage.deleteSetting(MEMORY_KEYS.global)) },
    async flush() {
      await Promise.allSettled([...chains.values()])
    },
    freeze() { frozen = true },
    unfreeze() { frozen = false },
  }
}
