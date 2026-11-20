/** 对话模式会话的持久化：清单 + 每段会话一个键；每个键一条串行链、可冻结。 */
import { cleanLine, cleanText, cleanTime, parseJsonSafe, utf8Bytes } from '../memory/normalize.ts'
import {
  CHAT_LIMITS, CHATMODE_KEYS, CHATMODE_VERSION, conversationKey,
  type ChatMemoryTag, type ChatModeConversation, type ChatModeIndex, type ChatModeIndexEntry,
  type ChatModeMessage, type ChatUsage,
} from './types.ts'
import type { MemoryScope } from '../memory/types.ts'

export type ChatStorage = {
  getSetting(key: string): Promise<string | null>
  setSetting(key: string, value: string): Promise<void>
  deleteSetting(key: string): Promise<void>
}

export type ChatStore = {
  loadIndex(): Promise<ChatModeIndex>
  loadConversation(id: string): Promise<ChatModeConversation | null>
  saveConversation(conversation: ChatModeConversation, activeId: string): Promise<void>
  deleteConversation(id: string, activeId: string): Promise<void>
  flush(): Promise<void>
  freeze(): void
  unfreeze(): void
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const emptyIndex = (): ChatModeIndex => ({ version: CHATMODE_VERSION, activeId: '', list: [] })
const text = (value: unknown, max: number) => cleanText(value, max)

export function normalizeScope(raw: unknown): MemoryScope {
  if (isRecord(raw) && raw.kind === 'doc') {
    const docId = cleanLine(raw.docId, 64)
    if (docId) return { kind: 'doc', docId, title: text(raw.title, 200) }
  }
  if (isRecord(raw) && raw.kind === 'none') return { kind: 'none' }
  return { kind: 'global' }
}

function normalizeUsage(raw: unknown): ChatUsage | undefined {
  if (!isRecord(raw)) return undefined
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
  return { input: number(raw.input), output: number(raw.output), reasoning: number(raw.reasoning), estimated: raw.estimated === true }
}

function normalizeMemoryTag(raw: unknown): ChatMemoryTag | undefined {
  if (!isRecord(raw)) return undefined
  const kind = raw.kind === 'doc' ? 'doc' : raw.kind === 'none' ? 'none' : raw.kind === 'global' ? 'global' : undefined
  if (!kind) return undefined
  const tag: ChatMemoryTag = { kind, injected: raw.injected === true, chars: typeof raw.chars === 'number' ? Math.max(0, Math.round(raw.chars)) : 0 }
  const docId = cleanLine(raw.docId, 64)
  if (docId) tag.docId = docId
  const title = text(raw.title, 60)
  if (title) tag.title = title
  return tag
}

function normalizeMessage(raw: unknown): ChatModeMessage | null {
  if (!isRecord(raw)) return null
  const role = raw.role === 'user' || raw.role === 'assistant' ? raw.role : undefined
  if (!role) return null
  const content = text(raw.content, CHAT_LIMITS.storedContent)
  if (!content) return null
  const message: ChatModeMessage = { id: cleanLine(raw.id, 64) || crypto.randomUUID(), role, content }
  const reasoning = text(raw.reasoning, CHAT_LIMITS.storedReasoning)
  if (reasoning) message.reasoning = reasoning
  for (const field of ['startedAt', 'firstTokenAt', 'finishedAt'] as const) {
    const value = cleanTime(raw[field])
    if (value) message[field] = value
  }
  const usage = normalizeUsage(raw.usage)
  if (usage) message.usage = usage
  if (raw.failed === true) message.failed = true
  if (raw.stopped === true) message.stopped = true
  const error = text(raw.error, 300)
  if (error) message.error = error
  const model = cleanLine(raw.model, 80)
  if (model) message.model = model
  const effort = cleanLine(raw.effort, 40)
  if (effort) message.effort = effort
  const memory = normalizeMemoryTag(raw.memory)
  if (memory) message.memory = memory
  return message
}

export function normalizeChatConversation(raw: unknown, id: string): ChatModeConversation | null {
  if (!isRecord(raw)) return null
  if (typeof raw.version === 'number' && raw.version > CHATMODE_VERSION) return null
  if (typeof raw.id === 'string' && raw.id && raw.id !== id) return null
  const messages = Array.isArray(raw.messages) ? raw.messages.map(normalizeMessage).filter((item): item is ChatModeMessage => Boolean(item)) : []
  return {
    version: CHATMODE_VERSION,
    id,
    title: text(raw.title, CHAT_LIMITS.title),
    createdAt: cleanTime(raw.createdAt),
    updatedAt: cleanTime(raw.updatedAt),
    scope: normalizeScope(raw.scope),
    messages,
    ...(raw.trimmed === true ? { trimmed: true } : {}),
  }
}

export function normalizeChatIndex(raw: unknown): ChatModeIndex {
  if (!isRecord(raw)) return emptyIndex()
  const list: ChatModeIndexEntry[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(raw.list) ? raw.list : []) {
    if (!isRecord(item)) continue
    const id = cleanLine(item.id, 64)
    if (!id || seen.has(id)) continue
    seen.add(id)
    list.push({
      id,
      title: text(item.title, CHAT_LIMITS.title),
      createdAt: cleanTime(item.createdAt),
      updatedAt: cleanTime(item.updatedAt),
      scope: normalizeScope(item.scope),
      count: typeof item.count === 'number' && Number.isFinite(item.count) ? Math.max(0, Math.round(item.count)) : 0,
    })
  }
  list.sort((a, b) => b.updatedAt - a.updatedAt)
  return { version: CHATMODE_VERSION, activeId: cleanLine(raw.activeId, 64), list: list.slice(0, CHAT_LIMITS.conversations) }
}

/** 落库前的截断：正文 60000、思考 4000、失败且无内容的回答不存、只留最后 60 条。 */
export function prepareConversation(conversation: ChatModeConversation): ChatModeConversation {
  const messages = conversation.messages
    .map(message => ({
      ...message,
      content: text(message.content, CHAT_LIMITS.storedContent),
      ...(message.reasoning ? { reasoning: text(message.reasoning, CHAT_LIMITS.storedReasoning) } : {}),
    }))
    .filter(message => !(message.role === 'assistant' && message.failed && !message.content))
    .slice(-CHAT_LIMITS.messages)
  return { ...conversation, title: text(conversation.title, CHAT_LIMITS.title), messages }
}

/** 按字节装进上限：先去掉全部思考过程；仍超则从最早的一问一答开始丢并置 trimmed。 */
export function fitConversation(conversation: ChatModeConversation, maxBytes: number = CHAT_LIMITS.conversationBytes): ChatModeConversation {
  const size = (value: ChatModeConversation) => utf8Bytes(JSON.stringify(value))
  if (size(conversation) <= maxBytes) return conversation
  let next: ChatModeConversation = { ...conversation, messages: conversation.messages.map(({ reasoning: _reasoning, ...rest }) => rest) }
  if (size(next) <= maxBytes) return next
  while (next.messages.length > 1 && size(next) > maxBytes) {
    const messages = next.messages.length > 2 ? next.messages.slice(2) : next.messages.slice(-1)
    next = { ...next, trimmed: true, messages }
  }
  return next
}

export function createChatStore(storage: ChatStorage): ChatStore {
  const chains = new Map<string, Promise<void>>()
  let frozen = false
  function enqueue(key: string, task: () => Promise<void>): Promise<void> {
    const previous = chains.get(key) || Promise.resolve()
    const next = previous.catch(() => {}).then(async () => { if (frozen) return; await task() })
    chains.set(key, next)
    void next.finally(() => { if (chains.get(key) === next) chains.delete(key) }).catch(() => {})
    return next
  }
  async function readIndex(): Promise<ChatModeIndex> {
    const raw = await storage.getSetting(CHATMODE_KEYS.index)
    if (!raw) return emptyIndex()
    return normalizeChatIndex(parseJsonSafe(raw))
  }
  async function writeIndex(index: ChatModeIndex): Promise<void> {
    const value = JSON.stringify(index)
    if (utf8Bytes(value) > CHAT_LIMITS.indexBytes) return
    await enqueue(CHATMODE_KEYS.index, () => storage.setSetting(CHATMODE_KEYS.index, value))
  }
  return {
    async loadIndex() { return readIndex() },
    async loadConversation(id) {
      const raw = await storage.getSetting(conversationKey(id))
      if (!raw) return null
      return normalizeChatConversation(parseJsonSafe(raw), id)
    },
    async saveConversation(conversation, activeId) {
      const prepared = fitConversation(prepareConversation(conversation))
      const key = conversationKey(prepared.id)
      await enqueue(key, () => storage.setSetting(key, JSON.stringify(prepared)))
      const index = await readIndex()
      const entry: ChatModeIndexEntry = {
        id: prepared.id, title: prepared.title, createdAt: prepared.createdAt, updatedAt: prepared.updatedAt,
        scope: prepared.scope, count: prepared.messages.length,
      }
      let list = index.list.filter(item => item.id !== prepared.id)
      if (entry.count > 0) list.unshift(entry)
      list.sort((a, b) => b.updatedAt - a.updatedAt)
      const dropped = list.slice(CHAT_LIMITS.conversations)
      list = list.slice(0, CHAT_LIMITS.conversations)
      for (const item of dropped) await enqueue(conversationKey(item.id), () => storage.deleteSetting(conversationKey(item.id)))
      const next: ChatModeIndex = { version: CHATMODE_VERSION, activeId, list }
      await writeIndex(next)
    },
    async deleteConversation(id, activeId) {
      await enqueue(conversationKey(id), () => storage.deleteSetting(conversationKey(id)))
      const index = await readIndex()
      const list = index.list.filter(item => item.id !== id)
      await writeIndex({ version: CHATMODE_VERSION, activeId: activeId === id ? (list[0]?.id || '') : activeId, list })
    },
    async flush() { await Promise.allSettled([...chains.values()]) },
    freeze() { frozen = true },
    unfreeze() { frozen = false },
  }
}
