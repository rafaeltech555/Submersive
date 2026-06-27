import { describe, it, expect, vi } from 'vitest'
import { OllamaAdapter } from '../src/translation/ollama-adapter'

// Ollama /api/chat 回傳 { message: { content } }，content 為（結構化輸出的）JSON 字串。
const chatRes = (contentObj: unknown) =>
  new Response(JSON.stringify({ message: { content: JSON.stringify(contentObj) } }), { status: 200 })
// 取出某次 fetch 呼叫的 user 訊息內容（用來分辨批次 vs 逐句）。
const userOf = (init: RequestInit | undefined) => JSON.parse((init as RequestInit).body as string).messages[1].content

describe('OllamaAdapter', () => {
  it('批次 happy path：一次請求回等長譯文', async () => {
    const fetchMock = vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>(async () =>
      chatRes({ translations: ['譯a', '譯b'] }),
    )
    const a = new OllamaAdapter('http://x', 'm', fetchMock as unknown as typeof fetch)
    expect(await a.translateBatch(['a', 'b'], null, 'zh-TW')).toEqual(['譯a', '譯b'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://x/api/chat')
  })

  it('長度不符 → 逐句重翻', async () => {
    const fetchMock = vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>(async (_u, init) => {
      const user = userOf(init)
      if (user.startsWith('[')) return chatRes({ translations: ['只一個'] }) // 長度 1 ≠ 2
      return chatRes({ translation: '譯' + user })
    })
    const a = new OllamaAdapter('http://x', 'm', fetchMock as unknown as typeof fetch)
    expect(await a.translateBatch(['a', 'b'], null, 'zh-TW')).toEqual(['譯a', '譯b'])
    expect(fetchMock).toHaveBeenCalledTimes(3) // 1 批次 + 2 逐句
  })

  it('陣列含非字串 → 逐句', async () => {
    const fetchMock = vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>(async (_u, init) => {
      const user = userOf(init)
      if (user.startsWith('[')) return chatRes({ translations: ['ok', 123] })
      return chatRes({ translation: 'L' })
    })
    const a = new OllamaAdapter('http://x', 'm', fetchMock as unknown as typeof fetch)
    expect(await a.translateBatch(['a', 'b'], null, 'zh-TW')).toEqual(['L', 'L'])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('request body 形狀：model / think:false / stream:false / format / 目標語言名 / user', async () => {
    const fetchMock = vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>(async () =>
      chatRes({ translations: ['x'] }),
    )
    const a = new OllamaAdapter('http://x', 'qwen3:4b-instruct', fetchMock as unknown as typeof fetch)
    await a.translateBatch(['hi'], null, 'zh-TW')
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.model).toBe('qwen3:4b-instruct')
    expect(body.think).toBe(false)
    expect(body.stream).toBe(false)
    expect(body.format.required).toContain('translations')
    expect(body.messages[0].content).toContain('台灣正體中文')
    expect(body.messages[1].content).toBe(JSON.stringify(['hi']))
  })

  it('HTTP 非 200 → throw', async () => {
    const fetchMock = vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>(async () =>
      new Response('', { status: 500 }),
    )
    const a = new OllamaAdapter('http://x', 'm', fetchMock as unknown as typeof fetch)
    await expect(a.translateBatch(['a'], null, 'zh-TW')).rejects.toThrow(/Ollama HTTP 500/)
  })

  it('批次不符且逐句解析不出字串 → throw 逐句', async () => {
    const fetchMock = vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>(async (_u, init) => {
      const user = userOf(init)
      if (user.startsWith('[')) return chatRes({ translations: ['短'] }) // 觸發逐句
      return chatRes({ translation: 123 })                               // 逐句回非字串
    })
    const a = new OllamaAdapter('http://x', 'm', fetchMock as unknown as typeof fetch)
    await expect(a.translateBatch(['a', 'b'], null, 'zh-TW')).rejects.toThrow(/逐句/)
  })

  it('空輸入回 []，不發請求', async () => {
    const fetchMock = vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>(async () =>
      chatRes({ translations: [] }),
    )
    const a = new OllamaAdapter('http://x', 'm', fetchMock as unknown as typeof fetch)
    expect(await a.translateBatch([], null, 'zh-TW')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
