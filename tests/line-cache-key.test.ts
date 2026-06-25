import { describe, it, expect } from 'vitest'
import { lineCacheKey } from '../src/core/cache-key'
import { cacheKey } from '../src/core/cache-key'

describe('lineCacheKey', () => {
  it('以原文 + 語言 + engine 組 key，格式穩定', () => {
    expect(lineCacheKey('Hello', null, 'zh-TW', 'deepl')).toBe('line:auto>zh-TW|deepl|Hello')
    expect(lineCacheKey('Hi', 'en', 'zh-TW', 'local')).toBe('line:en>zh-TW|local|Hi')
  })

  it('不同原文 → 不同 key', () => {
    const a = lineCacheKey('Hello', null, 'zh-TW', 'deepl')
    const b = lineCacheKey('World', null, 'zh-TW', 'deepl')
    expect(a).not.toBe(b)
  })

  it('與整軌 cacheKey 命名空間不碰撞', () => {
    const line = lineCacheKey('Hello', null, 'zh-TW', 'deepl')
    const track = cacheKey('Hello', null, 'zh-TW', 'deepl')
    expect(line).not.toBe(track)
    expect(line.startsWith('line:')).toBe(true)
  })
})
