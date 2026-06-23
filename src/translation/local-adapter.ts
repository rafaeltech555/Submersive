import type { TranslationAdapter, TranslationCapabilities } from './adapter'

const TARGET_MAP: Record<string, string> = { 'zh-TW': 'zt', 'zh-CN': 'zh', ja: 'ja', ko: 'ko', en: 'en' }

export class LocalAdapter implements TranslationAdapter {
  constructor(private readonly baseUrl: string, private readonly fetchFn: typeof fetch = fetch) {}

  capabilities(): TranslationCapabilities { return { maxCharsPerReq: 2000 } }

  async translateBatch(texts: string[], srcLang: string | null, targetLang: string): Promise<string[]> {
    const target = TARGET_MAP[targetLang] ?? targetLang
    const out: string[] = []
    for (const q of texts) {
      const res = await this.fetchFn(`${this.baseUrl}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, source: srcLang ?? 'auto', target, format: 'text' }),
      })
      if (!res.ok) throw new Error(`LibreTranslate HTTP ${res.status}`)
      const data = (await res.json()) as { translatedText: string }
      out.push(data.translatedText)
    }
    return out
  }
}
