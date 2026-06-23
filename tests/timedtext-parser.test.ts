import { describe, it, expect } from 'vitest'
import { parseJson3 } from '../src/core/timedtext-parser'

describe('parseJson3', () => {
  it('將 json3 events 轉成 Cue[]（毫秒轉秒、合併 segs）', () => {
    const raw = JSON.stringify({
      events: [
        { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'Hello ' }, { utf8: 'world' }] },
        { tStartMs: 3500, dDurationMs: 1500, segs: [{ utf8: 'Bye' }] },
      ],
    })
    expect(parseJson3(raw)).toEqual([
      { start: 1, dur: 2, text: 'Hello world' },
      { start: 3.5, dur: 1.5, text: 'Bye' },
    ])
  })

  it('過濾掉沒有 segs 或純換行的 event', () => {
    const raw = JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: '\n' }] },
        { tStartMs: 1000, dDurationMs: 1000 },
        { tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: 'Real' }] },
      ],
    })
    expect(parseJson3(raw)).toEqual([{ start: 2, dur: 1, text: 'Real' }])
  })

  it('輸入非合法 JSON 時回傳空陣列', () => {
    expect(parseJson3('not json')).toEqual([])
  })
})
