import { computed, ref, shallowRef } from 'vue'
import { library } from '../sdk'
import { SETTINGS_KEY, defaultPreferences, normalizePreferences, preferenceErrors, type AppPreferences, type AppearancePreferences } from './model'
export * from './model'
export * from './background'
export * from './quick-prompts'

// Error fallback only; the desktop entry resolves persisted settings before mounting the shell.
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
    const { stored, legacyTheme, fresh } = await library.getStartupSettings()
    let parsed: unknown
    try { parsed = stored ? JSON.parse(stored) : undefined } catch { parsed = undefined }
    preferences.value = fresh ? defaultPreferences() : normalizePreferences(parsed, legacyTheme)
    if (!stored && !legacyTheme) {
      try { await library.setSetting(SETTINGS_KEY, JSON.stringify(preferences.value)) } catch { /* retry next launch */ }
    }
    loaded.value = true
    return preferences.value
  })()
  try { return await pendingLoad } finally { pendingLoad = null }
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
