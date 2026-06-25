import { NATIVE_TEXT } from './dom'

// 只讀 Netflix 原生字幕容器（.player-timedtext-text-container），
// 刻意排除我們注入的譯文節點，避免回授。多容器以換行接。
export function extractLineText(root: Element | null): string {
  if (!root) return ''
  const parts: string[] = []
  root.querySelectorAll(NATIVE_TEXT).forEach((el) => {
    const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (t) parts.push(t)
  })
  return parts.join('\n')
}

const POLL_MS = 300

// 監看字幕容器，當前原文行變更時回呼（空字串代表清空）。
// 用輕量輪詢、每次重新查當前 .player-timedtext，而非綁死單一節點——
// Netflix 會在換行/seek/開關字幕時重建容器，綁死舊節點會收不到新字幕。
// 注入譯文不會回授：extractLineText 排除注入節點 + last 去重。
export class SubtitleObserver {
  private timer: number | undefined
  private last = ''

  constructor(
    private getContainer: () => Element | null,
    private onLine: (text: string) => void,
  ) {}

  start(): boolean {
    this.stop()
    this.timer = window.setInterval(() => this.check(), POLL_MS)
    this.check()
    return true
  }

  private check() {
    const text = extractLineText(this.getContainer())
    if (text === this.last) return
    this.last = text
    this.onLine(text)
  }

  stop() {
    if (this.timer !== undefined) { clearInterval(this.timer); this.timer = undefined }
    this.last = ''
  }
}
