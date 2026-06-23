import { describe, it, expect, vi } from 'vitest'
import { DeepLAdapter } from '../src/translation/deepl-adapter'

describe('DeepLAdapter', () => {
  it('呼叫免費端點並回傳等長譯文', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ translations: [{ text: '你好' }, { text: '世界' }] }), { status: 200 }),
    )
    const a = new DeepLAdapter('KEY', fetchMock as unknown as typeof fetch)
    const out = await a.translateBatch(['Hello', 'World'], 'en', 'zh-TW')
    expect(out).toEqual(['你好', '世界'])

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('api-free.deepl.com/v2/translate')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'DeepL-Auth-Key KEY' })
  })

  it('zh-TW 目標映射到 DeepL 的 ZH-HANT', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ translations: [{ text: '嗨' }] }), { status: 200 }),
    )
    const a = new DeepLAdapter('KEY', fetchMock as unknown as typeof fetch)
    await a.translateBatch(['Hi'], 'en', 'zh-TW')
    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as URLSearchParams
    expect(body.get('target_lang')).toBe('ZH-HANT')
  })

  it('HTTP 非 2xx 時 throw', async () => {
    const fetchMock = vi.fn(async () => new Response('quota', { status: 456 }))
    const a = new DeepLAdapter('KEY', fetchMock as unknown as typeof fetch)
    await expect(a.translateBatch(['x'], 'en', 'zh-TW')).rejects.toThrow(/456/)
  })
})
