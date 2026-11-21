/** 对话模式会话的持久化：清单 + 每段会话一个键；每个键一条串行链、可冻结。 */
import { cleanLine, cleanText, cleanTime, parseJsonSafe, utf8Bytes } from '../memory/normalize.ts'
import {
  CHAT_ATTACH_LIMITS, CHAT_LIMITS, CHATMODE_KEYS, CHATMODE_VERSION, conversationKey,
  type ChatAttachmentMark, type ChatCitation, type ChatCitationDoc, type ChatDocAttachment, type ChatDocKind,
  type ChatDocMark, type ChatMessageRefs, type ChatMemoryTag, type ChatModeConversation, type ChatModeIndex,
  type ChatModeIndexEntry, type ChatModeMessage, type ChatUsage,
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
  const usage: ChatUsage = { input: number(raw.input), output: number(raw.output), reasoning: number(raw.reasoning), estimated: raw.estimated === true }
  const calls = number(raw.calls)
  if (calls) usage.calls = calls
  return usage
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
  if (raw.skipped === 'attachments') tag.skipped = 'attachments'
  return tag
}

const docKindOf = (value: unknown): ChatDocKind | undefined =>
  value === 'pdf' ? 'pdf' : value === 'markdown' ? 'markdown' : value === 'word' ? 'word' : undefined
const docSourceOf = (value: unknown): 'library' | 'temp' => value === 'temp' ? 'temp' : 'library'

/** 「临时文档 N」占位标题：真实文件名只在内存里，落库一律换成这个。 */
export const tempDocTitle = (index: number): string => `临时文档 ${index}`

function normalizeAttachment(raw: unknown): ChatDocAttachment | null {
  if (!isRecord(raw)) return null
  const id = cleanLine(raw.id, 64)
  const kind = docKindOf(raw.kind)
  if (!id || !kind) return null
  const source = docSourceOf(raw.source)
  const docId = cleanLine(raw.docId, 64)
  if (source === 'library' && !docId) return null
  return {
    id,
    source,
    ...(source === 'library' ? { docId } : {}),
    title: text(raw.title, CHAT_ATTACH_LIMITS.attachTitle),
    kind,
    addedAt: cleanTime(raw.addedAt),
  }
}

/** 附件列表：最多 3 个；id 与文档库 docId 都不重复。 */
export function normalizeAttachments(raw: unknown): ChatDocAttachment[] {
  if (!Array.isArray(raw)) return []
  const list: ChatDocAttachment[] = []
  const ids = new Set<string>()
  const docIds = new Set<string>()
  for (const item of raw) {
    const attachment = normalizeAttachment(item)
    if (!attachment || ids.has(attachment.id)) continue
    if (attachment.source === 'library') {
      if (!attachment.docId || docIds.has(attachment.docId)) continue
    }
    ids.add(attachment.id)
    if (attachment.docId) docIds.add(attachment.docId)
    list.push(attachment)
    if (list.length >= CHAT_ATTACH_LIMITS.docs) break
  }
  return list
}

function normalizeMark(raw: unknown): ChatAttachmentMark | undefined {
  if (!isRecord(raw)) return undefined
  const mark: ChatAttachmentMark = {}
  const images = typeof raw.images === 'number' && Number.isFinite(raw.images) ? Math.round(raw.images) : 0
  if (images > 0) mark.images = Math.min(999, images)
  if (Array.isArray(raw.docs)) {
    const docs: ChatDocMark[] = []
    for (const item of raw.docs) {
      if (!isRecord(item)) continue
      const aid = cleanLine(item.aid, 64)
      const title = text(item.title, CHAT_ATTACH_LIMITS.attachTitle)
      if (!aid || !title) continue
      const source = docSourceOf(item.source)
      const docId = cleanLine(item.docId, 64)
      docs.push({ aid, source, ...(source === 'library' && docId ? { docId } : {}), title })
      if (docs.length >= CHAT_ATTACH_LIMITS.docs) break
    }
    if (docs.length) mark.docs = docs
  }
  return mark.images || mark.docs ? mark : undefined
}

function normalizeRefs(raw: unknown): ChatMessageRefs | undefined {
  if (!isRecord(raw)) return undefined
  const docs: ChatCitationDoc[] = []
  if (Array.isArray(raw.docs)) {
    for (const item of raw.docs) {
      if (!isRecord(item)) continue
      const aid = cleanLine(item.aid, 64)
      const title = text(item.title, CHAT_ATTACH_LIMITS.attachTitle)
      if (!aid || !title) continue
      const doc: ChatCitationDoc = { aid, title, source: docSourceOf(item.source), ok: item.ok === true }
      const error = text(item.error, 120)
      if (!doc.ok && error) doc.error = error
      docs.push(doc)
      if (docs.length >= CHAT_ATTACH_LIMITS.docs) break
    }
  }
  const cites: ChatCitation[] = []
  if (Array.isArray(raw.cites)) {
    for (const item of raw.cites) {
      if (!isRecord(item)) continue
      const id = cleanLine(item.id, 64)
      const d = typeof item.d === 'number' && Number.isFinite(item.d) ? Math.round(item.d) : -1
      if (!id || d < 0 || d >= docs.length) continue
      const cite: ChatCitation = { id, d }
      const page = typeof item.p === 'number' && Number.isFinite(item.p) ? Math.round(item.p) : 0
      const line = typeof item.l === 'number' && Number.isFinite(item.l) ? Math.round(item.l) : 0
      if (page > 0) cite.p = page
      if (line > 0) cite.l = line
      cites.push(cite)
      if (cites.length >= CHAT_ATTACH_LIMITS.citesPerMessage) break
    }
  }
  if (!docs.length) return undefined
  return { docs, cites }
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
  const attach = normalizeMark(raw.attach)
  if (attach) message.attach = attach
  const refs = normalizeRefs(raw.refs)
  if (refs) message.refs = refs
  return message
}

export function normalizeChatConversation(raw: unknown, id: string): ChatModeConversation | null {
  if (!isRecord(raw)) return null
  if (typeof raw.version === 'number' && raw.version > CHATMODE_VERSION) return null
  if (typeof raw.id === 'string' && raw.id && raw.id !== id) return null
  const messages = Array.isArray(raw.messages) ? raw.messages.map(normalizeMessage).filter((item): item is ChatModeMessage => Boolean(item)) : []
  const attachments = normalizeAttachments(raw.attachments)
  return {
    version: CHATMODE_VERSION,
    id,
    title: text(raw.title, CHAT_LIMITS.title),
    createdAt: cleanTime(raw.createdAt),
    updatedAt: cleanTime(raw.updatedAt),
    scope: normalizeScope(raw.scope),
    messages,
    attachments,
    ...(raw.customTitle === true ? { customTitle: true } : {}),
    ...(raw.trimmed === true ? { trimmed: true } : {}),
  }
}

/**
 * 落库前的清洗：正文 60000、思考 4000、失败且无内容的回答不存、只留最后 60 条；
 * 剥掉只在内存里的字段（图片原图、进度、界面态），临时文档标题换成「临时文档 N」，
 * 引用截到 40 条、错误文案截到 120 字。
 */
export function prepareConversation(conversation: ChatModeConversation): ChatModeConversation {
  const attachments = normalizeAttachments(conversation.attachments).map(item => ({ ...item }))
  // 临时文档的真实文件名只在内存里；落库前按出现顺序编号成「临时文档 N」。
  const placeholders = new Map<string, string>()
  let tempCount = 0
  for (const attachment of attachments) {
    if (attachment.source !== 'temp') continue
    tempCount++
    const title = tempDocTitle(tempCount)
    attachment.title = title
    placeholders.set(attachment.id, title)
  }
  const titleFor = (doc: { aid: string; source: string; title: string }): string => {
    if (doc.source !== 'temp') return text(doc.title, CHAT_ATTACH_LIMITS.attachTitle)
    const known = placeholders.get(doc.aid)
    if (known) return known
    const generated = tempDocTitle(++tempCount)
    placeholders.set(doc.aid, generated)
    return generated
  }
  const messages = conversation.messages
    .map(message => {
      const next: ChatModeMessage = {
        id: message.id,
        role: message.role,
        content: text(message.content, CHAT_LIMITS.storedContent),
        ...(message.startedAt ? { startedAt: message.startedAt } : {}),
        ...(message.firstTokenAt ? { firstTokenAt: message.firstTokenAt } : {}),
        ...(message.finishedAt ? { finishedAt: message.finishedAt } : {}),
        ...(message.usage ? { usage: message.usage } : {}),
        ...(message.failed === true ? { failed: true } : {}),
        ...(message.stopped === true ? { stopped: true } : {}),
        ...(message.error ? { error: text(message.error, 300) } : {}),
        ...(message.model ? { model: message.model } : {}),
        ...(message.effort ? { effort: message.effort } : {}),
      }
      if (message.reasoning) next.reasoning = text(message.reasoning, CHAT_LIMITS.storedReasoning)
      if (message.memory) next.memory = { ...message.memory }
      if (message.attach) {
        const mark: ChatAttachmentMark = {}
        const images = Math.max(0, Math.round(message.attach.images ?? message.images?.length ?? 0))
        if (images) mark.images = images
        if (message.attach.docs?.length) {
          mark.docs = message.attach.docs.slice(0, CHAT_ATTACH_LIMITS.docs).map(doc => ({
            aid: doc.aid,
            source: doc.source,
            ...(doc.source === 'library' && doc.docId ? { docId: doc.docId } : {}),
            title: titleFor(doc),
          }))
        }
        if (mark.images || mark.docs) next.attach = mark
      }
      if (message.refs?.docs.length) {
        const docs: ChatCitationDoc[] = message.refs.docs.slice(0, CHAT_ATTACH_LIMITS.docs).map(doc => ({
          aid: doc.aid,
          title: titleFor(doc),
          source: doc.source,
          ok: doc.ok,
          ...(doc.ok || !doc.error ? {} : { error: text(doc.error, 120) }),
        }))
        const cites: ChatCitation[] = message.refs.cites
          .filter(cite => Number.isInteger(cite.d) && cite.d >= 0 && cite.d < docs.length)
          .slice(0, CHAT_ATTACH_LIMITS.citesPerMessage)
          .map(cite => ({
            id: cite.id,
            d: cite.d,
            ...(cite.p ? { p: cite.p } : {}),
            ...(cite.l ? { l: cite.l } : {}),
          }))
        next.refs = { docs, cites }
      }
      return next
    })
    .filter(message => !(message.role === 'assistant' && message.failed && !message.content))
    .slice(-CHAT_LIMITS.messages)
  return {
    version: CHATMODE_VERSION,
    id: conversation.id,
    title: text(conversation.title, CHAT_LIMITS.title),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    scope: conversation.scope,
    messages,
    attachments,
    ...(conversation.customTitle === true ? { customTitle: true } : {}),
    ...(conversation.trimmed === true ? { trimmed: true } : {}),
  }
}

/**
 * 按字节装进上限：先去掉全部思考过程；仍超则去掉较早回答的引用明细（保留最近 10 条助手消息）；
 * 仍超则从最早的一问一答开始丢并置 trimmed。
 */
export function fitConversation(conversation: ChatModeConversation, maxBytes: number = CHAT_LIMITS.conversationBytes): ChatModeConversation {
  const size = (value: ChatModeConversation) => utf8Bytes(JSON.stringify(value))
  if (size(conversation) <= maxBytes) return conversation
  let next: ChatModeConversation = { ...conversation, messages: conversation.messages.map(({ reasoning: _reasoning, ...rest }) => rest) }
  if (size(next) <= maxBytes) return next
  const assistantIndexes: number[] = []
  next.messages.forEach((message, index) => { if (message.role === 'assistant') assistantIndexes.push(index) })
  const keep = new Set(assistantIndexes.slice(-10))
  next = {
    ...next,
    messages: next.messages.map((message, index) => {
      if (!message.refs?.cites?.length || keep.has(index)) return message
      return { ...message, refs: { docs: message.refs.docs, cites: [] } }
    }),
  }
  if (size(next) <= maxBytes) return next
  while (next.messages.length > 1 && size(next) > maxBytes) {
    const messages = next.messages.length > 2 ? next.messages.slice(2) : next.messages.slice(-1)
    next = { ...next, trimmed: true, messages }
  }
  return next
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
  /**
   * 索引的「读 → 改 → 写」整段放进清单键的串行链：两段会话同时保存时不会互相覆盖、丢索引项。
   * 回调在链里执行，所以这里直接写存储，不能再 enqueue 同一个键（会自锁）。
   */
  async function mutateIndex(mutate: (index: ChatModeIndex) => ChatModeIndex): Promise<void> {
    await enqueue(CHATMODE_KEYS.index, async () => {
      const index = await readIndex()
      const value = JSON.stringify(mutate(index))
      if (utf8Bytes(value) > CHAT_LIMITS.indexBytes) return
      await storage.setSetting(CHATMODE_KEYS.index, value)
    })
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
      const entry: ChatModeIndexEntry = {
        id: prepared.id, title: prepared.title, createdAt: prepared.createdAt, updatedAt: prepared.updatedAt,
        scope: prepared.scope, count: prepared.messages.length,
      }
      const dropped: ChatModeIndexEntry[] = []
      await mutateIndex(index => {
        let list = index.list.filter(item => item.id !== prepared.id)
        if (entry.count > 0) list.unshift(entry)
        list.sort((a, b) => b.updatedAt - a.updatedAt)
        dropped.push(...list.slice(CHAT_LIMITS.conversations))
        list = list.slice(0, CHAT_LIMITS.conversations)
        return { version: CHATMODE_VERSION, activeId, list }
      })
      for (const item of dropped) await enqueue(conversationKey(item.id), () => storage.deleteSetting(conversationKey(item.id)))
    },
    async deleteConversation(id, activeId) {
      await enqueue(conversationKey(id), () => storage.deleteSetting(conversationKey(id)))
      await mutateIndex(index => {
        const list = index.list.filter(item => item.id !== id)
        return { version: CHATMODE_VERSION, activeId: activeId === id ? (list[0]?.id || '') : activeId, list }
      })
    },
    async flush() { await Promise.allSettled([...chains.values()]) },
    freeze() { frozen = true },
    unfreeze() { frozen = false },
  }
}
