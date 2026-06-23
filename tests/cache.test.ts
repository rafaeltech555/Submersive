import { describe, it, expect } from 'vitest'
import 'fake-indexeddb/auto'
import { getCached, putCached } from '../src/core/cache'
import type { Cue } from '../src/types'

const cues: Cue[] = [{ start: 0, dur: 1, text: 'Hi', translated: '嗨' }]

describe('cache', () => {
  it('未命中回 null，寫入後可取回', async () => {
    expect(await getCached('k1')).toBeNull()
    await putCached('k1', cues)
    expect(await getCached('k1')).toEqual(cues)
  })
})
