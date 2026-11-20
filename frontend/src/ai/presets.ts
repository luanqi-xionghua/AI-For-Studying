/** 模型预设在界面上的显示：标题、说明、可选模型列表。数据结构与保存见 settings.mjs。 */
import { getProvider } from './providers.mjs'
import { supportsFast } from './settings.mjs'

export type Preset = { id: string; name: string; provider: string; baseUrl: string; protocol: string; model: string; effort: string; fast: boolean }
export type PresetModel = { id: string; name?: string; efforts?: string[]; defaultEffort?: string; vision?: boolean }
/** 记忆总结的思考强度。'' = 模型默认（不发强度参数）。 */
export type MemoryEffort = '' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'

export const EFFORT_NAMES: Record<string, string> = { '': '模型默认', none: '不思考', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高', ultra: '极致' }

/** 这个服务商可选的模型：Codex 用本机读到的列表，其他用内置列表。 */
export function presetModels(provider: string): PresetModel[] {
  return (getProvider(provider) as any)?.models || []
}
/** 输入栏保留预设里填写的非内置模型，切换模型时只沿用它支持的强度。 */
export function composerModels(provider: string, ...ids: string[]): (PresetModel & { name: string })[] {
  const models = presetModels(provider).map(m => ({ ...m, name: m.name || m.id }))
  const custom = [...new Set(ids)].filter(id => id && !models.some(m => m.id === id))
  return [...custom.map(id => ({ id, name: id })), ...models]
}
export function effortForModel(model: PresetModel | undefined, effort: string) {
  return effort && model?.efforts && !model.efforts.includes(effort) ? model.defaultEffort || '' : effort
}
export function providerName(provider: string) { return (getProvider(provider) as any)?.name || provider }
export function modelName(preset: Pick<Preset, 'provider' | 'model'>) {
  const found = presetModels(preset.provider).find(item => item.id === preset.model)
  return found?.name || preset.model || '未选模型'
}
/** 标题：起了名字用名字；没起名字用模型名（Codex 与自定义接口前面加上来源，免得和 API 的同名模型混淆）。 */
export function presetTitle(preset: Preset) {
  if (preset.name) return preset.name
  const prefix = preset.provider === 'custom' ? '自定义 · ' : ''
  return prefix + modelName(preset)
}
/** 说明：服务商 · 模型（起了名字时）· Fast。思考强度不算预设的一部分（在输入栏里选），不写在这里。 */
export function presetDetail(preset: Preset) {
  return [providerName(preset.provider), preset.name ? modelName(preset) : '', preset.fast && supportsFast(preset.provider) ? 'Fast' : ''].filter(Boolean).join(' · ')
}
