import type { Cue } from '../../types'

// 解析 HH:MM:SS.mmm 為秒。失敗回 NaN。
function parseTime(s: string): number {
  const m = s.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/)
  if (!m) return NaN
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000
}

// 從 <p> 抽文字：text node 直收、<br/> 轉 \n、其他子元素遞迴文字內容。
function pToText(p: Element): string {
  let out = ''
  for (const child of Array.from(p.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) out += child.textContent ?? ''
    else if ((child as Element).tagName?.toLowerCase() === 'br') out += '\n'
    else out += (child as Element).textContent ?? ''
  }
  return out.trim()
}

// 解析 Netflix imsc1.1/TTML XML，回 Cue[]。XML 失敗、無 <p>、無有效時間皆回 []。
export function parseImsc(xml: string): Cue[] {
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml')
  } catch {
    console.warn('[submersive] imsc parse threw')
    return []
  }
  if (doc.querySelector('parsererror')) {
    console.warn('[submersive] imsc parsererror')
    return []
  }
  const cues: Cue[] = []
  doc.querySelectorAll('p').forEach((p) => {
    const begin = p.getAttribute('begin')
    const end = p.getAttribute('end')
    if (!begin || !end) return
    const start = parseTime(begin)
    const eEnd = parseTime(end)
    if (Number.isNaN(start) || Number.isNaN(eEnd) || eEnd <= start) {
      console.warn('[submersive] imsc cue invalid time, skipped', begin, end)
      return
    }
    const text = pToText(p)
    if (!text) return
    cues.push({ start, dur: eEnd - start, text })
  })
  return cues
}
