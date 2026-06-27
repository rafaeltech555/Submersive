import type { TranslationAdapter, TranslationCapabilities } from './adapter'

// submersive 內部語言碼 -> prompt 用的人類可讀語言名
const TARGET_NAME: Record<string, string> = {
  'zh-TW': '台灣正體中文（繁體）',
  'zh-CN': '简体中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
}

// 結構化輸出 schema：強制 Ollama 回合法 JSON。
const BATCH_SCHEMA = {
  type: 'object',
  properties: { translations: { type: 'array', items: { type: 'string' } } },
  required: ['translations'],
}
const LINE_SCHEMA = {
  type: 'object',
  properties: { translation: { type: 'string' } },
  required: ['translation'],
}

const systemBatch = (target: string) =>
  `你是專業影視字幕翻譯。將使用者提供的每一行字幕翻成${target}。` +
  `輸出 JSON 物件，translations 為與輸入等長、同順序的譯文字串陣列。` +
  `只翻譯，不要解釋、不要註解、不要保留原文、不要合併或增刪行。`

const systemLine = (target: string) =>
  `你是專業影視字幕翻譯。將使用者提供的字幕翻成${target}。` +
  `輸出 JSON 物件，translation 為譯文字串。只翻譯，不要解釋、不要保留原文。`

export class OllamaAdapter implements TranslationAdapter {
  // 預設 fetch 以 bare call 包裝，否則 this.fetchFn(...) 在 SW/瀏覽器會丟 Illegal invocation。
  constructor(
    private readonly baseUrl: string = 'http://localhost:11434',
    private readonly model: string = 'qwen3:4b-instruct',
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}

  capabilities(): TranslationCapabilities { return { maxCharsPerReq: 2000 } }

  async translateBatch(texts: string[], _srcLang: string | null, targetLang: string): Promise<string[]> {
    if (texts.length === 0) return []
    const target = TARGET_NAME[targetLang] ?? targetLang
    const batched = await this.tryBatch(texts, target)
    if (batched) return batched
    console.warn('[submersive] Ollama 批次結果不符，退回逐句')
    return this.perLine(texts, target)
  }

  // 批次：一次翻整批；解析/驗證不過回 null（讓上層走逐句）。
  private async tryBatch(texts: string[], target: string): Promise<string[] | null> {
    const content = await this.chat(systemBatch(target), JSON.stringify(texts), BATCH_SCHEMA)
    let parsed: unknown
    try { parsed = JSON.parse(content) } catch { return null }
    const t = (parsed as { translations?: unknown }).translations
    if (Array.isArray(t) && t.length === texts.length && t.every((x) => typeof x === 'string')) return t as string[]
    return null
  }

  // 逐句：每句各一次請求；任一句解析不出字串 → throw（HTTP 錯誤由 chat 直接 throw）。
  private async perLine(texts: string[], target: string): Promise<string[]> {
    return Promise.all(texts.map(async (line) => {
      const content = await this.chat(systemLine(target), line, LINE_SCHEMA)
      let parsed: unknown
      try { parsed = JSON.parse(content) } catch { throw new Error('Ollama 逐句翻譯解析失敗') }
      const tr = (parsed as { translation?: unknown }).translation
      if (typeof tr !== 'string') throw new Error('Ollama 逐句翻譯解析失敗')
      return tr
    }))
  }

  // 發一次 /api/chat（結構化輸出、關思考、不串流），回 message.content 字串。
  private async chat(system: string, user: string, format: object): Promise<string> {
    const res = await this.fetchFn(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        think: false,
        format,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
    const data = (await res.json()) as { message?: { content?: string } }
    return data.message?.content ?? ''
  }
}
