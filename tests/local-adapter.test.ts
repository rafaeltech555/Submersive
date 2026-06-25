import { describe, it, expect, vi } from 'vitest'
import { LocalAdapter } from '../src/translation/local-adapter'

describe('LocalAdapter', () => {
  it('一次送整批給 LibreTranslate（單一請求）並回傳對應譯文', async () => {
    const fetchMock = vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>(async () =>
      new Response(JSON.stringify({ translatedText: ['你好', '世界'] }), { status: 200 }),
    )
    const a = new LocalAdapter('http://localhost:5000', fetchMock as unknown as typeof fetch)
    const out = await a.translateBatch(['Hello', 'World'], 'en', 'zh-TW')
    expect(out).toEqual(['你好', '世界'])
    // 整批只打一個請求，body 的 q 是陣列
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://localhost:5000/translate')
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.q).toEqual(['Hello', 'World'])
    expect(body.target).toBe('zt')
  })

  it('單句也走陣列請求（相容回傳字串或陣列）', async () => {
    const fetchMock = vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>(async () =>
      new Response(JSON.stringify({ translatedText: '嗨' }), { status: 200 }),
    )
    const a = new LocalAdapter('http://localhost:5000', fetchMock as unknown as typeof fetch)
    const out = await a.translateBatch(['Hi'], 'en', 'zh-TW')
    expect(out).toEqual(['嗨'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('zh-TW 目標時把 LibreTranslate 的簡體輸出以 OpenCC 轉成繁體', async () => {
    const fetchMock = vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>(async () =>
      new Response(JSON.stringify({ translatedText: ['这个过程', '组织与技术'] }), { status: 200 }),
    )
    const a = new LocalAdapter('http://localhost:5000', fetchMock as unknown as typeof fetch)
    const out = await a.translateBatch(['a', 'b'], 'en', 'zh-TW')
    expect(out).toEqual(['這個過程', '組織與技術'])
  })

  it('zh-CN 目標不做繁化（維持簡體）', async () => {
    const fetchMock = vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>(async () =>
      new Response(JSON.stringify({ translatedText: ['这个过程'] }), { status: 200 }),
    )
    const a = new LocalAdapter('http://localhost:5000', fetchMock as unknown as typeof fetch)
    const out = await a.translateBatch(['a'], 'en', 'zh-CN')
    expect(out).toEqual(['这个过程'])
  })
})
