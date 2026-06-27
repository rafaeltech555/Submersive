import { NetflixAdapter } from '../sites/netflix-adapter'
import { TranslationScheduler } from './translation-scheduler'
import { Overlay } from './overlay'
import { Notice } from './notice'
import { ToggleButton } from './toggle-button'
import { loadSettings } from '../core/settings-store'
import { loadMode, saveMode, type ImmersiveMode } from '../core/toggle-store'
import { friendlyTranslateError } from '../core/translate-error'
import { hideNativeCc, showNativeCc } from '../sites/netflix/native-cc'
import { getPlayerRoot, getVideoElement, getVideoId } from '../sites/netflix/player'
import type { Cue, VideoContext } from '../types'

const NO_CUES_TIMEOUT_MS = 5000

;(async () => {
  const settings = await loadSettings()
  let mode = await loadMode()
  const site = new NetflixAdapter()
  const anchor = getPlayerRoot
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

  const scheduler = new TranslationScheduler({
    getTime: () => site.getPlayerTime(),
    translate: async (texts) => {
      const res = (await chrome.runtime.sendMessage({
        type: 'TRANSLATE_BATCH', texts,
        srcLang: lastCtx?.srcLang ?? null,
        targetLang: settings.targetLang, engine: settings.engine,
      })) as { type: string; translated?: string[]; error?: string }
      if (res?.type === 'TRANSLATE_BATCH_RESULT' && res.translated) return res.translated
      throw new Error(res?.error ?? 'TRANSLATE_BATCH no response')
    },
    notify: (msg) => { if (msg == null) notice.hide(); else notice.show(friendlyTranslateError(msg)) },
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (id) => clearTimeout(id),
  })

  const clearTimer = () => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined }
  }
  const clearPoll = () => {
    if (poll !== undefined) { clearInterval(poll); poll = undefined }
    if (pollTimeout !== undefined) { clearTimeout(pollTimeout); pollTimeout = undefined }
  }

  const armNoCuesTimer = () => {
    if (timer !== undefined || gotCues || mode === 'off') return
    timer = window.setTimeout(() => {
      timer = undefined
      if (!gotCues && mode !== 'off') notice.show('請開啟字幕以啟用沉浸字幕')
    }, NO_CUES_TIMEOUT_MS)
  }

  // 套用 mode 到目前畫面 + 控制原生 CC 顯示 + 啟停 scheduler。
  const applyMode = (m: ImmersiveMode) => {
    mode = m
    if (m === 'off') { scheduler.stop(); overlay.unmount(); showNativeCc(); return }
    hideNativeCc()
    overlay.setOriginalOnly(m === 'original')
    overlay.setBilingual(m === 'bilingual')
    if (lastCues) overlay.setCues(lastCues)
    overlay.mount()
    if (m === 'bilingual') scheduler.start()
    else scheduler.stop()
  }

  // 啟動時就依目前 mode 決定原生 CC 狀態。
  if (mode !== 'off') hideNativeCc()

  const toggle = new ToggleButton(anchor, (m) => { applyMode(m); saveMode(m) }, mode)

  // 其他分頁改了 mode → 同步本頁。
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.immersiveMode) return
    const m = (changes.immersiveMode.newValue ?? 'bilingual') as ImmersiveMode
    toggle.setMode(m)
    applyMode(m)
  })

  const attachPlayingListener = (): boolean => {
    const v = getVideoElement()
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
    const id = getVideoId()
    if (id === currentVideoId) return
    currentVideoId = id
    gotCues = false
    lastCues = null
    lastCtx = null
    clearTimer()
    clearPoll()
    notice.hide()
    scheduler.stop()
    overlay.setBilingual(false)
    if (id) startWatching()
  }

  onVideoMaybeChanged()
  window.setInterval(onVideoMaybeChanged, 1000)

  site.onSubtitleTrack((cues, ctx) => {
    gotCues = true
    clearTimer()
    notice.hide()
    lastCues = cues
    lastCtx = ctx
    if (mode === 'off') return
    overlay.setCues(cues)
    overlay.setOriginalOnly(mode === 'original')
    overlay.setBilingual(mode === 'bilingual')
    scheduler.setCues(cues)
    overlay.mount()
    if (mode === 'bilingual') scheduler.start()
  })

  console.log('[submersive] netflix content ready')
})()
