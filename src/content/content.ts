import { YouTubeAdapter } from '../sites/youtube-adapter'
import { Overlay } from './overlay'
import { loadSettings } from '../core/settings-store'
import type { Cue } from '../types'

;(async () => {
  const settings = await loadSettings()
  const site = new YouTubeAdapter()
  const overlay = new Overlay(
    () => site.getPlayerTime(),
    () => document.querySelector('#movie_player') as HTMLElement | null,
  )
  overlay.applySettings(settings)

  site.onSubtitleTrack(async (cues, ctx) => {
    overlay.setCues(cues)
    overlay.mount()
    const res = (await chrome.runtime.sendMessage({
      type: 'TRANSLATE', videoId: ctx.videoId, srcLang: ctx.srcLang,
      targetLang: settings.targetLang, engine: settings.engine, cues,
    })) as { type: string; cues?: Cue[]; error?: string }
    if (res?.type === 'TRANSLATE_RESULT' && res.cues) {
      overlay.setCues(res.cues)
      overlay.setBilingual(true)
    } else {
      console.warn('[dualsub] translate failed', res?.error)
    }
  })

  console.log('[dualsub] content ready')
})()
