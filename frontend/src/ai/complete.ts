/**
 * 一次性的模型调用（翻译、快速解释、/btw、/compress）：读当前 AI 设置，流式返回文字，并把用量记进账本。
 * 翻译与快速解释用各自所选的模型预设，模型和强度照原样；fast（小而快的模型，与问题预判相同的选法）只对其余几种起作用。
 */
import { loadAiSettings, translationSettings, explainSettings, hasPresets, NO_PRESET_MESSAGE } from './settings.mjs'
import { fastModel } from './predict'
import { estimateTokens } from './workspace'
import { recordUsage, type UsageKind } from './usage'

/** 翻译与快速解释：照用所选预设的模型与思考强度，不换模型、不降强度（强度是「模型默认」就不发强度参数，由服务商决定）。 */
function presetChoice(settings: any, what = '翻译') {
  const model = String(settings.model || '')
  if (!model) throw new Error(`${what}用的模型预设没有选模型：请在 设置 → AI 里给它选一个模型。`)
  return { model, effort: String(settings.effort || '') }
}

/** Only retry a screenshot as text for a modality rejection, never a bad key or network failure. */
export function unsupportedImage(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause)
  return /(?:unsupported|not support(?:ed)?|does not (?:support|accept)|不支持).{0,60}(?:images?|vision|multimodal|图[片像])|(?:images?|vision|multimodal|图[片像]).{0,60}(?:unsupported|not supported|不支持)|(?:only supports?|仅支持).{0,18}(?:text|文本)|text.only model/i.test(message)
}

export type CompleteOptions = { kind: UsageKind; translation?: ReturnType<typeof translationSettings>; messages: { role: 'user' | 'assistant' | 'system'; content: string; images?: string[] }[]; fast?: boolean; signal: AbortSignal; onDelta?: (text: string, all: string) => void; onReasoning?: (text: string) => void; /** 学习记忆等附加 system 内容（见 ai/memory-context.ts）。 */ extraInstructions?: string; /** 覆盖默认的 READER_SYSTEM 前缀（资料检索重排用）；不传时保持原行为。 */ systemPrefix?: string }

export async function complete(options: CompleteOptions): Promise<string> {
  // 翻译与快速解释各用自己选的模型预设，其余（/btw、/compress）沿用阅读助手的预设。
  const own = options.kind === 'translate' || options.kind === 'explain'
  const settings: any = options.kind === 'translate' ? options.translation ?? translationSettings(loadAiSettings()) : options.kind === 'explain' ? explainSettings(loadAiSettings()) : loadAiSettings()
  // 一个模型预设都还没建：不悄悄用别的配置，提示先去新建。
  if (own ? !settings.preset : !hasPresets(settings)) throw new Error(NO_PRESET_MESSAGE)
  options.signal.throwIfAborted()
  const choice = own ? presetChoice(settings, options.kind === 'explain' ? '快速解释' : '翻译')
    : options.fast ? fastModel(settings) : { model: settings.model || '', effort: settings.effort || '' }
  const { streamChat } = await import('./providers.mjs')
  let text = '', reported: { input?: number; output?: number; reasoning?: number } | undefined
  const started = Date.now()
  try {
    await streamChat({ ...settings, ...choice, fast: own ? settings.fast : options.fast ? false : settings.fast, signal: options.signal, messages: options.messages,
      extraInstructions: options.extraInstructions,
      ...(typeof options.systemPrefix === 'string' ? { systemPrefix: options.systemPrefix } : {}),
      onDelta: (delta: string) => { text += delta; options.onDelta?.(delta, text) }, onReasoning: (delta: string) => options.onReasoning?.(delta),
      onUsage: (usage: { input?: number; output?: number; reasoning?: number }) => { reported = { input: (reported?.input || 0) + (usage.input || 0), output: (reported?.output || 0) + (usage.output || 0), reasoning: (reported?.reasoning || 0) + (usage.reasoning || 0) } } })
  } finally {
    recordUsage({ kind: options.kind, provider: settings.provider, model: choice.model || settings.model || '', ms: Date.now() - started, estimated: !reported,
      input: reported?.input ?? estimateTokens(options.messages.map(item => item.content).join('\n')), output: reported?.output ?? estimateTokens(text), reasoning: reported?.reasoning || 0 })
  }
  return text
}
