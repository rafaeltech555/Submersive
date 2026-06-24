import { describe, it, expect } from 'vitest'
import { friendlyTranslateError } from '../src/core/translate-error'

describe('friendlyTranslateError', () => {
  it('auth/額度類錯誤 → key 提示', () => {
    expect(friendlyTranslateError('DeepL HTTP 403')).toBe(
      '翻譯失敗：API key 無效或額度用盡，請至設定檢查',
    )
    expect(friendlyTranslateError('DeepL HTTP 456 quota')).toBe(
      '翻譯失敗：API key 無效或額度用盡，請至設定檢查',
    )
    expect(friendlyTranslateError('Error: Authorization failed')).toBe(
      '翻譯失敗：API key 無效或額度用盡，請至設定檢查',
    )
  })

  it('本機連線類錯誤 → 本機 server 提示', () => {
    expect(friendlyTranslateError('TypeError: Failed to fetch')).toBe(
      '翻譯失敗：本機翻譯 server 未啟動或無法連線',
    )
    expect(friendlyTranslateError('connect ECONNREFUSED 127.0.0.1:5000')).toBe(
      '翻譯失敗：本機翻譯 server 未啟動或無法連線',
    )
  })

  it('長度不符錯誤 → 重試提示', () => {
    expect(friendlyTranslateError('translation length mismatch: got 2, expected 3')).toBe(
      '翻譯失敗：翻譯結果長度不符，請稍後重試',
    )
  })

  it('其他錯誤 → 保留原訊息', () => {
    expect(friendlyTranslateError('something weird')).toBe('翻譯失敗：something weird')
  })

  it('空值 / undefined → 未知錯誤', () => {
    expect(friendlyTranslateError(undefined)).toBe('翻譯失敗：未知錯誤')
    expect(friendlyTranslateError('')).toBe('翻譯失敗：未知錯誤')
    expect(friendlyTranslateError('   ')).toBe('翻譯失敗：未知錯誤')
  })
})
