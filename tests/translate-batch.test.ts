import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { translateBatchCached } from '../src/background/translate-batch'
import { clearCache } from '../src/core/cache'

beforeEach(async () => { await clearCache() })

describe('translateBatchCached', () => {
  it('全 miss：把整批丟給 translateMisses 一次，輸出對齊輸入', async () => {
    const calls: string[][] = []
    const translateMisses = async (m: string[]) => { calls.push(m); return m.map((t) => '譯:' + t) }
    const out = await translateBatchCached(['a', 'b', 'c'], null, 'zh-TW', 'local', translateMisses)
    expect(out).toEqual(['譯:a', '譯:b', '譯:c'])
    expect(calls).toEqual([['a', 'b', 'c']]) // 只呼叫一次、含全部 miss
  })

  it('部分命中快取：只把 miss 丟 translateMisses，命中者用快取值', async () => {
    const translateMisses = async (m: string[]) => m.map((t) => '譯:' + t)
    // 先翻 'a' 入快取
    await translateBatchCached(['a'], null, 'zh-TW', 'local', translateMisses)
    const calls: string[][] = []
    const spy = async (m: string[]) => { calls.push(m); return m.map((t) => 'NEW:' + t) }
    const out = await translateBatchCached(['a', 'b'], null, 'zh-TW', 'local', spy)
    expect(out).toEqual(['譯:a', 'NEW:b']) // a 來自快取、b 新翻
    expect(calls).toEqual([['b']])         // 只有 b 是 miss
  })

  it('全命中快取：不呼叫 translateMisses', async () => {
    const translateMisses = async (m: string[]) => m.map((t) => '譯:' + t)
    await translateBatchCached(['a', 'b'], null, 'zh-TW', 'local', translateMisses)
    let called = false
    const out = await translateBatchCached(['a', 'b'], null, 'zh-TW', 'local', async (m) => { called = true; return m })
    expect(out).toEqual(['譯:a', '譯:b'])
    expect(called).toBe(false)
  })

  it('translateMisses 回傳長度不符時 throw', async () => {
    const bad = async (_m: string[]) => ['只有一個']
    await expect(translateBatchCached(['a', 'b'], null, 'zh-TW', 'local', bad)).rejects.toThrow(/length mismatch/)
  })

  it('不同 engine 各自快取', async () => {
    const calls: string[][] = []
    const t = async (m: string[]) => { calls.push(m); return m.map((x) => '譯:' + x) }
    await translateBatchCached(['a'], null, 'zh-TW', 'deepl', t)
    await translateBatchCached(['a'], null, 'zh-TW', 'local', t)
    expect(calls).toEqual([['a'], ['a']]) // deepl 與 local 各自 miss
  })
})
