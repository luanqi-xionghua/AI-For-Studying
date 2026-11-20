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

export type ChatUsage = { input: number; output: number; reasoning: number; estimated: boolean }

/** 一条消息发出时用的记忆范围，供历史里显示范围标记。不保存注入文本本身。 */
export type ChatMemoryTag = {
  kind: 'none' | 'global' | 'doc'
  docId?: string
  title?: string
  /** 这一轮是否真的注入了记忆（范围有内容才为 true）。 */
  injected: boolean
  chars: number
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
