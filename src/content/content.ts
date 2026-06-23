import { YouTubeAdapter } from '../sites/youtube-adapter'
import { Overlay } from './overlay'

const site = new YouTubeAdapter()
const overlay = new Overlay(
  () => site.getPlayerTime(),
  () => document.querySelector('#movie_player') as HTMLElement | null,
)

site.onSubtitleTrack(async (cues, ctx) => {
  overlay.setCues(cues)   // 先顯示原文
  overlay.mount()
  const res = (await chrome.runtime.sendMessage({
    type: 'TRANSLATE', videoId: ctx.videoId, srcLang: ctx.srcLang,
    targetLang: 'zh-TW', engine: 'deepl', cues,
  })) as { type: string; cues?: any; error?: string }
  if (res?.type === 'TRANSLATE_RESULT') {
    overlay.setCues(res.cues)
    overlay.setBilingual(true)
  } else {
    console.warn('[dualsub] translate failed', res?.error)
  }
})

console.log('[dualsub] content ready')
