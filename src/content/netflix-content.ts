import { loadSettings } from '../core/settings-store'
import { Notice } from './notice'
import { friendlyTranslateError } from '../core/translate-error'
import { getVideoId, getContainer, getVideoElement, getPlayerRoot } from '../sites/netflix/player'
import { SubtitleObserver } from '../sites/netflix/subtitle-observer'
import { Injector } from '../sites/netflix/injector'

const NO_SUBTITLE_TIMEOUT_MS = 5000

;(async () => {
  const settings = await loadSettings()
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

  const clearNoSubTimer = () => {
    if (noSubTimer !== undefined) { clearTimeout(noSubTimer); noSubTimer = undefined }
  }
  const clearPoll = () => {
    if (poll !== undefined) { clearInterval(poll); poll = undefined }
    if (pollTimeout !== undefined) { clearTimeout(pollTimeout); pollTimeout = undefined }
  }

  const armNoSubTimer = () => {
    if (noSubTimer !== undefined || gotLine) return
    noSubTimer = window.setTimeout(() => {
      noSubTimer = undefined
      if (!gotLine) notice.show('請開啟字幕以啟用雙語翻譯')
    }, NO_SUBTITLE_TIMEOUT_MS)
  }

  async function onLine(text: string) {
    currentLine = text
    if (text === '') { injector.clear(); return }
    gotLine = true
    clearNoSubTimer()
    notice.hide()

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

    // 換行或換片就丟棄（避免舊行譯文蓋到新行/新片）
    if (currentLine !== expectedLine || currentVideoId !== expectedVid) return

    if (res?.type === 'TRANSLATE_LINE_RESULT' && res.translated != null) {
      injector.setTranslation(res.translated)
    } else {
      console.warn('[submersive] netflix translate failed', res?.error)
      // 防洪：同訊息 6s 內不重彈
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
    if (watchedVideo !== v) {
      if (watchedVideo) watchedVideo.removeEventListener('playing', armNoSubTimer)
      v.addEventListener('playing', armNoSubTimer)
      watchedVideo = v
    }
    if (!v.paused) armNoSubTimer()
    return true
  }

  // observer 自帶輪詢、每次重查當前容器，故無條件 start（容器晚到也沒關係）。
  // 這裡的 poll 只負責把 'playing' 監聽掛到 video（無字幕提示用），直到 video 出現（最多 ~30s）。
  const startWatching = () => {
    clearPoll()
    observer.start()
    if (attachPlayingListener()) return
    poll = window.setInterval(() => { if (attachPlayingListener()) clearPoll() }, 500)
    pollTimeout = window.setTimeout(() => clearPoll(), 30000)
  }

  // 初始 + SPA 換片：Netflix 無 yt-navigate-finish，靠 videoId 輪詢比對。
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
