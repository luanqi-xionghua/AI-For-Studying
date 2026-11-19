/**
 * 一次性的模型调用（翻译、快速解释、/btw、/compress）：读当前 AI 设置，流式返回文字，并把用量记进账本。
 * 翻译与快速解释用各自所选的模型预设，模型和强度照原样；fast（小而快的模型，与问题预判相同的选法）只对其余几种起作用。
 */
import { loadAiSettings, loadApiKey, translationSettings, explainSettings, hasPresets, NO_PRESET_MESSAGE } from './settings.mjs'
import { fastModel } from './predict'
import { estimateTokens } from './workspace'
import { recordUsage, type UsageKind } from './usage'

/** 翻译与快速解释：照用所选预设的模型与思考强度，不换模型、不降强度（强度是「模型默认」就不发强度参数，由服务商决定）。 */
function presetChoice(settings: any, what = '翻译') {
  const model = String(settings.model || '')
  if (!model && settings.provider !== 'codex') throw new Error(`${what}用的模型预设没有选模型：请在 设置 → AI 里给它选一个模型。`)
  return { model, effort: String(settings.effort || '') }
}

// 翻译用的连接预热：提前和服务商握手（TCP + TLS），真正翻译时直接复用，不必再等建连。
const warmed = new Map<string, number>()
const WARM_FOR = 240_000
function originOf(baseUrl: string) { try { return new URL(baseUrl).origin } catch { return '' } }
/** 只发一个不带密钥的小请求；连接留在 Python 后端的连接池里。 */
export function warmTranslation() {
  if (!(globalThis as any).__KAIZHI_PYTHON__) return
  const settings: any = translationSettings(loadAiSettings())
  const origin = settings.provider === 'codex' ? '' : originOf(settings.baseUrl || '')
  if (!origin || Date.now() - (warmed.get(origin) || 0) < WARM_FOR) return
  warmed.set(origin, Date.now())
  void (async () => {
    try {
      const { transportFetch } = await import('./transport.mjs')
      const response = await transportFetch(String(settings.baseUrl).replace(/\/+$/, '') + '/models', { method: 'GET', signal: AbortSignal.timeout(8000) })
      await response.text()
    } catch { warmed.delete(origin) }
  })()
}

export type CompleteOptions = { kind: UsageKind; messages: { role: 'user' | 'assistant' | 'system'; content: string; images?: string[] }[]; fast?: boolean; signal: AbortSignal; onDelta?: (text: string, all: string) => void; onReasoning?: (text: string) => void }

export async function complete(options: CompleteOptions): Promise<string> {
  // 翻译与快速解释各用自己选的模型预设，其余（/btw、/compress）沿用阅读助手的预设。
  const own = options.kind === 'translate' || options.kind === 'explain'
  const settings: any = options.kind === 'translate' ? translationSettings(loadAiSettings()) : options.kind === 'explain' ? explainSettings(loadAiSettings()) : loadAiSettings()
  // 一个模型预设都还没建：不悄悄用别的配置，提示先去新建。
  if (own ? !settings.preset : !hasPresets(settings)) throw new Error(NO_PRESET_MESSAGE)
  const apiKey = settings.provider === 'codex' ? '' : await loadApiKey(settings.provider)
  const keyless = settings.provider === 'custom' && /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(settings.baseUrl || '')
  if (settings.provider !== 'codex' && !apiKey && !keyless) throw new Error('请先在设置里连接 AI 服务。')
  options.signal.throwIfAborted()
  const choice = own ? presetChoice(settings, options.kind === 'explain' ? '快速解释' : '翻译')
    : options.fast ? fastModel(settings) : { model: settings.model || '', effort: settings.effort || '' }
  const { streamChat } = await import('./providers.mjs')
  let text = '', reported: { input?: number; output?: number; reasoning?: number } | undefined
  const started = Date.now()
  try {
    await streamChat({ ...settings, ...choice, fast: own ? settings.fast : options.fast ? false : settings.fast, apiKey, signal: options.signal, messages: options.messages,
      onDelta: (delta: string) => { text += delta; options.onDelta?.(delta, text) }, onReasoning: (delta: string) => options.onReasoning?.(delta),
      onUsage: (usage: { input?: number; output?: number; reasoning?: number }) => { reported = { input: (reported?.input || 0) + (usage.input || 0), output: (reported?.output || 0) + (usage.output || 0), reasoning: (reported?.reasoning || 0) + (usage.reasoning || 0) } } })
    // 刚用过的连接还在池里，不必马上再预热。
    if (options.kind === 'translate') { const origin = originOf(settings.baseUrl || ''); if (origin) warmed.set(origin, Date.now()) }
  } finally {
    recordUsage({ kind: options.kind, provider: settings.provider, model: choice.model || settings.model || '', ms: Date.now() - started, estimated: !reported,
      input: reported?.input ?? estimateTokens(options.messages.map(item => item.content).join('\n')), output: reported?.output ?? estimateTokens(text), reasoning: reported?.reasoning || 0 })
  }
  return text
}
