import { describe, it, expect, vi } from 'vitest'
import { runWithRetry } from '../src/translation/queue'

describe('runWithRetry', () => {
  it('成功時直接回傳結果，不重試', async () => {
    const fn = vi.fn(async () => 'ok')
    const sleep = vi.fn<[number], Promise<void>>(async () => {})
    expect(await runWithRetry(fn, { retries: 3, baseMs: 10, sleep })).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('前兩次失敗、第三次成功，退避延遲遞增', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('429'))
      .mockRejectedValueOnce(new Error('429'))
      .mockResolvedValue('ok')
    const sleep = vi.fn<[number], Promise<void>>(async () => {})
    expect(await runWithRetry(fn, { retries: 3, baseMs: 10, sleep })).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([10, 20])
  })

  it('用盡重試後 throw 最後一個錯誤', async () => {
    const fn = vi.fn(async () => { throw new Error('boom') })
    const sleep = vi.fn<[number], Promise<void>>(async () => {})
    await expect(runWithRetry(fn, { retries: 2, baseMs: 1, sleep })).rejects.toThrow('boom')
    expect(fn).toHaveBeenCalledTimes(3) // 1 + 2 retries
  })
})
