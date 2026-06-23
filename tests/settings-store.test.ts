import { describe, it, expect } from 'vitest'
import { mergeSettings } from '../src/core/settings-store'
import { DEFAULT_SETTINGS } from '../src/types'

describe('mergeSettings', () => {
  it('以預設值補齊缺漏欄位', () => {
    const merged = mergeSettings({ targetLang: 'ja' })
    expect(merged.targetLang).toBe('ja')
    expect(merged.showOriginal).toBe(DEFAULT_SETTINGS.showOriginal)
    expect(merged.engine).toBe(DEFAULT_SETTINGS.engine)
  })

  it('空輸入回傳完整預設值', () => {
    expect(mergeSettings({})).toEqual(DEFAULT_SETTINGS)
  })
})
