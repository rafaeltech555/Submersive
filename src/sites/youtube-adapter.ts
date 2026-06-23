import type { SiteAdapter } from './site-adapter'
import type { Cue, VideoContext } from '../types'
import { parseJson3 } from '../core/timedtext-parser'

export class YouTubeAdapter implements SiteAdapter {
  private listeners: ((cues: Cue[], ctx: VideoContext) => void)[] = []

  constructor() {
    // hook 由 manifest 以 world:'MAIN' content script 自動注入，這裡只接收其廣播
    window.addEventListener('message', (ev) => {
      const d = ev.data
      if (ev.source !== window || !d || d.source !== 'submersive-hook' || d.kind !== 'timedtext') return
      const ctx = this.detectVideo()
      if (!ctx) { console.warn('[submersive] 收到字幕但偵測不到 videoId，略過'); return }
      const cues = parseJson3(d.raw)
      if (cues.length) this.listeners.forEach((cb) => cb(cues, ctx))
    })
  }

  detectVideo(): VideoContext | null {
    const id = new URLSearchParams(location.search).get('v')
    return id ? { videoId: id, srcLang: null } : null
  }

  onSubtitleTrack(cb: (cues: Cue[], ctx: VideoContext) => void): void {
    this.listeners.push(cb)
  }

  getVideoElement(): HTMLVideoElement | null {
    return document.querySelector('video.html5-main-video')
  }

  getPlayerTime(): number {
    return this.getVideoElement()?.currentTime ?? 0
  }
}
