import { loadSettings } from '../core/settings-store'
import { loadMode, saveMode, type ImmersiveMode } from '../core/toggle-store'
import { Notice } from './notice'
import { ToggleButton } from './toggle-button'
import { friendlyTranslateError } from '../core/translate-error'
import { getVideoId, getContainer, getVideoElement, getPlayerRoot } from '../sites/netflix/player'
import { SubtitleObserver } from '../sites/netflix/subtitle-observer'
import { Injector } from '../sites/netflix/injector'

const NO_SUBTITLE_TIMEOUT_MS = 5000

;(async () => {
  const settings = await loadSettings()
  let mode = await loadMode()
  const notice = new Notice(getPlayerRoot)
  const injector = new Injector(getContainer)
  const observer = new SubtitleObserver(getContainer, onLine)

  let currentVideoId: string | null = null
  let currentLine = ''
  let gotLine = false
  let noSubTimer: number | undefined
  let poll: number | undefined
  let pollTimeout: number | undefined
  let watchedVideo: HTMLVideoElement | null = null
  let lastErrorMsg = ''
  let lastErrorAt = 0

  // 套用 mode：非 bilingual（原文/關閉）就清掉注入的譯文。onCycle / onChanged 共用。
  const applyMode = (m: ImmersiveMode) => {
    mode = m
    if (m !== 'bilingual') injector.clear()
  }

  const toggle = new ToggleButton(getPlayerRoot, (m) => { applyMode(m); saveMode(m) }, mode)

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.immersiveMode) return
    const m = (changes.immersiveMode.newValue ?? 'bilingual') as ImmersiveMode
    applyMode(m)
    toggle.setMode(m)
  })

  const clearNoSubTimer = () => {
    if (noSubTimer !== undefined) { clearTimeout(noSubTimer); noSubTimer = undefined }
  }
  const clearPoll = () => {
    if (poll !== undefined) { clearInterval(poll); poll = undefined }
    if (pollTimeout !== undefined) { clearTimeout(pollTimeout); pollTimeout = undefined }
  }

  const armNoSubTimer = () => {
    if (noSubTimer !== undefined || gotLine || mode !== 'bilingual') return
    noSubTimer = window.setTimeout(() => {
      noSubTimer = undefined
      if (!gotLine && mode === 'bilingual') notice.show('請開啟字幕以啟用雙語翻譯')
    }, NO_SUBTITLE_TIMEOUT_MS)
  }

  async function onLine(text: string) {
    currentLine = text
    if (text === '') { injector.clear(); return }
    gotLine = true
    clearNoSubTimer()
    notice.hide()
    if (mode !== 'bilingual') { injector.clear(); return }

    const expectedLine = text
    const expectedVid = currentVideoId
    let res: { type: string; translated?: string; error?: string }
    try {
      res = (await chrome.runtime.sendMessage({
        type: 'TRANSLATE_LINE', text, srcLang: null,
        targetLang: settings.targetLang, engine: settings.engine,
      })) as { type: string; translated?: string; error?: string }
    } catch {
      return // background 不可用時靜默略過該行
    }

    // 換行/換片/中途切離 bilingual 就丟棄
    if (currentLine !== expectedLine || currentVideoId !== expectedVid || mode !== 'bilingual') return

    if (res?.type === 'TRANSLATE_LINE_RESULT' && res.translated != null) {
      injector.setTranslation(res.translated)
    } else {
      console.warn('[submersive] netflix translate failed', res?.error)
      const msg = friendlyTranslateError(res?.error)
      const now = Date.now()
      if (msg !== lastErrorMsg || now - lastErrorAt > 6000) {
        lastErrorMsg = msg
        lastErrorAt = now
        notice.show(msg, { autoHideMs: 6000 })
      }
    }
  }

  const attachPlayingListener = (): boolean => {
    const v = getVideoElement()
    if (!v) return false
    toggle.mount()
    if (watchedVideo !== v) {
      if (watchedVideo) watchedVideo.removeEventListener('playing', armNoSubTimer)
      v.addEventListener('playing', armNoSubTimer)
      watchedVideo = v
    }
    if (!v.paused) armNoSubTimer()
    return true
  }

  const startWatching = () => {
    clearPoll()
    observer.start()
    if (attachPlayingListener()) return
    poll = window.setInterval(() => { if (attachPlayingListener()) clearPoll() }, 500)
    pollTimeout = window.setTimeout(() => clearPoll(), 30000)
  }

  const onVideoMaybeChanged = () => {
    const id = getVideoId()
    if (id === currentVideoId) return
    currentVideoId = id
    observer.stop()
    injector.clear()
    gotLine = false
    currentLine = ''
    clearNoSubTimer()
    clearPoll()
    notice.hide()
    if (watchedVideo) {
      watchedVideo.removeEventListener('playing', armNoSubTimer)
      watchedVideo = null
    }
    if (id) startWatching()
  }

  onVideoMaybeChanged()
  window.setInterval(onVideoMaybeChanged, 1000)

  console.log('[submersive] netflix content ready')
})()
