/**
 * 学习记忆的读取入口（阅读助手 / 翻译 / 快速解释 / 问题预判共用）。
 *
 * 规则：
 * - 有当前文档：先取这本书的记忆；这本书还没有可注入内容时退回全局记忆。
 * - 没有当前文档（或没有指定）：直接取全局记忆。
 * - 记忆模块尚未加载、存储异常、引擎未就绪时静默返回空串：记忆是旁路，不能让翻译/解释/预判失败。
 * - 不同入口只换注入正文最后的「使用要求」，见 memory/prompts.ts 的 MemoryPurpose。
 */
import type { MemoryPurpose } from '../memory/types.ts'

let activeDocument: { id: string; title: string } | null = null

/** 由 App 在切换当前阅读文档时调用；翻译/快速解释/猜你想问按它取记忆。 */
export function setActiveMemoryDocument(doc: { id: string; title: string } | null): void {
  if (!doc) { activeDocument = null; return }
  if (activeDocument && activeDocument.id === doc.id && activeDocument.title === doc.title) return
  activeDocument = { id: doc.id, title: doc.title }
}

export function activeMemoryDocument(): { id: string; title: string } | null {
  return activeDocument
}

let memoryModule: Promise<typeof import('../memory')> | null = null
function loadMemory(): Promise<typeof import('../memory')> {
  memoryModule ??= import('../memory')
  return memoryModule
}

/**
 * @param doc 显式指定文档（阅读助手/问题预判用）；省略时用 App 登记的当前文档。
 * @param purpose 注入用途，只影响最后一句使用要求。
 */
export async function memoryInjection(doc?: { id: string; title: string } | null, purpose: MemoryPurpose = 'assistant'): Promise<string> {
  const target = doc ?? activeDocument
  try {
    const api = await loadMemory()
    if (target) {
      const memory = await api.injectionFor({ kind: 'doc', docId: target.id, title: target.title }, purpose)
      if (memory.text) return memory.text
    }
    const global = await api.injectionFor({ kind: 'global' }, purpose)
    return global.text
  } catch {
    return ''
  }
}
