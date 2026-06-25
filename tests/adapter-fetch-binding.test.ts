import { describe, it, expect, afterEach } from 'vitest'
import { LocalAdapter } from '../src/translation/local-adapter'
import { DeepLAdapter } from '../src/translation/deepl-adapter'
import { AzureAdapter } from '../src/translation/azure-adapter'

// 重現「在 service worker / 瀏覽器中，預設 fetchFn 以 this.fetchFn(...) 呼叫會失去 global binding」的 bug。
// 瀏覽器 / WorkerGlobalScope 會檢查 fetch 的 receiver：非 global（被當成某物件的方法呼叫）即丟 Illegal invocation。
// 這裡用一個會做同樣檢查的全域 fetch 取代真 fetch；若 adapter 預設把 this.fetchFn 綁成自己的方法，呼叫就會 throw。
const realFetch = globalThis.fetch

function browserLikeFetch(this: unknown, input: RequestInfo | URL): Promise<Response> {
  // bare call（this=undefined）或以 globalThis 呼叫才合法；其餘（this=adapter 實例）視為 Illegal invocation。
  if (this !== undefined && this !== globalThis) {
    throw new TypeError("Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation")
  }
  const url = String(input)
  let body: unknown
  if (url.includes('deepl')) body = { translations: [{ text: 'x' }] }
  else if (url.includes('microsofttranslator')) body = [{ translations: [{ text: 'x' }] }]
  else body = { translatedText: 'x' }
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}

afterEach(() => { globalThis.fetch = realFetch })

describe('adapter 預設 fetch 的 global binding', () => {
  it('LocalAdapter 用預設 fetch 不應丟 Illegal invocation', async () => {
    globalThis.fetch = browserLikeFetch as unknown as typeof fetch
    const a = new LocalAdapter('http://localhost:5000')
    await expect(a.translateBatch(['Hi'], 'en', 'zh-TW')).resolves.toEqual(['x'])
  })

  it('DeepLAdapter 用預設 fetch 不應丟 Illegal invocation', async () => {
    globalThis.fetch = browserLikeFetch as unknown as typeof fetch
    const a = new DeepLAdapter('KEY')
    await expect(a.translateBatch(['Hi'], 'en', 'zh-TW')).resolves.toEqual(['x'])
  })

  it('AzureAdapter 用預設 fetch 不應丟 Illegal invocation', async () => {
    globalThis.fetch = browserLikeFetch as unknown as typeof fetch
    const a = new AzureAdapter('KEY', 'eastasia')
    await expect(a.translateBatch(['Hi'], 'en', 'zh-TW')).resolves.toEqual(['x'])
  })
})
