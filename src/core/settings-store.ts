import { DEFAULT_SETTINGS, type Settings } from '../types'

export function mergeSettings(partial: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...partial }
}

export async function loadSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings')
  return mergeSettings(settings ?? {})
}

export async function saveSettings(s: Partial<Settings>): Promise<void> {
  const merged = mergeSettings({ ...(await loadSettings()), ...s })
  await chrome.storage.local.set({ settings: merged })
}
