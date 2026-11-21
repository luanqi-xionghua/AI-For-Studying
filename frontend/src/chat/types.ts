/** 对话模式的类型与上限。纯类型模块，Node 单测直接导入。 */
import type { MemoryScope } from '../memory/types.ts'

export const CHATMODE_VERSION = 1 as const
export const CHATMODE_KEYS = { index: 'chatmode.v1.index', conversationPrefix: 'chatmode.v1.c.' } as const
export const conversationKey = (id: string) =>
  CHATMODE_KEYS.conversationPrefix + id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40)

export const CHAT_LIMITS = {
  conversations: 40,
  messages: 60,
  question: 16000,
  totalChars: 150000,
  storedContent: 60000,
  storedReasoning: 4000,
  title: 28,
  historyMessages: 12,
  historyChars: 40000,
  injection: 1500,
  conversationBytes: 900 * 1024,
  indexBytes: 256 * 1024,
} as const

/** 附件的上限与预算。图片、文档、多文档对比共用这一份表。 */
export const CHAT_ATTACH_LIMITS = {
  /** 每问最多图片数，与 ai/workspace.ts 的 MAX_ATTACHMENTS 一致。 */
  images: 6,
  /** 一问的图片 data URL 合计字符数（压缩后），与 workspace.ts 的口径一致。 */
  imageTotalChars: 8 * 1024 * 1024,
  /** 解码前的原文件上限，防止解码时内存暴涨。 */
  imageSourceBytes: 20 * 1024 * 1024,
  /** 压缩时长边像素，复用 reader/crop.ts 的 MAX_CROP_EDGE。 */
  imageEdge: 1600,
  /** 每段会话在内存里保留的历史图片总量，超出时从最早的消息开始丢原图。 */
  liveImageChars: 16 * 1024 * 1024,
  /** 每段会话的文档附件数（文档库 + 临时）。 */
  docs: 3,
  /** 附件文档合计大小，按 Doc.size 或临时文件大小。 */
  docBytesTotal: 200 * 1024 * 1024,
  /** 单本证据笔记硬截断，提示词里要求 ≤800 字。 */
  noteChars: 3000,
  /** 合成输入里每本最多带几段证据、每段多少字。 */
  evidencePerDoc: 8,
  evidenceChars: 300,
  /** 每条回答最多持久化的引用数。 */
  citesPerMessage: 40,
  /** 每本检索超时；整轮超时（N≥2 / N=1）。都低于 harness 单请求 600s。 */
  perDocTimeoutMs: 150000,
  turnTimeoutMs: 360000,
  turnTimeoutSingleMs: 300000,
  /** 每轮同时检索的本数。 */
  innerConcurrency: 2,
  /** 多文档编排的历史裁剪：每本笔记 4 条 / 8000 字，合成 8 条 / 20000 字。 */
  compareHistory: 8,
  compareHistoryChars: 20000,
  perDocHistory: 4,
  perDocHistoryChars: 8000,
  /** 持久化的附件标题长度。 */
  attachTitle: 60,
} as const

/** 对话模式选的预设 / 模型 / 强度。存 localStorage 的 kaizhi.chatmode.choice.v1。 */
export type ChatModelChoice = {
  version: 1
  /** 预设 id；'' = 没选过（跟随阅读助手当前的预设）。 */
  preset: string
  /** 选择当时预设的连接指纹 JSON.stringify([provider, baseUrl, protocol])；预设连接变了，model / effort 作废。 */
  scope: string
  model: string
  effort: string
}

export type ChatUsage = { input: number; output: number; reasoning: number; estimated: boolean; calls?: number }

/** 一条消息发出时用的记忆范围，供历史里显示范围标记。不保存注入文本本身。 */
export type ChatMemoryTag = {
  kind: 'none' | 'global' | 'doc'
  docId?: string
  title?: string
  /** 这一轮是否真的注入了记忆（范围有内容才为 true）。 */
  injected: boolean
  chars: number
  /** 这一轮带附件，按规则没有写入学习记忆。 */
  skipped?: 'attachments'
}

export type ChatDocKind = 'pdf' | 'markdown' | 'word'
export type ChatDocSource = 'library' | 'temp'

/** 整段会话有效的文档附件。temp 只存「临时文档 N」占位，不存 handle / 文件名 / 大小。 */
export type ChatDocAttachment = {
  id: string
  source: ChatDocSource
  /** 仅 source === 'library'。 */
  docId?: string
  /** 文档库用文档名；临时文档用「临时文档 N」占位。 */
  title: string
  kind: ChatDocKind
  addedAt: number
}

/** 用户消息里的文档标记：这一轮带了哪些文档。 */
export type ChatDocMark = { aid: string; source: ChatDocSource; docId?: string; title: string }

/** 用户消息上的轻量附件标记：曾有图片张数 + 本轮带了哪些文档。 */
export type ChatAttachmentMark = { images?: number; docs?: ChatDocMark[] }

/** 回答里的引用映射：docs 是这一轮附件的顺序表，cites[].d 是它的下标。 */
export type ChatCitationDoc = { aid: string; title: string; source: ChatDocSource; ok: boolean; error?: string }
export type ChatCitation = { id: string; d: number; p?: number; l?: number }
/** 「参考原文」用的片段：只在本次运行内有原文，落库前剥掉。 */
export type ChatCitationSnippet = { id: string; d: number; p?: number; l?: number; text: string }
export type ChatMessageRefs = { docs: ChatCitationDoc[]; cites: ChatCitation[]; snippets?: ChatCitationSnippet[] }

/** 多文档检索进度：只在内存里，供界面显示。 */
export type ChatDocProgress = {
  aid: string
  status: 'pending' | 'running' | 'ok' | 'failed'
  /** 已查阅的证据段数。 */
  evidence?: number
  note?: string
}

export type ChatModeMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  startedAt?: number
  firstTokenAt?: number
  finishedAt?: number
  usage?: ChatUsage
  failed?: boolean
  stopped?: boolean
  error?: string
  model?: string
  effort?: string
  /** 只在 user 消息上：这一问用的记忆范围。 */
  memory?: ChatMemoryTag
  /** 只在 user 消息上：这一轮带过哪些附件（轻量标记，可持久化）。 */
  attach?: ChatAttachmentMark
  /** 只在 user 消息上：图片 data URL。**只在内存里**，落库前剥掉。 */
  images?: string[]
  /** 只在 assistant 消息上：对比状态与引用映射（可持久化）。 */
  refs?: ChatMessageRefs
  /** 只在 assistant 消息上：每本的检索进度。**只在内存里**。 */
  progress?: ChatDocProgress[]
}

export type ChatModeConversation = {
  version: 1
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** 这段会话当前的记忆范围；新会话默认 { kind: 'global' }。 */
  scope: MemoryScope
  messages: ChatModeMessage[]
  /** 整会话有效的文档附件，最多 3 个。 */
  attachments?: ChatDocAttachment[]
  /** 用户改过标题：自动标题不再覆盖。 */
  customTitle?: true
  /** 因容量上限移除过较早的消息。 */
  trimmed?: boolean
}

export type ChatModeIndexEntry = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  scope: MemoryScope
  count: number
}

export type ChatModeIndex = { version: 1; activeId: string; list: ChatModeIndexEntry[] }
