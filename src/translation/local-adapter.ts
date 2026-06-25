import type { TranslationAdapter, TranslationCapabilities } from './adapter'

const TARGET_MAP: Record<string, string> = { 'zh-TW': 'zt', 'zh-CN': 'zh', ja: 'ja', ko: 'ko', en: 'en' }

export class LocalAdapter implements TranslationAdapter {
  // 預設 fetch 必須以 bare call 包裝，否則 this.fetchFn(...) 在 SW/瀏覽器會丟 Illegal invocation（fetch 失去 global binding）。
  constructor(private readonly baseUrl: string, private readonly fetchFn: typeof fetch = (...a) => fetch(...a)) {}

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
