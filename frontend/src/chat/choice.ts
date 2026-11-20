/** 对话模式自己的模型选择：存 localStorage，从不改动阅读助手的选择或任何预设。 */
import { effortForModel, presetModels, type Preset } from '../ai/presets.ts'
import { CHATMODE_VERSION, type ChatModelChoice } from './types.ts'

export const CHAT_CHOICE_KEY = 'kaizhi.chatmode.choice.v1'

export type ResolvedChatChoice = {
  preset: Preset
  provider: string
  baseUrl: string
  protocol: string
  model: string
  effort: string
}

export function connectionScope(preset: Pick<Preset, 'provider' | 'baseUrl' | 'protocol'>): string {
  return JSON.stringify([preset.provider, preset.baseUrl, preset.protocol])
}

export function normalizeChatChoice(raw: unknown): ChatModelChoice {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const text = (value: unknown) => typeof value === 'string' ? value : ''
  return { version: CHATMODE_VERSION, preset: text(source.preset), scope: text(source.scope), model: text(source.model), effort: text(source.effort) }
}

export function loadChatChoice(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): ChatModelChoice {
  try {
    const raw = storage?.getItem(CHAT_CHOICE_KEY)
    if (!raw) return normalizeChatChoice(null)
    return normalizeChatChoice(JSON.parse(raw))
  } catch { return normalizeChatChoice(null) }
}

export function saveChatChoice(choice: ChatModelChoice, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try { storage?.setItem(CHAT_CHOICE_KEY, JSON.stringify(choice)) } catch { /* 存不下就只在这次有效 */ }
}

/** 把存储的选择展开成这一轮要用的连接参数。一个预设都没有 → null。 */
export function resolveChatChoice(settings: any, choice: ChatModelChoice): ResolvedChatChoice | null {
  const presets: Preset[] = Array.isArray(settings?.presets) ? settings.presets : []
  if (!presets.length) return null
  const preset = presets.find(item => item.id === choice.preset)
    || presets.find(item => item.id === settings.assistantPreset)
    || presets[0]
  const scoped = choice.preset === preset.id && choice.scope === connectionScope(preset) && Boolean(choice.model)
  const model = scoped ? choice.model : preset.model
  const rawEffort = scoped ? choice.effort : preset.effort
  const known = presetModels(preset.provider).find(item => item.id === model)
  return {
    preset,
    provider: preset.provider,
    baseUrl: preset.baseUrl,
    protocol: preset.protocol,
    model,
    effort: effortForModel(known, rawEffort),
  }
}

/** 换预设：模型与强度回到该预设自己的。 */
export function pickChatPreset(settings: any, presetId: string): ChatModelChoice {
  const preset: Preset | undefined = (settings?.presets || []).find((item: Preset) => item.id === presetId)
  if (!preset) return normalizeChatChoice(null)
  return { version: CHATMODE_VERSION, preset: preset.id, scope: connectionScope(preset), model: preset.model, effort: preset.effort }
}

/** 换模型：强度不被新模型支持时换成该模型的默认强度。 */
export function pickChatModel(settings: any, choice: ChatModelChoice, model: string): ChatModelChoice {
  const resolved = resolveChatChoice(settings, choice)
  if (!resolved) return choice
  const known = presetModels(resolved.provider).find(item => item.id === model)
  const effort = effortForModel(known, choice.effort || resolved.preset.effort)
  return { version: CHATMODE_VERSION, preset: resolved.preset.id, scope: connectionScope(resolved.preset), model, effort }
}

/** 换强度。 */
export function pickChatEffort(settings: any, choice: ChatModelChoice, effort: string): ChatModelChoice {
  const resolved = resolveChatChoice(settings, choice)
  return {
    version: CHATMODE_VERSION,
    preset: resolved?.preset.id ?? choice.preset,
    scope: resolved ? connectionScope(resolved.preset) : choice.scope,
    model: resolved?.model ?? choice.model,
    effort,
  }
}
