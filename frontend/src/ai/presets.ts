/** 模型预设在界面上的显示：标题、说明、可选模型列表。数据结构与保存见 settings.mjs。 */
import { getProvider } from './providers.mjs'
import { nativeModelInventory } from './native-models.ts'
import { supportsFast } from './settings.mjs'

export type Preset = { id: string; name: string; provider: string; baseUrl: string; protocol: string; model: string; effort: string; fast: boolean }
export type PresetModel = { id: string; name?: string; efforts?: string[]; defaultEffort?: string; vision?: boolean }

export const EFFORT_NAMES: Record<string, string> = { '': '模型默认', none: '不思考', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高', ultra: '极致' }

/** 这个服务商可选的模型：Codex 用本机读到的列表，其他用内置列表。 */
export function presetModels(provider: string): PresetModel[] {
  return provider === 'codex' ? nativeModelInventory.value : (getProvider(provider) as any)?.models || []
}
export function providerName(provider: string) { return (getProvider(provider) as any)?.name || provider }
export function modelName(preset: Pick<Preset, 'provider' | 'model'>) {
  const found = presetModels(preset.provider).find(item => item.id === preset.model)
  return found?.name || preset.model || (preset.provider === 'codex' ? '模型默认' : '未选模型')
}
/** 标题：起了名字用名字；没起名字用模型名（Codex 与自定义接口前面加上来源，免得和 API 的同名模型混淆）。 */
export function presetTitle(preset: Preset) {
  if (preset.name) return preset.name
  const prefix = preset.provider === 'codex' ? 'Codex · ' : preset.provider === 'custom' ? '自定义 · ' : ''
  return prefix + modelName(preset)
}
/** 说明：服务商 · 模型（起了名字时）· Fast。思考强度不算预设的一部分（在输入栏里选），不写在这里。 */
export function presetDetail(preset: Preset) {
  return [providerName(preset.provider), preset.name ? modelName(preset) : '', preset.fast && supportsFast(preset.provider) ? 'Fast' : ''].filter(Boolean).join(' · ')
}
