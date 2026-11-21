/** 对话模式的历史裁剪、请求消息提取与标题生成。 */
import { CHAT_LIMITS, type ChatModeConversation } from './types.ts'

/** 标题：压缩空白、去首尾；超过 28 字取前 27 字加省略号。不调模型。 */
export function chatTitle(question: string): string {
  const text = question.trim().replace(/\s+/g, ' ')
  return text.length > CHAT_LIMITS.title ? `${text.slice(0, CHAT_LIMITS.title - 1)}…` : text
}

/**
 * 随请求发出的消息：只取 role / content，跳过失败的助手消息与空内容。
 * 历史里带过图片的旧用户消息只发文字，末尾补一句「曾附 N 张图片」——图片本身不随历史重发。
 */
export function wireMessages(conversation: ChatModeConversation): { role: 'user' | 'assistant'; content: string }[] {
  const kept = conversation.messages
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .filter(message => !(message.role === 'assistant' && message.failed))
    .filter(message => message.content.trim().length > 0)
  return kept.map((message, index) => {
    const isLatest = index === kept.length - 1
    const attached = isLatest ? 0 : (message.attach?.images ?? 0)
    const content = attached > 0
      ? `${message.content}\n\n[这条消息当时附了 ${attached} 张图片，图片未随历史发送]`
      : message.content
    return { role: message.role, content }
  })
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
