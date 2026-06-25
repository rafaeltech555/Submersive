import { YouTubeAdapter } from '../sites/youtube-adapter'
import { Overlay } from './overlay'
import { Notice } from './notice'
import { ToggleButton } from './toggle-button'
import { loadSettings } from '../core/settings-store'
import { loadEnabled, saveEnabled } from '../core/toggle-store'
import { friendlyTranslateError } from '../core/translate-error'
import type { Cue, VideoContext } from '../types'

const NO_CUES_TIMEOUT_MS = 5000

;(async () => {
  const settings = await loadSettings()
  let enabled = await loadEnabled()
  const site = new YouTubeAdapter()
  const anchor = () => document.querySelector('#movie_player') as HTMLElement | null
  const overlay = new Overlay(() => site.getPlayerTime(), anchor)
  overlay.applySettings(settings)
  const notice = new Notice(anchor)

  let gotCues = false
  let timer: number | undefined
  let poll: number | undefined
  let pollTimeout: number | undefined
  let watchedVideo: HTMLVideoElement | null = null
  let currentVideoId: string | null = null
  let lastCues: Cue[] | null = null
  let lastCtx: VideoContext | null = null

  const clearTimer = () => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined }
  }
  const clearPoll = () => {
    if (poll !== undefined) { clearInterval(poll); poll = undefined }
    if (pollTimeout !== undefined) { clearTimeout(pollTimeout); pollTimeout = undefined }
  }

  const armNoCuesTimer = () => {
    if (timer !== undefined || gotCues || !enabled) return
    timer = window.setTimeout(() => {
      timer = undefined
      if (!gotCues && enabled) notice.show('請開啟 CC 字幕以啟用雙語翻譯')
    }, NO_CUES_TIMEOUT_MS)
  }

  // 翻譯整軌並顯示雙語；OFF 或已換片時放棄。
  const translateAndShow = async (cues: Cue[], ctx: VideoContext) => {
    const expectedId = ctx.videoId
    const res = (await chrome.runtime.sendMessage({
      type: 'TRANSLATE', videoId: ctx.videoId, srcLang: ctx.srcLang,
      targetLang: settings.targetLang, engine: settings.engine, cues,
    })) as { type: string; cues?: Cue[]; error?: string }
    if (currentVideoId !== expectedId || !enabled) return
    if (res?.type === 'TRANSLATE_RESULT' && res.cues) {
      overlay.setCues(res.cues)
      overlay.setBilingual(true)
    } else {
      console.warn('[submersive] translate failed', res?.error)
      notice.show(friendlyTranslateError(res?.error), { autoHideMs: 6000 })
    }
  }

  // 套用開關狀態到目前畫面。
  const applyEnabled = (on: boolean) => {
    enabled = on
    if (on) {
      if (lastCues && lastCtx) translateAndShow(lastCues, lastCtx)
    } else {
      overlay.setBilingual(false)
    }
  }

  const toggle = new ToggleButton(anchor, (on) => { applyEnabled(on); saveEnabled(on) }, enabled)

  // 其他分頁改了開關 → 同步本頁。
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.immersiveEnabled) return
    const on = changes.immersiveEnabled.newValue ?? true
    toggle.setState(on)
    applyEnabled(on)
  })

  const attachPlayingListener = (): boolean => {
    const v = site.getVideoElement()
    if (!v) return false
    toggle.mount()
    if (watchedVideo !== v) {
      if (watchedVideo) watchedVideo.removeEventListener('playing', armNoCuesTimer)
      v.addEventListener('playing', armNoCuesTimer)
      watchedVideo = v
    }
    if (!v.paused) armNoCuesTimer()
    return true
  }

  const startWatching = () => {
    clearPoll()
    if (attachPlayingListener()) return
    poll = window.setInterval(() => {
      if (attachPlayingListener()) clearPoll()
    }, 500)
    pollTimeout = window.setTimeout(() => clearPoll(), 30000)
  }

  const onVideoMaybeChanged = () => {
    const id = site.detectVideo()?.videoId ?? null
    if (id === currentVideoId) return
    currentVideoId = id
    gotCues = false
    lastCues = null
    lastCtx = null
    clearTimer()
    clearPoll()
    notice.hide()
    overlay.setBilingual(false)
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
    lastCues = cues
    lastCtx = ctx
    if (enabled) await translateAndShow(cues, ctx)
  })

  console.log('[submersive] content ready')
})()
