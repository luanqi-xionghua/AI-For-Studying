/**
 * 带附件回合的编排层。
 * M3 只有图片（T1：一次 streamChat，图片挂在最后一条消息上）；
 * 文档单本（T2）与多本对比（T3）在 M4 接入，调用结构保持同一入口。
 */
import { CHAT_ATTACH_LIMITS, type ChatUsage } from './types.ts'

export type CompareDeps = {
  streamChat: (options: any) => Promise<unknown>
  recordUsage: (entry: any) => void
  estimateTokens: (text: string) => number
  now: () => number
}

export type AttachmentTurnInput = {
  provider: string
  baseUrl: string
  protocol: string
  model: string
  effort: string
  signal: AbortSignal
  messages: { role: string; content: string }[]
  systemPrefix: string
  extraInstructions: string
  /** 本问的图片 data URL（只在内存里）。 */
  images: string[]
  onDelta: (delta: string) => void
  onReasoning: (delta: string) => void
  onUsage: (usage: ChatUsage) => void
}

export type AttachmentTurnResult = { usage: ChatUsage; imageCount: number }

/** 图片只挂在本问的最后一条用户消息上；历史消息保持纯文字。 */
export function withImages<T extends { role: string; content: string }>(messages: T[], images: readonly string[]): (T | { role: string; content: string; images: string[] })[] {
  if (!images.length) return messages
  const last = messages.at(-1)
  if (!last) return messages
  return [...messages.slice(0, -1), { ...last, images: [...images] }] as (T | { role: string; content: string; images: string[] })[]
}

const emptyUsage = (): ChatUsage => ({ input: 0, output: 0, reasoning: 0, estimated: true })

/**
 * T1：只有图片（没有文档）。一次调用，流式；用量按这一条子调用记。
 * 中止 / 报错时也把已经发生的用量记下来，再把异常抛回给 state 决定「停止」还是「失败」。
 */
export async function runAttachmentTurn(input: AttachmentTurnInput, deps: CompareDeps): Promise<AttachmentTurnResult> {
  const images = input.images.filter(Boolean).slice(0, CHAT_ATTACH_LIMITS.images)
  const messages = withImages(input.messages, images)
  const startedAt = deps.now()
  let content = ''
  let reported: ChatUsage | undefined
  let usage: ChatUsage = emptyUsage()
  try {
    await deps.streamChat({
      provider: input.provider, baseUrl: input.baseUrl, protocol: input.protocol,
      model: input.model, effort: input.effort, signal: input.signal,
      messages, systemPrefix: input.systemPrefix, extraInstructions: input.extraInstructions,
      onDelta: (delta: string) => { content += delta; input.onDelta(delta) },
      onReasoning: input.onReasoning,
      onUsage: (value: ChatUsage) => { reported = value; input.onUsage(value) },
    })
  } finally {
    // 没有回传用量时按字数估算；中止前已经发生的部分也要记账。
    usage = reported ?? {
      input: deps.estimateTokens(messages.map(message => message.content).join('\n')),
      output: deps.estimateTokens(content),
      reasoning: 0,
      estimated: true,
    }
    deps.recordUsage({
      kind: 'chatmode', provider: input.provider, model: input.model,
      ms: deps.now() - startedAt, input: usage.input, output: usage.output,
      reasoning: usage.reasoning, estimated: usage.estimated,
    })
  }
  return { usage, imageCount: images.length }
}
