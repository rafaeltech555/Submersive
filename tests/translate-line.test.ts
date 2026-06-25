import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { translateLineCached } from '../src/background/translate-line'
import { clearCache } from '../src/core/cache'

beforeEach(async () => { await clearCache() })

describe('translateLineCached', () => {
  it('cache miss 時呼叫 doTranslate 並寫入', async () => {
    let calls = 0
    const doTranslate = async (t: string) => { calls++; return '譯:' + t }
    const out = await translateLineCached('Hi', null, 'zh-TW', 'deepl', doTranslate)
    expect(out).toBe('譯:Hi')
    expect(calls).toBe(1)
  })

  it('cache hit 時不再呼叫 doTranslate', async () => {
    let calls = 0
    const doTranslate = async (t: string) => { calls++; return '譯:' + t }
    await translateLineCached('Hi', null, 'zh-TW', 'deepl', doTranslate)
    const again = await translateLineCached('Hi', null, 'zh-TW', 'deepl', doTranslate)
    expect(again).toBe('譯:Hi')
    expect(calls).toBe(1)
  })

  it('不同 engine 各自 cache', async () => {
    let calls = 0
    const doTranslate = async (t: string) => { calls++; return '譯:' + t }
    await translateLineCached('Hi', null, 'zh-TW', 'deepl', doTranslate)
    await translateLineCached('Hi', null, 'zh-TW', 'local', doTranslate)
    expect(calls).toBe(2)
  })
})
