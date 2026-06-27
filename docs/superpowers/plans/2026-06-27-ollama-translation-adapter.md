# Ollama 本機 LLM 翻譯引擎（qwen3）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一個走本機 Ollama（qwen3）的翻譯引擎 `'ollama'`，實作既有 `TranslationAdapter` 介面，與 deepl/local/azure 並存、可在 Options 切換，大幅提升 ja/en→zh 翻譯品質。

**Architecture:** `OllamaAdapter` 用 Ollama `/api/chat` + 結構化輸出（`format` JSON schema）+ `think:false` 一次翻整批；若回傳 `translations` 長度/型別不符就退回逐句重翻；逐句再失敗才 throw（交由 background 既有 LibreTranslate fallback）。`pickAdapter` 加 `'ollama'` 分支，Options 加引擎選項與 `ollamaUrl`/`ollamaModel` 設定欄。

**Tech Stack:** TypeScript、Vitest（node env、`vi.fn` 注入 fetch）、Chrome MV3、Ollama `/api/chat`、qwen3:4b-instruct。

**Spec:** `docs/superpowers/specs/2026-06-27-ollama-translation-adapter-design.md`

---

## 檔案結構

| 檔案 | 動作 | 責任 |
|---|---|---|
| `src/types.ts` | 改 | `EngineId` 加 `'ollama'` |
| `src/translation/ollama-adapter.ts` | 新 | `OllamaAdapter`：批次 + 逐句 fallback 的 Ollama 翻譯 |
| `tests/ollama-adapter.test.ts` | 新 | `OllamaAdapter` 單元測試（注入 fetch） |
| `src/background/background.ts` | 改 | `pickAdapter` 加 `'ollama'` 分支、讀 `ollamaUrl`/`ollamaModel` |
| `src/options/options.html` | 改 | engine 選項加 ollama；加 `ollamaUrl`/`ollamaModel` 欄 |
| `src/options/options.ts` | 改 | load/save `ollamaUrl`/`ollamaModel`；engine cast 加 `'ollama'` |

---

## Task 1: EngineId 加 'ollama'

**Files:** Modify `src/types.ts:13`

- [ ] **Step 1: 改 EngineId**

把 `src/types.ts` 的
```ts
export type EngineId = 'deepl' | 'local' | 'azure'
```
改為
```ts
export type EngineId = 'deepl' | 'local' | 'azure' | 'ollama'
```

- [ ] **Step 2: tsc 驗證**

Run: `npx tsc --noEmit`
Expected: PASS（無新錯誤）

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: EngineId 加 ollama"
```
（commit message 結尾加 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`，下同。）

---

## Task 2: OllamaAdapter + 測試

**Files:**
- Create: `src/translation/ollama-adapter.ts`
- Test: `tests/ollama-adapter.test.ts`

- [ ] **Step 1: 寫失敗測試**

建立 `tests/ollama-adapter.test.ts`：

```ts
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/ollama-adapter.test.ts`
Expected: FAIL（`ollama-adapter` 模組不存在）

- [ ] **Step 3: 實作 OllamaAdapter**

建立 `src/translation/ollama-adapter.ts`：

```ts
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
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/ollama-adapter.test.ts`
Expected: PASS（7 test 全過）

- [ ] **Step 5: Commit**

```bash
git add src/translation/ollama-adapter.ts tests/ollama-adapter.test.ts
git commit -m "feat: OllamaAdapter 本機 LLM 翻譯（批次 + 逐句 fallback）+ 測試"
```

---

## Task 3: background pickAdapter 接 ollama

**Files:** Modify `src/background/background.ts`

- [ ] **Step 1: 加 import**

在 `background.ts` 頂部 import 區，於 `import { AzureAdapter } from '../translation/azure-adapter'` 下方加：
```ts
import { OllamaAdapter } from '../translation/ollama-adapter'
```

- [ ] **Step 2: 改 pickAdapter**

把既有 `pickAdapter` 整個函式換成（加讀 `ollamaUrl`/`ollamaModel` 與 `'ollama'` 分支）：
```ts
async function pickAdapter(engine: EngineId): Promise<TranslationAdapter> {
  const { deeplKey, localUrl, azureKey, azureRegion, ollamaUrl, ollamaModel } =
    await chrome.storage.local.get(['deeplKey', 'localUrl', 'azureKey', 'azureRegion', 'ollamaUrl', 'ollamaModel'])
  if (engine === 'local') return new LocalAdapter(localUrl ?? 'http://localhost:5000')
  if (engine === 'azure') return new AzureAdapter(azureKey ?? '', azureRegion ?? '')
  if (engine === 'ollama') return new OllamaAdapter(ollamaUrl ?? 'http://localhost:11434', ollamaModel ?? 'qwen3:4b-instruct')
  return new DeepLAdapter(deeplKey ?? '')
}
```

- [ ] **Step 3: tsc + build 驗證**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/background/background.ts
git commit -m "feat: pickAdapter 支援 ollama 引擎"
```

---

## Task 4: Options 加 ollama 選項與設定欄

**Files:**
- Modify: `src/options/options.html`
- Modify: `src/options/options.ts`

- [ ] **Step 1: options.html — engine 選項加 ollama**

把 `src/options/options.html` 的 engine `<select>`（現為一行）改成：
```html
    <select id="engine"><option value="deepl">DeepL（免費）</option><option value="local">本機 LibreTranslate（快，品質低）</option><option value="azure">Microsoft Azure（免費 2M/月）</option><option value="ollama">本機 Ollama（qwen3，品質佳）</option></select>
```

- [ ] **Step 2: options.html — 加 ollamaUrl / ollamaModel 欄**

在 `Azure Region` 那一行（`<label>Azure Region ...</label><br><br>`）之後、`原文顯示在譯文上方` 那行之前，插入：
```html
  <label>Ollama server URL <input id="ollamaUrl" type="text" size="36" placeholder="http://localhost:11434"></label><br><br>
  <label>Ollama 模型 <input id="ollamaModel" type="text" size="36" placeholder="qwen3:4b-instruct"></label><br><br>
```

- [ ] **Step 3: options.ts — init 讀取兩欄**

把 `src/options/options.ts` 的 `init()` 內讀 storage 那段：
```ts
  const { deeplKey, localUrl, azureKey, azureRegion } = await chrome.storage.local.get(['deeplKey', 'localUrl', 'azureKey', 'azureRegion'])
  $('deeplKey').value = deeplKey ?? ''
  $('localUrl').value = localUrl ?? 'http://localhost:5000'
  $('azureKey').value = azureKey ?? ''
  $('azureRegion').value = azureRegion ?? 'eastasia'
```
改為：
```ts
  const { deeplKey, localUrl, azureKey, azureRegion, ollamaUrl, ollamaModel } = await chrome.storage.local.get(['deeplKey', 'localUrl', 'azureKey', 'azureRegion', 'ollamaUrl', 'ollamaModel'])
  $('deeplKey').value = deeplKey ?? ''
  $('localUrl').value = localUrl ?? 'http://localhost:5000'
  $('azureKey').value = azureKey ?? ''
  $('azureRegion').value = azureRegion ?? 'eastasia'
  $('ollamaUrl').value = ollamaUrl ?? 'http://localhost:11434'
  $('ollamaModel').value = ollamaModel ?? 'qwen3:4b-instruct'
```

- [ ] **Step 4: options.ts — save 寫入兩欄 + engine cast**

把 save handler 內：
```ts
    engine: $('engine').value as 'deepl' | 'local' | 'azure',
```
改為：
```ts
    engine: $('engine').value as 'deepl' | 'local' | 'azure' | 'ollama',
```
並把：
```ts
  await chrome.storage.local.set({ deeplKey: $('deeplKey').value, localUrl: $('localUrl').value, azureKey: $('azureKey').value, azureRegion: $('azureRegion').value })
```
改為：
```ts
  await chrome.storage.local.set({ deeplKey: $('deeplKey').value, localUrl: $('localUrl').value, azureKey: $('azureKey').value, azureRegion: $('azureRegion').value, ollamaUrl: $('ollamaUrl').value, ollamaModel: $('ollamaModel').value })
```

- [ ] **Step 5: tsc + build 驗證**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/options/options.html src/options/options.ts
git commit -m "feat: Options 加 Ollama 引擎與 ollamaUrl/ollamaModel 設定"
```

---

## Task 5: 全測試 + build + 真機驗證

**Files:** 無（驗證）

- [ ] **Step 1: 全測試**

Run: `npx vitest run`
Expected: PASS（既有 70 + OllamaAdapter 7 = 77 tests 全過）

- [ ] **Step 2: tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS

- [ ] **Step 3: 真機驗證（使用者操作，列清單）**

1. 確認 Ollama 在跑、已有 `qwen3:4b-instruct`（`ollama list`）。
2. `edge://extensions` → Submersive reload。
3. Options → 翻譯引擎選 **本機 Ollama**、確認 URL `http://localhost:11434`、模型 `qwen3:4b-instruct`、儲存。
4. Netflix `/watch/...` F5 → 開**雙語**：繁中譯文逐句出現，**品質明顯優於 LibreTranslate**（ja→zh、en→zh 都通順）。
5. SW console（服務程式）：`TRANSLATE_BATCH` 往返正常；偶有「批次結果不符，退回逐句」warn 屬正常 fallback。
6. （可選）關掉 Ollama 測 fallback：若 Options 有設 `localUrl`，應 fallback 到 LibreTranslate（品質回到較差但仍出字）。

- [ ] **Step 4: 真機 OK 後收尾**

依專案規則委派 Sonnet：renew docs（README 翻譯引擎表加 Ollama 列、架構/引擎說明）+ commit + push。

---

## Self-Review 紀錄

- **Spec coverage**：OllamaAdapter（Task 2，批次/逐句/錯誤/空輸入）、EngineId（Task 1）、pickAdapter 分支（Task 3）、Options 引擎+欄位（Task 4）、不改 scheduler/cache/overlay/background fallback（spec 範圍一致）、不掛 OpenCC（Task 2 未引入）。
- **Placeholder scan**：無 TBD/TODO；每個 code step 皆含完整程式碼。
- **Type consistency**：`OllamaAdapter(baseUrl, model, fetchFn)`、`EngineId 'ollama'`、`ollamaUrl`/`ollamaModel` storage key、`/api/chat` body（model/think/stream/format/messages）在 Task 1-4 與測試間一致。
- **已知取捨**：逐句以 `Promise.all` 併發送出（Ollama 端仍序列處理，僅簡化程式碼）；`think:false` 經實測 qwen3:4b-instruct 接受（不支援時 Ollama 忽略）。
