import { describe, it, expect, vi } from 'vitest'
import { LocalAdapter } from '../src/translation/local-adapter'

describe('LocalAdapter', () => {
  it('逐句呼叫 LibreTranslate 並回傳譯文', async () => {
    const fetchMock = vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>(async () =>
      new Response(JSON.stringify({ translatedText: '嗨' }), { status: 200 }),
    )
    const a = new LocalAdapter('http://localhost:5000', fetchMock as unknown as typeof fetch)
    const out = await a.translateBatch(['Hi'], 'en', 'zh-TW')
    expect(out).toEqual(['嗨'])
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://localhost:5000/translate')
  })
})
