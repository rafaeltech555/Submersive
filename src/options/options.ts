import { loadSettings, saveSettings } from '../core/settings-store'

const $ = (id: string) => document.getElementById(id) as HTMLInputElement & HTMLSelectElement

async function init() {
  const s = await loadSettings()
  $('targetLang').value = s.targetLang
  $('showOriginal').checked = s.showOriginal
  $('engine').value = s.engine
  $('originalFirst').checked = s.originalFirst
  $('fontScale').value = String(s.fontScale)
  $('verticalPos').value = String(s.verticalPos)
  $('bgOpacity').value = String(s.bgOpacity)
  const { deeplKey, localUrl } = await chrome.storage.local.get(['deeplKey', 'localUrl'])
  $('deeplKey').value = deeplKey ?? ''
  $('localUrl').value = localUrl ?? 'http://localhost:5000'
}

$('save').addEventListener('click', async () => {
  await saveSettings({
    targetLang: $('targetLang').value,
    showOriginal: $('showOriginal').checked,
    engine: $('engine').value as 'deepl' | 'local',
    originalFirst: $('originalFirst').checked,
    fontScale: parseFloat($('fontScale').value),
    verticalPos: parseFloat($('verticalPos').value),
    bgOpacity: parseFloat($('bgOpacity').value),
  })
  await chrome.storage.local.set({ deeplKey: $('deeplKey').value, localUrl: $('localUrl').value })
  document.getElementById('status')!.textContent = '已儲存'
})

init()
