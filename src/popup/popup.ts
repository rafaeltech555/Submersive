import { loadSettings, saveSettings } from '../core/settings-store'

const cb = document.getElementById('showOriginal') as HTMLInputElement
loadSettings().then((s) => { cb.checked = s.showOriginal })
cb.addEventListener('change', () => saveSettings({ showOriginal: cb.checked }))
document.getElementById('open')!.addEventListener('click', () => chrome.runtime.openOptionsPage())
