import { describe, it, expect } from 'vitest'
import { chunkCues } from '../src/core/chunker'
import type { Cue } from '../src/types'

const c = (text: string): Cue => ({ start: 0, dur: 1, text })

describe('chunkCues', () => {
  it('在累積字元數超過上限前切塊', () => {
    const cues = [c('aaa'), c('bbb'), c('cccc')] // 3,3,4
    const chunks = chunkCues(cues, 6)
    expect(chunks.map((ch) => ch.indices)).toEqual([[0, 1], [2]])
  })

  it('單一 cue 超過上限時自成一塊（不丟棄）', () => {
    const cues = [c('x'.repeat(50))]
    const chunks = chunkCues(cues, 10)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].indices).toEqual([0])
  })

  it('空輸入回傳空陣列', () => {
    expect(chunkCues([], 100)).toEqual([])
  })
})
