import type { Cue } from '../types'

interface Json3Seg { utf8?: string }
interface Json3Event { tStartMs?: number; dDurationMs?: number; segs?: Json3Seg[] }

export function parseJson3(raw: string): Cue[] {
  let data: { events?: Json3Event[] }
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  const events = data.events ?? []
  const cues: Cue[] = []
  for (const ev of events) {
    if (!ev.segs || ev.tStartMs == null || ev.dDurationMs == null) continue
    const text = ev.segs.map((s) => s.utf8 ?? '').join('').trim()
    if (!text) continue
    cues.push({ start: ev.tStartMs / 1000, dur: ev.dDurationMs / 1000, text })
  }
  return cues
}
