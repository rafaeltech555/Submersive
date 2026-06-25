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
