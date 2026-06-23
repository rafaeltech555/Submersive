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
    private readonly fetchFn: typeof fetch = fetch,
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
