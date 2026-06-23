import { describe, it, expect } from 'vitest'
import { cacheKey } from '../src/core/cache-key'

describe('cacheKey', () => {
  it('由 videoId + 語言對 + engine 組成穩定 key', () => {
    expect(cacheKey('abc123', 'en', 'zh-TW', 'deepl')).toBe('abc123|en>zh-TW|deepl')
  })

  it('srcLang 未知時以 auto 表示', () => {
    expect(cacheKey('abc123', null, 'zh-TW', 'local')).toBe('abc123|auto>zh-TW|local')
  })
})
