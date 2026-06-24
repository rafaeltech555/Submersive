import { YouTubeAdapter } from '../sites/youtube-adapter'
import { Overlay } from './overlay'
import { Notice } from './notice'
import { loadSettings } from '../core/settings-store'
import { friendlyTranslateError } from '../core/translate-error'
import type { Cue } from '../types'

const NO_CUES_TIMEOUT_MS = 5000

;(async () => {
  const settings = await loadSettings()
  const site = new YouTubeAdapter()
  const anchor = () => document.querySelector('#movie_player') as HTMLElement | null
  const overlay = new Overlay(() => site.getPlayerTime(), anchor)
  overlay.applySettings(settings)
  const notice = new Notice(anchor)

  let gotCues = false
  let timer: number | undefined
  let currentVideoId: string | null = null

  const clearTimer = () => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined }
  }

  const armNoCuesTimer = () => {
    if (timer !== undefined || gotCues) return
    timer = window.setTimeout(() => {
      timer = undefined
      if (!gotCues) notice.show('請開啟 CC 字幕以啟用雙語翻譯')
    }, NO_CUES_TIMEOUT_MS)
  }

  // video 元素在 document_start 時可能尚未存在；附上 playing 監聽，已在播放則直接 arm。
  const attachPlayingListener = (): boolean => {
    const v = site.getVideoElement()
    if (!v) return false
    v.addEventListener('playing', armNoCuesTimer) // 同一函式 ref，瀏覽器自動去重
    if (!v.paused) armNoCuesTimer()
    return true
  }

  // 反覆嘗試直到 video 出現（最多 ~30s）。
  const startWatching = () => {
    if (attachPlayingListener()) return
    const poll = window.setInterval(() => {
      if (attachPlayingListener()) clearInterval(poll)
    }, 500)
    window.setTimeout(() => clearInterval(poll), 30000)
  }

  // 初始 + SPA 換片：videoId 變才重置。
  const onVideoMaybeChanged = () => {
    const id = site.detectVideo()?.videoId ?? null
    if (id === currentVideoId) return
    currentVideoId = id
    gotCues = false
    clearTimer()
    notice.hide()
    if (id) startWatching()
  }

  onVideoMaybeChanged()
  document.addEventListener('yt-navigate-finish', onVideoMaybeChanged)

  site.onSubtitleTrack(async (cues, ctx) => {
    gotCues = true
    clearTimer()
    notice.hide()

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
      console.warn('[submersive] translate failed', res?.error)
      notice.show(friendlyTranslateError(res?.error), { autoHideMs: 6000 })
    }
  })

  console.log('[submersive] content ready')
})()
