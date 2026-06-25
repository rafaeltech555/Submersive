import type { TranslationAdapter, TranslationCapabilities } from './adapter'
import { Converter } from 'opencc-js'

const TARGET_MAP: Record<string, string> = { 'zh-TW': 'zt', 'zh-CN': 'zh', ja: 'ja', ko: 'ko', en: 'en' }

// LibreTranslate 的繁中輸出會夾簡體，用 OpenCC 簡→繁(台灣)清乾淨。懶載入。
let s2tConv: ((s: string) => string) | null = null
function toTraditional(s: string): string {
  if (!s2tConv) s2tConv = Converter({ from: 'cn', to: 'tw' })
  return s2tConv(s)
}

export class LocalAdapter implements TranslationAdapter {
  // 預設 fetch 必須以 bare call 包裝，否則 this.fetchFn(...) 在 SW/瀏覽器會丟 Illegal invocation（fetch 失去 global binding）。
  constructor(private readonly baseUrl: string, private readonly fetchFn: typeof fetch = (...a) => fetch(...a)) {}

  capabilities(): TranslationCapabilities { return { maxCharsPerReq: 2000 } }

  async translateBatch(texts: string[], srcLang: string | null, targetLang: string): Promise<string[]> {
    const target = TARGET_MAP[targetLang] ?? targetLang
    // LibreTranslate 支援 q 傳陣列、一次翻整批，避免逐句 N 個請求（整軌字幕會慢到爆）。
    const res = await this.fetchFn(`${this.baseUrl}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: texts, source: srcLang ?? 'auto', target, format: 'text' }),
    })
    if (!res.ok) throw new Error(`LibreTranslate HTTP ${res.status}`)
    const data = (await res.json()) as { translatedText: string | string[] }
    const arr = Array.isArray(data.translatedText) ? data.translatedText : [data.translatedText]
    // 只有繁中目標才做簡→繁；zh-CN 等維持原樣。
    return targetLang === 'zh-TW' ? arr.map(toTraditional) : arr
  }
}
