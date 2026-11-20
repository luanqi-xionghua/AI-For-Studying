/** 记忆总结的模型调用：取「记忆管理」预设，调一次 streamChat，汇总用量。 */
import { loadAiSettings, memorySettings, isHighMemoryEffort } from '../ai/settings.mjs'
import { EFFORT_NAMES, modelName, presetTitle } from '../ai/presets.ts'
import { recordUsage } from '../ai/usage'
import { estimateTokens } from '../ai/workspace.ts'
import { MemoryError } from './prompts.ts'
import { OUTPUT_CHAR_CAP, REQUEST_TIMEOUT_MS } from './scheduler.ts'

export const NO_MEMORY_PRESET_MESSAGE = '未配置记忆管理预设：请在 设置 → AI → 各处默认预设 里为「记忆管理」选择一个预设。'
export const NO_MEMORY_MODEL_MESSAGE = '记忆管理用的模型预设没有选模型：请在 设置 → AI 里给它选一个模型。'

export type MemoryModelRequest = { kind: 'doc' | 'global'; system: string; input: string; signal: AbortSignal }
export type MemoryModelCall = (request: MemoryModelRequest) => Promise<string>

export type MemoryConfigView = {
  configured: boolean
  presetTitle: string
  modelName: string
  effort: string
  effortName: string
  high: boolean
  message: string
}

/** 记忆预设是否可用：{ ok: true } 或 { ok: false, message }。不发请求。 */
export function memoryConfigStatus(settings: any = memorySettings(loadAiSettings())): { ok: boolean; message: string } {
  if (!settings?.preset) return { ok: false, message: NO_MEMORY_PRESET_MESSAGE }
  if (!String(settings.model || '').trim()) return { ok: false, message: NO_MEMORY_MODEL_MESSAGE }
  return { ok: true, message: '' }
}

/** 设置区显示用的只读视图。 */
export function memoryConfigView(): MemoryConfigView {
  const settings: any = memorySettings(loadAiSettings())
  const status = memoryConfigStatus(settings)
  if (!settings.preset) {
    return { configured: false, presetTitle: '', modelName: '', effort: '', effortName: EFFORT_NAMES[''], high: false, message: status.message }
  }
  const effort = settings.effort || ''
  return {
    configured: status.ok,
    presetTitle: presetTitle(settings.preset),
    modelName: modelName(settings.preset),
    effort,
    effortName: EFFORT_NAMES[effort] ?? effort,
    high: isHighMemoryEffort(effort),
    message: status.message,
  }
}

export const callMemoryModel: MemoryModelCall = async request => {
  const settings: any = memorySettings(loadAiSettings())
  if (!settings.preset) throw new MemoryError('no-preset', NO_MEMORY_PRESET_MESSAGE)
  if (!String(settings.model || '').trim()) throw new MemoryError('no-model', NO_MEMORY_MODEL_MESSAGE)
  const controller = new AbortController()
  const abortFromOuter = () => controller.abort(request.signal.reason)
  if (request.signal.aborted) controller.abort(request.signal.reason)
  else request.signal.addEventListener('abort', abortFromOuter, { once: true })
  const timeout = setTimeout(() => controller.abort(new MemoryError('timeout', '记忆总结超时，已取消。')), REQUEST_TIMEOUT_MS)
  const started = Date.now()
  let text = ''
  let reported: any
  try {
    const { streamChat } = await import('../ai/providers.mjs')
    await streamChat({
      provider: settings.provider, baseUrl: settings.baseUrl, protocol: settings.protocol,
      model: settings.model, effort: settings.effort || '', signal: controller.signal,
      systemPrefix: request.system, extraInstructions: '',
      messages: [{ role: 'user', content: request.input }],
      onDelta: (delta: string) => {
        text += delta
        if (text.length > OUTPUT_CHAR_CAP) controller.abort(new MemoryError('too-long', '模型输出过长，已取消。'))
      },
      onReasoning: () => {},
      onUsage: (usage: any) => { reported = usage },
    })
  } finally {
    clearTimeout(timeout)
    request.signal.removeEventListener('abort', abortFromOuter)
    recordUsage({
      kind: 'memory',
      provider: settings.provider,
      model: settings.model,
      ms: Date.now() - started,
      input: reported?.input ?? estimateTokens(request.system + request.input),
      output: reported?.output ?? estimateTokens(text),
      reasoning: reported?.reasoning || 0,
      estimated: !reported,
    })
  }
  return text
}
