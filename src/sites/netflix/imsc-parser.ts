import type { Cue } from '../../types'

// 解析 TTML 時間表達式為秒。支援：
//   clock-time: HH:MM:SS 或 HH:MM:SS.fraction（既有格式）
//   offset-time: <number><metric>，metric ∈ h|ms|m|s|f|t
//     t（ticks）→ number / tickRate；ms → /1000；s → 直接；m → *60；h → *3600
//     f（frames）→ NaN（不處理 frameRate，Netflix 用 ticks）
// 其他格式回 NaN。
function parseTime(s: string, tickRate: number): number {
  // clock-time: HH:MM:SS 或 HH:MM:SS.fraction
  const clock = s.match(/^(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/)
  if (clock) {
    const frac = clock[4] ? +clock[4] / Math.pow(10, clock[4].length) : 0
    return +clock[1] * 3600 + +clock[2] * 60 + +clock[3] + frac
  }
  // offset-time: <number><metric>（ms 放在 m/s 前面，避免錯誤匹配）
  const offset = s.match(/^(\d+(?:\.\d+)?)(h|ms|m|s|f|t)$/)
  if (offset) {
    const num = +offset[1]
    const metric = offset[2]
    switch (metric) {
      case 't':  return num / tickRate
      case 'ms': return num / 1000
      case 's':  return num
      case 'm':  return num * 60
      case 'h':  return num * 3600
      case 'f':  return NaN  // 不處理 frame rate
    }
  }
  return NaN
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

  // 讀 ttp:tickRate：掃 documentElement.attributes 找 localName === 'tickRate'
  // 前綴可能不固定（ttp: 或 ttp2: 等），用 localName 比對最穩。
  // TTML spec 預設值為 1。
  let tickRate = 1
  const attrs = doc.documentElement.attributes
  for (let i = 0; i < attrs.length; i++) {
    if (attrs[i].localName === 'tickRate') {
      const parsed = Number(attrs[i].value)
      if (Number.isFinite(parsed) && parsed > 0) tickRate = parsed
      break
    }
  }

  const cues: Cue[] = []
  doc.querySelectorAll('p').forEach((p) => {
    const begin = p.getAttribute('begin')
    const end = p.getAttribute('end')
    if (!begin || !end) return
    const start = parseTime(begin, tickRate)
    const eEnd = parseTime(end, tickRate)
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
