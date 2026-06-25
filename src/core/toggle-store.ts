// 沉浸翻譯開關狀態，存 chrome.storage.local，預設 ON。
export async function loadEnabled(): Promise<boolean> {
  const { immersiveEnabled } = await chrome.storage.local.get(['immersiveEnabled'])
  return immersiveEnabled ?? true
}

export async function saveEnabled(on: boolean): Promise<void> {
  await chrome.storage.local.set({ immersiveEnabled: on })
}
