export type ImmersiveMode = 'bilingual' | 'original' | 'off'

const MODES: ImmersiveMode[] = ['bilingual', 'original', 'off']

// 沉浸翻譯模式，存 chrome.storage.local，預設 bilingual。
export async function loadMode(): Promise<ImmersiveMode> {
  const { immersiveMode } = await chrome.storage.local.get(['immersiveMode'])
  return MODES.includes(immersiveMode as ImmersiveMode) ? (immersiveMode as ImmersiveMode) : 'bilingual'
}

export async function saveMode(mode: ImmersiveMode): Promise<void> {
  await chrome.storage.local.set({ immersiveMode: mode })
}
