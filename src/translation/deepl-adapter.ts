import type { TranslationAdapter, TranslationCapabilities } from './adapter'

// submersive 內部語言碼 -> DeepL 目標語言碼
const TARGET_MAP: Record<string, string> = {
  'zh-TW': 'ZH-HANT',
  'zh-CN': 'ZH-HANS',
  en: 'EN-US',
  ja: 'JA',
  ko: 'KO',
}

export class DeepLAdapter implements TranslationAdapter {
  constructor(
    private readonly authKey: string,
    // 預設 fetch 必須以 bare call 包裝，否則 this.fetchFn(...) 在 SW/瀏覽器會丟 Illegal invocation（fetch 失去 global binding）。
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}

  capabilities(): TranslationCapabilities {
    return { maxCharsPerReq: 4000 }
  }

  async translateBatch(texts: string[], srcLang: string | null, targetLang: string): Promise<string[]> {
    const body = new URLSearchParams()
    for (const t of texts) body.append('text', t)
    body.set('target_lang', TARGET_MAP[targetLang] ?? targetLang.toUpperCase())
    if (srcLang) body.set('source_lang', srcLang.toUpperCase())

    const res = await this.fetchFn('https://api-free.deepl.com/v2/translate', {
      method: 'POST',
      headers: { Authorization: `DeepL-Auth-Key ${this.authKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!res.ok) throw new Error(`DeepL HTTP ${res.status}`)
    const data = (await res.json()) as { translations: { text: string }[] }
    return data.translations.map((t) => t.text)
  }
}
