import { describe, it, expect, vi } from 'vitest'
import { AzureAdapter } from '../src/translation/azure-adapter'

describe('AzureAdapter', () => {
  it('批次呼叫 v3 translate 並回傳等長譯文', async () => {
    const fetchMock = vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>(async () =>
      new Response(JSON.stringify([
        { translations: [{ text: '你好' }] },
        { translations: [{ text: '世界' }] },
      ]), { status: 200 }),
    )
    const a = new AzureAdapter('KEY', 'eastasia', fetchMock as unknown as typeof fetch)
    const out = await a.translateBatch(['Hello', 'World'], 'en', 'zh-TW')
    expect(out).toEqual(['你好', '世界'])
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/translate?api-version=3.0')
    expect(String(url)).toContain('to=zh-Hant')
    expect((init as RequestInit).headers).toMatchObject({
      'Ocp-Apim-Subscription-Key': 'KEY',
      'Ocp-Apim-Subscription-Region': 'eastasia',
    })
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual([{ Text: 'Hello' }, { Text: 'World' }])
  })

  it('HTTP 非 2xx 時 throw', async () => {
    const fetchMock = vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>(async () =>
      new Response('quota', { status: 403 }))
    const a = new AzureAdapter('KEY', 'eastasia', fetchMock as unknown as typeof fetch)
    await expect(a.translateBatch(['x'], 'en', 'zh-TW')).rejects.toThrow(/403/)
  })
})
