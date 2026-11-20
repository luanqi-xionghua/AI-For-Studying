/** 对话模式的历史裁剪、请求消息提取与标题生成。 */
import { CHAT_LIMITS, type ChatModeConversation } from './types.ts'

/** 标题：压缩空白、去首尾；超过 28 字取前 27 字加省略号。不调模型。 */
export function chatTitle(question: string): string {
  const text = question.trim().replace(/\s+/g, ' ')
  return text.length > CHAT_LIMITS.title ? `${text.slice(0, CHAT_LIMITS.title - 1)}…` : text
}

/** 随请求发出的消息：只取 role / content，跳过失败的助手消息与空内容。 */
export function wireMessages(conversation: ChatModeConversation): { role: 'user' | 'assistant'; content: string }[] {
  return conversation.messages
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .filter(message => !(message.role === 'assistant' && message.failed))
    .filter(message => message.content.trim().length > 0)
    .map(message => ({ role: message.role, content: message.content }))
}

/**
 * 历史裁剪：最后一条（刚发的问题）必留；从倒数第二条往前收，收到 12 条或累计 40000 字就停；
 * 收完如果第一条是助手消息就去掉它，保证以用户消息开头。
 */
export function boundChatHistory(
  messages: { role: string; content: string }[],
  maxMessages: number = CHAT_LIMITS.historyMessages,
  maxChars: number = CHAT_LIMITS.historyChars,
): { role: string; content: string }[] {
  if (!messages.length) return []
  const last = messages[messages.length - 1]
  const result: { role: string; content: string }[] = [last]
  let chars = last.content.length
  for (let index = messages.length - 2; index >= 0; index--) {
    if (result.length >= maxMessages + 1) break
    const next = messages[index]
    if (chars + next.content.length > maxChars) break
    result.unshift(next)
    chars += next.content.length
  }
  if (result.length > 1 && result[0].role === 'assistant') result.shift()
  return result
}
