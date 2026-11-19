import { computed, ref, shallowRef } from 'vue'
import { library } from '../sdk'
import { SETTINGS_KEY, defaultPreferences, normalizePreferences, preferenceErrors, type AppPreferences, type AppearancePreferences } from './model'
export * from './model'
export * from './background'
export * from './quick-prompts'

// 设置读出来之前先按液态玻璃画（以前的默认），老用户启动时不会先闪一下暖色极简。
const preferences = ref<AppPreferences>(normalizePreferences(undefined))
const loaded = ref(false)
const appearancePreview = shallowRef<AppearancePreferences | null>(null)
export const effectiveAppearance = computed(() => appearancePreview.value ?? preferences.value.appearance)
export function previewAppearance(value: AppearancePreferences | null): void {
  appearancePreview.value = value ? { ...value, background: value.background ? { ...value.background } : null } : null
}
let pendingLoad: Promise<AppPreferences> | null = null
export async function loadSettings(): Promise<AppPreferences> {
  if (loaded.value) return preferences.value
  if (pendingLoad) return pendingLoad
  pendingLoad = (async () => {
    const stored = await library.getSetting(SETTINGS_KEY)
    let parsed: unknown
    try { parsed = stored ? JSON.parse(stored) : undefined } catch { parsed = undefined }
    const legacyTheme = stored ? null : await library.getSetting('appearance.theme')
    preferences.value = stored ? normalizePreferences(parsed) : await firstRunPreferences(legacyTheme)
    loaded.value = true
    return preferences.value
  })()
  try { return await pendingLoad } finally { pendingLoad = null }
}
/**
 * 从没存过设置：文档库也是空的，就是第一次安装，用默认外观（暖色极简）；库里已有书，说明是从没改过设置的老用户，
 * 沿用以前默认的液态玻璃。判断完立刻存下，之后往库里加书也不会再变。
 */
async function firstRunPreferences(legacyTheme: string | null): Promise<AppPreferences> {
  if (legacyTheme) return normalizePreferences(undefined, legacyTheme)
  let fresh: boolean
  try { fresh = !(await library.list('')).length } catch { return normalizePreferences(undefined) }
  const value = fresh ? defaultPreferences() : normalizePreferences(undefined)
  try { await library.setSetting(SETTINGS_KEY, JSON.stringify(value)) } catch { /* 存不下就下次启动再判断 */ }
  return value
}
export async function saveSettings(value: AppPreferences): Promise<AppPreferences> {
  const errors = preferenceErrors(value)
  if (errors.length) throw new Error(errors.join('\n'))
  const next = normalizePreferences(value)
  await library.setSetting(SETTINGS_KEY, JSON.stringify(next))
  preferences.value = next; loaded.value = true
  return next
}
export function useSettings() { return { preferences, loaded, effectiveAppearance, previewAppearance, load: loadSettings, save: saveSettings } }
