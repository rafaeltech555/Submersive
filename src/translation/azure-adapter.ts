import type { TranslationAdapter, TranslationCapabilities } from './adapter'

const TARGET_MAP: Record<string, string> = {
  'zh-TW': 'zh-Hant',
  'zh-CN': 'zh-Hans',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
}

export class AzureAdapter implements TranslationAdapter {
  constructor(
    private readonly authKey: string,
    private readonly region: string,
    // 預設 fetch 必須以 bare call 包裝，否則 this.fetchFn(...) 在 SW/瀏覽器會丟 Illegal invocation（fetch 失去 global binding）。
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}

  capabilities(): TranslationCapabilities {
    return { maxCharsPerReq: 45000 }
  }

  async translateBatch(texts: string[], srcLang: string | null, targetLang: string): Promise<string[]> {
    const to = TARGET_MAP[targetLang] ?? targetLang
    const params = new URLSearchParams({ 'api-version': '3.0', to })
    if (srcLang) params.set('from', srcLang)
    const url = `https://api.cognitive.microsofttranslator.com/translate?${params.toString()}`
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.authKey,
        'Ocp-Apim-Subscription-Region': this.region,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(texts.map((t) => ({ Text: t }))),
    })
    if (!res.ok) throw new Error(`Azure HTTP ${res.status}`)
    const data = (await res.json()) as { translations: { text: string }[] }[]
    return data.map((d) => d.translations[0]?.text ?? '')
  }
}
