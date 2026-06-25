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

// 監看字幕容器，當前原文行變更時回呼（空字串代表清空）。
// 注入譯文造成的 mutation 因 extractLineText 排除注入節點 + last 去重，不會回授。
export class SubtitleObserver {
  private mo: MutationObserver | null = null
  private last = ''

  constructor(
    private getContainer: () => Element | null,
    private onLine: (text: string) => void,
  ) {}

  start(): boolean {
    this.mo?.disconnect()
    const container = this.getContainer()
    if (!container) return false
    this.mo = new MutationObserver(() => this.check(container))
    this.mo.observe(container, { childList: true, subtree: true, characterData: true })
    this.check(container)
    return true
  }

  private check(container: Element) {
    const text = extractLineText(container)
    if (text === this.last) return
    this.last = text
    this.onLine(text)
  }

  stop() {
    this.mo?.disconnect()
    this.mo = null
    this.last = ''
  }
}
