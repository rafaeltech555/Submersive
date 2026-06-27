import type { SiteAdapter } from './site-adapter'
import type { Cue, VideoContext } from '../types'
import { parseImsc } from './netflix/imsc-parser'

export class NetflixAdapter implements SiteAdapter {
  private listeners: ((cues: Cue[], ctx: VideoContext) => void)[] = []

  constructor() {
    // hook 由 manifest 以 world:'MAIN' content script 自動注入，這裡只接收其廣播。
    window.addEventListener('message', (ev) => {
      const d = ev.data
      // ev.source === null in jsdom; === window in real browsers (same-page postMessage)
      if ((ev.source !== null && ev.source !== window) || !d || d.source !== 'submersive-hook' || d.kind !== 'netflix-imsc') return
      const ctx = this.detectVideo()
      if (!ctx) { console.warn('[submersive] netflix 收到字幕但偵測不到 videoId，略過'); return }
      const cues = parseImsc(d.raw)
      if (cues.length) this.listeners.forEach((cb) => cb(cues, ctx))
    })
    // 若 hook 在 adapter 啟動前已廣播過 TTML（prefetch race），請求重播最後一筆
    window.postMessage({ source: 'submersive-hook-request', kind: 'netflix-replay' }, '*')
  }

  detectVideo(): VideoContext | null {
    const m = location.pathname.match(/\/watch\/(\d+)/)
    return m ? { videoId: m[1], srcLang: null } : null
  }

  onSubtitleTrack(cb: (cues: Cue[], ctx: VideoContext) => void): void {
    this.listeners.push(cb)
  }

  getVideoElement(): HTMLVideoElement | null {
    return document.querySelector('video')
  }

  getPlayerTime(): number {
    return this.getVideoElement()?.currentTime ?? 0
  }
}
