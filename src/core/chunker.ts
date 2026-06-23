import type { Cue } from '../types'

export interface Chunk {
  indices: number[]   // 對應原 cues 的 index
  texts: string[]
}

export function chunkCues(cues: Cue[], maxChars: number): Chunk[] {
  const chunks: Chunk[] = []
  let cur: Chunk = { indices: [], texts: [] }
  let curLen = 0
  for (let i = 0; i < cues.length; i++) {
    const len = cues[i].text.length
    if (cur.indices.length > 0 && curLen + len > maxChars) {
      chunks.push(cur)
      cur = { indices: [], texts: [] }
      curLen = 0
    }
    cur.indices.push(i)
    cur.texts.push(cues[i].text)
    curLen += len
  }
  if (cur.indices.length > 0) chunks.push(cur)
  return chunks
}
