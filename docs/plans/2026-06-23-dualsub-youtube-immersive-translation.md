# dualsub — YouTube 沉浸式即時翻譯擴充套件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一個 Chromium（MV3）瀏覽器擴充套件，在 YouTube 觀看時攔截原文字幕軌、整段批次翻譯，並以自繪雙語 overlay 依播放器時間同步顯示。

**Architecture:** 四層——MAIN-world 注入 hook 攔 `timedtext`、ISOLATED content script 渲染同步 overlay、background service worker 做翻譯/批次/快取、options/popup 管設定。純邏輯模組（parser、chunker、cache-key、translation adapter、queue）以 Vitest TDD；瀏覽器整合部分以完整程式碼 + 手動驗證。

**Tech Stack:** TypeScript、Vite、@crxjs/vite-plugin（MV3 打包）、Vitest（單元測試）、idb（IndexedDB wrapper）、DeepL 免費 API、LibreTranslate（本機備援）。

對應 spec：`dualsub/docs/specs/2026-06-23-dualsub-youtube-immersive-translation-design.md`

---

## File Structure

```
dualsub/
  package.json
  tsconfig.json
  vite.config.ts
  vitest.config.ts
  src/
    manifest.ts                  # MV3 manifest（crxjs 用）
    types.ts                     # Cue, VideoContext, Settings, Messages
    core/
      timedtext-parser.ts        # YouTube json3 timedtext -> Cue[]
      chunker.ts                 # 將 Cue[] 依字數切成批次
      cache-key.ts               # 組 (videoId, langpair, engine) -> string
      cache.ts                   # idb 包裝：存/取譯好的 Cue[]
    translation/
      adapter.ts                 # TranslationAdapter 介面 + 型別
      deepl-adapter.ts           # DeepL 免費端點
      local-adapter.ts           # 本機 LibreTranslate
      queue.ts                   # 限額佇列 + 指數退避
    sites/
      site-adapter.ts            # SiteAdapter 介面
      youtube-adapter.ts         # YouTube 實作
    inject/
      hook.ts                    # MAIN-world：patch fetch/XHR 攔 timedtext
    content/
      content.ts                 # content script 進入點（協調）
      overlay.ts                 # 自繪雙語 overlay + 時間同步
    background/
      background.ts              # service worker：translate + cache 協調
    options/
      options.html
      options.ts
    popup/
      popup.html
      popup.ts
  tests/
    timedtext-parser.test.ts
    chunker.test.ts
    cache-key.test.ts
    deepl-adapter.test.ts
    local-adapter.test.ts
    queue.test.ts
```

設計原則：純邏輯與副作用分離。`core/`、`translation/` 為可單元測試的純函式/可注入 `fetch` 的模組；`inject/`、`content/`、`background/` 為瀏覽器整合層。

---

## Milestone 對應

- **M0** → Task 1–2（scaffold、manifest、載入驗證）
- **M1** → Task 3、9、10、11（parser、hook、youtube-adapter、overlay 顯示原文同步）
- **M2** → Task 4、6、7、12（chunker、adapter 介面、deepl、background 端到端翻譯 + 雙語渲染）
- **M3** → Task 13（options/popup 設定）
- **M4** → Task 5、8、14（cache-key、cache、queue、限額/快取整合）
- **M5** → Task 15（local-adapter + fallback + 樣式打磨）

> 註：Task 順序已依「先建立被依賴的純模組，再整合」排列，非嚴格按里程碑數字。

---

## Task 1: 專案 scaffold 與工具鏈

**Files:**
- Create: `dualsub/package.json`
- Create: `dualsub/tsconfig.json`
- Create: `dualsub/vite.config.ts`
- Create: `dualsub/vitest.config.ts`
- Create: `dualsub/.gitignore`

- [ ] **Step 1: 建立 package.json**

```json
{
  "name": "dualsub",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@crxjs/vite-plugin": "^2.0.0",
    "typescript": "^5.4.0",
    "vite": "^5.2.0",
    "vitest": "^1.6.0",
    "fake-indexeddb": "^6.0.0",
    "@types/chrome": "^0.0.268"
  },
  "dependencies": {
    "idb": "^8.0.0"
  }
}
```

- [ ] **Step 2: 建立 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["chrome", "vitest/globals"],
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: 建立 vite.config.ts**

```ts
import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './src/manifest'

export default defineConfig({
  plugins: [crx({ manifest })],
})
```

- [ ] **Step 4: 建立 vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
})
```

- [ ] **Step 5: 建立 .gitignore**

```
node_modules
dist
*.log
```

- [ ] **Step 6: 安裝依賴並確認 vitest 可跑（無測試時應正常結束）**

Run: `cd dualsub && npm install && npx vitest run`
Expected: 安裝成功；vitest 顯示 `No test files found`（exit 0 或提示無測試），代表工具鏈可用。

- [ ] **Step 7: Commit**

```bash
cd dualsub && git init && git add -A && git commit -m "chore: scaffold dualsub extension toolchain"
```

---

## Task 2: 共用型別與 manifest（M0）

**Files:**
- Create: `dualsub/src/types.ts`
- Create: `dualsub/src/manifest.ts`

- [ ] **Step 1: 建立 types.ts（全專案共用型別）**

```ts
export interface Cue {
  start: number   // 起始秒
  dur: number     // 持續秒
  text: string    // 原文
  translated?: string
}

export interface VideoContext {
  videoId: string
  srcLang: string | null  // 字幕原文語言（可能未知）
}

export type EngineId = 'deepl' | 'local'

export interface Settings {
  targetLang: string      // 例 'zh-TW'
  showOriginal: boolean
  engine: EngineId
  fontScale: number       // 1.0 = 預設
  verticalPos: number     // 0..1，1 = 最底
  bgOpacity: number       // 0..1
  originalFirst: boolean  // true: 原文在上
}

export const DEFAULT_SETTINGS: Settings = {
  targetLang: 'zh-TW',
  showOriginal: true,
  engine: 'deepl',
  fontScale: 1.0,
  verticalPos: 0.9,
  bgOpacity: 0.5,
  originalFirst: true,
}

// content <-> background 訊息
export type Message =
  | { type: 'TRANSLATE'; videoId: string; srcLang: string | null; targetLang: string; engine: EngineId; cues: Cue[] }
  | { type: 'TRANSLATE_RESULT'; videoId: string; cues: Cue[] }
  | { type: 'TRANSLATE_ERROR'; videoId: string; error: string }
```

- [ ] **Step 2: 建立 manifest.ts（MV3）**

```ts
import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'dualsub',
  version: '0.0.1',
  description: 'YouTube 沉浸式雙語字幕',
  permissions: ['storage'],
  host_permissions: [
    'https://*.youtube.com/*',
    'https://api-free.deepl.com/*',
    'http://localhost:*/*',
    'http://127.0.0.1:*/*',
  ],
  background: { service_worker: 'src/background/background.ts', type: 'module' },
  content_scripts: [
    {
      matches: ['https://*.youtube.com/*'],
      js: ['src/inject/hook.ts'],
      run_at: 'document_start',
      world: 'MAIN',
    },
    {
      matches: ['https://*.youtube.com/*'],
      js: ['src/content/content.ts'],
      run_at: 'document_start',
      world: 'ISOLATED',
    },
  ],
  // web_accessible_resources 不再需要——hook 已透過 content_scripts[world: MAIN] 注入，
  // crxjs 會為 content script assets 自動產生此欄位，但不用手動宣告 hook.ts。
  options_page: 'src/options/options.html',
  action: { default_popup: 'src/popup/popup.html' },
})
```

- [ ] **Step 3: 建立最小 placeholder 進入點，讓 build 通過**

建立 `src/background/background.ts`：
```ts
console.log('[dualsub] background ready')
```
建立 `src/content/content.ts`：
```ts
console.log('[dualsub] content ready')
```
建立 `src/inject/hook.ts`：
```ts
console.log('[dualsub] hook ready')
```
建立 `src/options/options.html`：
```html
<!doctype html><meta charset="utf-8"><title>dualsub 設定</title><body><h1>dualsub 設定</h1><script type="module" src="./options.ts"></script></body>
```
建立 `src/options/options.ts`：
```ts
console.log('[dualsub] options ready')
```
建立 `src/popup/popup.html`：
```html
<!doctype html><meta charset="utf-8"><title>dualsub</title><body><h1>dualsub</h1><script type="module" src="./popup.ts"></script></body>
```
建立 `src/popup/popup.ts`：
```ts
console.log('[dualsub] popup ready')
```

- [ ] **Step 4: build 並驗證產物**

Run: `cd dualsub && npm run build`
Expected: 產生 `dist/`，無錯誤，含 `manifest.json`。

- [ ] **Step 5: 手動載入驗證（M0 驗收）**

在 Chrome 開 `chrome://extensions` → 開啟「開發人員模式」→「載入未封裝項目」選 `dualsub/dist`。
Expected: 擴充套件載入無錯；開任一 youtube.com 分頁，DevTools console 出現 `[dualsub] content ready`、背景頁出現 `[dualsub] background ready`。

- [ ] **Step 6: Commit**

```bash
cd dualsub && git add -A && git commit -m "feat: MV3 manifest, shared types, placeholder entrypoints (M0)"
```

---

## Task 3: timedtext parser（M1，TDD）

YouTube 的 `timedtext` 以 `fmt=json3` 回傳。結構為 `{ events: [{ tStartMs, dDurationMs, segs: [{ utf8 }] }] }`；部分 event 為換行/無 segs，須過濾。

**Files:**
- Create: `dualsub/src/core/timedtext-parser.ts`
- Test: `dualsub/tests/timedtext-parser.test.ts`

- [ ] **Step 1: 寫失敗測試**

```ts
import { describe, it, expect } from 'vitest'
import { parseJson3 } from '../src/core/timedtext-parser'

describe('parseJson3', () => {
  it('將 json3 events 轉成 Cue[]（毫秒轉秒、合併 segs）', () => {
    const raw = JSON.stringify({
      events: [
        { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'Hello ' }, { utf8: 'world' }] },
        { tStartMs: 3500, dDurationMs: 1500, segs: [{ utf8: 'Bye' }] },
      ],
    })
    expect(parseJson3(raw)).toEqual([
      { start: 1, dur: 2, text: 'Hello world' },
      { start: 3.5, dur: 1.5, text: 'Bye' },
    ])
  })

  it('過濾掉沒有 segs 或純換行的 event', () => {
    const raw = JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: '\n' }] },
        { tStartMs: 1000, dDurationMs: 1000 },
        { tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: 'Real' }] },
      ],
    })
    expect(parseJson3(raw)).toEqual([{ start: 2, dur: 1, text: 'Real' }])
  })

  it('輸入非合法 JSON 時回傳空陣列', () => {
    expect(parseJson3('not json')).toEqual([])
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd dualsub && npx vitest run tests/timedtext-parser.test.ts`
Expected: FAIL（`parseJson3` 未定義 / 找不到模組）。

- [ ] **Step 3: 實作**

```ts
import type { Cue } from '../types'

interface Json3Seg { utf8?: string }
interface Json3Event { tStartMs?: number; dDurationMs?: number; segs?: Json3Seg[] }

export function parseJson3(raw: string): Cue[] {
  let data: { events?: Json3Event[] }
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  const events = data.events ?? []
  const cues: Cue[] = []
  for (const ev of events) {
    if (!ev.segs || ev.tStartMs == null || ev.dDurationMs == null) continue
    const text = ev.segs.map((s) => s.utf8 ?? '').join('').trim()
    if (!text) continue
    cues.push({ start: ev.tStartMs / 1000, dur: ev.dDurationMs / 1000, text })
  }
  return cues
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd dualsub && npx vitest run tests/timedtext-parser.test.ts`
Expected: PASS（3 passed）。

- [ ] **Step 5: Commit**

```bash
cd dualsub && git add -A && git commit -m "feat: timedtext json3 parser (M1)"
```

---

## Task 4: chunker（M2，TDD）

批次翻譯前，將 `Cue[]` 依字元上限切成多塊，避免單次 API 超量。每塊回傳所含 cue 的 index 範圍，方便回填譯文。

**Files:**
- Create: `dualsub/src/core/chunker.ts`
- Test: `dualsub/tests/chunker.test.ts`

- [ ] **Step 1: 寫失敗測試**

```ts
import { describe, it, expect } from 'vitest'
import { chunkCues } from '../src/core/chunker'
import type { Cue } from '../src/types'

const c = (text: string): Cue => ({ start: 0, dur: 1, text })

describe('chunkCues', () => {
  it('在累積字元數超過上限前切塊', () => {
    const cues = [c('aaa'), c('bbb'), c('cccc')] // 3,3,4
    const chunks = chunkCues(cues, 6)
    expect(chunks.map((ch) => ch.indices)).toEqual([[0, 1], [2]])
  })

  it('單一 cue 超過上限時自成一塊（不丟棄）', () => {
    const cues = [c('x'.repeat(50))]
    const chunks = chunkCues(cues, 10)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].indices).toEqual([0])
  })

  it('空輸入回傳空陣列', () => {
    expect(chunkCues([], 100)).toEqual([])
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd dualsub && npx vitest run tests/chunker.test.ts`
Expected: FAIL（`chunkCues` 未定義）。

- [ ] **Step 3: 實作**

```ts
import type { Cue } from '../types'

export interface Chunk {
  indices: number[]   // 對應原 cues 的 index
  texts: string[]
}

export function chunkCues(cues: Cue[], maxChars: number): Chunk[] {
  const chunks: Chunk[] = []
  let cur: Chunk = { indices: [], texts: [] }
  let curLen = 0
  for (let i = 0; i < cues.length; i++) {
    const len = cues[i].text.length
    if (cur.indices.length > 0 && curLen + len > maxChars) {
      chunks.push(cur)
      cur = { indices: [], texts: [] }
      curLen = 0
    }
    cur.indices.push(i)
    cur.texts.push(cues[i].text)
    curLen += len
  }
  if (cur.indices.length > 0) chunks.push(cur)
  return chunks
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd dualsub && npx vitest run tests/chunker.test.ts`
Expected: PASS（3 passed）。

- [ ] **Step 5: Commit**

```bash
cd dualsub && git add -A && git commit -m "feat: cue chunker for batched translation (M2)"
```

---

## Task 5: cache-key（M4，TDD）

**Files:**
- Create: `dualsub/src/core/cache-key.ts`
- Test: `dualsub/tests/cache-key.test.ts`

- [ ] **Step 1: 寫失敗測試**

```ts
import { describe, it, expect } from 'vitest'
import { cacheKey } from '../src/core/cache-key'

describe('cacheKey', () => {
  it('由 videoId + 語言對 + engine 組成穩定 key', () => {
    expect(cacheKey('abc123', 'en', 'zh-TW', 'deepl')).toBe('abc123|en>zh-TW|deepl')
  })

  it('srcLang 未知時以 auto 表示', () => {
    expect(cacheKey('abc123', null, 'zh-TW', 'local')).toBe('abc123|auto>zh-TW|local')
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd dualsub && npx vitest run tests/cache-key.test.ts`
Expected: FAIL（`cacheKey` 未定義）。

- [ ] **Step 3: 實作**

```ts
import type { EngineId } from '../types'

export function cacheKey(
  videoId: string,
  srcLang: string | null,
  targetLang: string,
  engine: EngineId,
): string {
  return `${videoId}|${srcLang ?? 'auto'}>${targetLang}|${engine}`
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd dualsub && npx vitest run tests/cache-key.test.ts`
Expected: PASS（2 passed）。

- [ ] **Step 5: Commit**

```bash
cd dualsub && git add -A && git commit -m "feat: cache key builder (M4)"
```

---

## Task 6: TranslationAdapter 介面（M2）

**Files:**
- Create: `dualsub/src/translation/adapter.ts`

- [ ] **Step 1: 定義介面（無測試，純型別）**

```ts
import type { Cue } from '../types'

export interface TranslationCapabilities {
  maxCharsPerReq: number
}

export interface TranslationAdapter {
  // 輸入原文字串陣列，回傳等長譯文字串陣列
  translateBatch(texts: string[], srcLang: string | null, targetLang: string): Promise<string[]>
  capabilities(): TranslationCapabilities
}
```

- [ ] **Step 2: build 驗證型別無誤**

Run: `cd dualsub && npx tsc --noEmit`
Expected: 無型別錯誤。

- [ ] **Step 3: Commit**

```bash
cd dualsub && git add -A && git commit -m "feat: TranslationAdapter interface (M2)"
```

---

## Task 7: DeepLAdapter（M2，TDD，注入 fetch）

DeepL 免費端點：`POST https://api-free.deepl.com/v2/translate`，header `Authorization: DeepL-Auth-Key <key>`，body `text` 可重複多筆，回傳 `{ translations: [{ text }] }`。為可測，`fetch` 由建構子注入。

**Files:**
- Create: `dualsub/src/translation/deepl-adapter.ts`
- Test: `dualsub/tests/deepl-adapter.test.ts`

- [ ] **Step 1: 寫失敗測試**

```ts
import { describe, it, expect, vi } from 'vitest'
import { DeepLAdapter } from '../src/translation/deepl-adapter'

describe('DeepLAdapter', () => {
  it('呼叫免費端點並回傳等長譯文', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ translations: [{ text: '你好' }, { text: '世界' }] }), { status: 200 }),
    )
    const a = new DeepLAdapter('KEY', fetchMock as unknown as typeof fetch)
    const out = await a.translateBatch(['Hello', 'World'], 'en', 'zh-TW')
    expect(out).toEqual(['你好', '世界'])

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('api-free.deepl.com/v2/translate')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'DeepL-Auth-Key KEY' })
  })

  it('zh-TW 目標映射到 DeepL 的 ZH-HANT', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ translations: [{ text: '嗨' }] }), { status: 200 }),
    )
    const a = new DeepLAdapter('KEY', fetchMock as unknown as typeof fetch)
    await a.translateBatch(['Hi'], 'en', 'zh-TW')
    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as URLSearchParams
    expect(body.get('target_lang')).toBe('ZH-HANT')
  })

  it('HTTP 非 2xx 時 throw', async () => {
    const fetchMock = vi.fn(async () => new Response('quota', { status: 456 }))
    const a = new DeepLAdapter('KEY', fetchMock as unknown as typeof fetch)
    await expect(a.translateBatch(['x'], 'en', 'zh-TW')).rejects.toThrow(/456/)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd dualsub && npx vitest run tests/deepl-adapter.test.ts`
Expected: FAIL（`DeepLAdapter` 未定義）。

- [ ] **Step 3: 實作**

```ts
import type { TranslationAdapter, TranslationCapabilities } from './adapter'

// dualsub 內部語言碼 -> DeepL 目標語言碼
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
    private readonly fetchFn: typeof fetch = fetch,
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
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd dualsub && npx vitest run tests/deepl-adapter.test.ts`
Expected: PASS（3 passed）。

- [ ] **Step 5: Commit**

```bash
cd dualsub && git add -A && git commit -m "feat: DeepL free adapter (M2)"
```

---

## Task 8: 限額佇列 + 指數退避（M4，TDD）

序列化送出工作，限制併發；失敗時依 `429/5xx` 退避重試。退避延遲由注入的 `sleep` 控制以利測試。

**Files:**
- Create: `dualsub/src/translation/queue.ts`
- Test: `dualsub/tests/queue.test.ts`

- [ ] **Step 1: 寫失敗測試**

```ts
import { describe, it, expect, vi } from 'vitest'
import { runWithRetry } from '../src/translation/queue'

describe('runWithRetry', () => {
  it('成功時直接回傳結果，不重試', async () => {
    const fn = vi.fn(async () => 'ok')
    const sleep = vi.fn(async () => {})
    expect(await runWithRetry(fn, { retries: 3, baseMs: 10, sleep })).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('前兩次失敗、第三次成功，退避延遲遞增', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('429'))
      .mockRejectedValueOnce(new Error('429'))
      .mockResolvedValue('ok')
    const sleep = vi.fn(async () => {})
    expect(await runWithRetry(fn, { retries: 3, baseMs: 10, sleep })).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([10, 20])
  })

  it('用盡重試後 throw 最後一個錯誤', async () => {
    const fn = vi.fn(async () => { throw new Error('boom') })
    const sleep = vi.fn(async () => {})
    await expect(runWithRetry(fn, { retries: 2, baseMs: 1, sleep })).rejects.toThrow('boom')
    expect(fn).toHaveBeenCalledTimes(3) // 1 + 2 retries
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd dualsub && npx vitest run tests/queue.test.ts`
Expected: FAIL（`runWithRetry` 未定義）。

- [ ] **Step 3: 實作**

```ts
export interface RetryOpts {
  retries: number
  baseMs: number
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function runWithRetry<T>(fn: () => Promise<T>, opts: RetryOpts): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep
  let lastErr: unknown
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt < opts.retries) await sleep(opts.baseMs * 2 ** attempt)
    }
  }
  throw lastErr
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd dualsub && npx vitest run tests/queue.test.ts`
Expected: PASS（3 passed）。

- [ ] **Step 5: Commit**

```bash
cd dualsub && git add -A && git commit -m "feat: retry-with-backoff helper (M4)"
```

---

## Task 9: MAIN-world hook 攔截 timedtext（M1）

注入 MAIN world，patch `window.fetch`，當 URL 含 `timedtext` 時複製回應文字並以 `postMessage` 廣播。瀏覽器整合層，以手動驗證。

**Files:**
- Modify: `dualsub/src/inject/hook.ts`（取代 placeholder）

- [ ] **Step 1: 實作 hook**

```ts
// 注入到 YouTube 頁面 MAIN world，攔截字幕請求
const origFetch = window.fetch
window.fetch = async function (...args: Parameters<typeof fetch>) {
  const res = await origFetch.apply(this, args)
  try {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url
    if (url && url.includes('timedtext')) {
      const clone = res.clone()
      clone.text().then((raw) => {
        window.postMessage({ source: 'dualsub-hook', kind: 'timedtext', url, raw }, '*')
      })
    }
  } catch {
    /* 不影響原請求 */
  }
  return res
}
console.log('[dualsub] timedtext hook installed')
```

- [ ] **Step 2: build**

Run: `cd dualsub && npm run build`
Expected: 無錯誤。

- [ ] **Step 3: 手動驗證攔截（在 Task 10 完整串接後一起驗）**

說明：hook 以 `world: 'MAIN'` content script 的形式由 manifest 自動注入（crxjs 會將 `src/inject/hook.ts` 轉譯為 JS bundle），**不需要** `web_accessible_resources` 也不需要 content script 手動建立 `<script>` 標籤。此步驟僅確認 build 產物中 hook 已被轉譯（`dist/assets/hook.ts-*.js` 為純 JS，無 TypeScript 語法）。重新載入擴充套件後於 Task 10 一併驗證 console 是否印出 `[dualsub] timedtext hook installed`。

- [ ] **Step 4: Commit**

```bash
cd dualsub && git add -A && git commit -m "feat: MAIN-world timedtext fetch hook (M1)"
```

---

## Task 10: YouTubeAdapter 與 SiteAdapter 介面（M1）

content script 注入 hook、接收 `timedtext`、偵測 videoId、讀播放器時間。瀏覽器整合層，手動驗證。

**Files:**
- Create: `dualsub/src/sites/site-adapter.ts`
- Create: `dualsub/src/sites/youtube-adapter.ts`

- [ ] **Step 1: 定義 SiteAdapter 介面**

`src/sites/site-adapter.ts`：
```ts
import type { Cue, VideoContext } from '../types'

export interface SiteAdapter {
  detectVideo(): VideoContext | null
  onSubtitleTrack(cb: (cues: Cue[], ctx: VideoContext) => void): void
  getPlayerTime(): number
  getVideoElement(): HTMLVideoElement | null
}
```

- [ ] **Step 2: 實作 YouTubeAdapter**

`src/sites/youtube-adapter.ts`：
```ts
import type { SiteAdapter } from './site-adapter'
import type { Cue, VideoContext } from '../types'
import { parseJson3 } from '../core/timedtext-parser'

export class YouTubeAdapter implements SiteAdapter {
  private listeners: ((cues: Cue[], ctx: VideoContext) => void)[] = []

  constructor() {
    // hook 已由 manifest content_scripts[world: MAIN] 自動注入，
    // 這裡只需監聽它廣播的 postMessage。
    window.addEventListener('message', (ev) => {
      const d = ev.data
      if (ev.source !== window || !d || d.source !== 'dualsub-hook' || d.kind !== 'timedtext') return
      const ctx = this.detectVideo()
      if (!ctx) return
      const cues = parseJson3(d.raw)
      if (cues.length) this.listeners.forEach((cb) => cb(cues, ctx))
    })
  }

  detectVideo(): VideoContext | null {
    const id = new URLSearchParams(location.search).get('v')
    return id ? { videoId: id, srcLang: null } : null
  }

  onSubtitleTrack(cb: (cues: Cue[], ctx: VideoContext) => void): void {
    this.listeners.push(cb)
  }

  getVideoElement(): HTMLVideoElement | null {
    return document.querySelector('video.html5-main-video')
  }

  getPlayerTime(): number {
    return this.getVideoElement()?.currentTime ?? 0
  }
}
```

- [ ] **Step 3: build**

Run: `cd dualsub && npm run build`
Expected: 無錯誤。

- [ ] **Step 4: 手動驗證（在 Task 11 接好 content script 後完整驗收）**

說明：YouTubeAdapter 由 content script 實例化（Task 11）。完整攔截驗證於 Task 11 進行。

- [ ] **Step 5: Commit**

```bash
cd dualsub && git add -A && git commit -m "feat: SiteAdapter interface + YouTubeAdapter (M1)"
```

---

## Task 11: Overlay 渲染 + content script 顯示原文同步（M1 驗收）

自繪 overlay，依 `requestAnimationFrame` 取播放器時間，找出當前 cue 顯示。M1 先只顯示原文，驗證攔截 + 同步成立。

**Files:**
- Create: `dualsub/src/content/overlay.ts`
- Modify: `dualsub/src/content/content.ts`（取代 placeholder）

- [ ] **Step 1: 實作 overlay.ts**

```ts
import type { Cue, Settings } from '../types'

export class Overlay {
  private el: HTMLDivElement
  private cues: Cue[] = []
  private raf = 0

  constructor(private getTime: () => number, private getAnchor: () => HTMLElement | null) {
    this.el = document.createElement('div')
    this.el.id = 'dualsub-overlay'
    Object.assign(this.el.style, {
      position: 'absolute', left: '0', right: '0', bottom: '8%',
      textAlign: 'center', pointerEvents: 'none', zIndex: '60',
      textShadow: '0 0 4px #000',
    } as CSSStyleDeclaration)
  }

  setCues(cues: Cue[]) { this.cues = cues }

  mount() {
    const anchor = this.getAnchor()
    if (anchor && !anchor.contains(this.el)) anchor.appendChild(this.el)
    this.loop()
  }

  unmount() { cancelAnimationFrame(this.raf); this.el.remove() }

  private loop = () => {
    const t = this.getTime()
    const cur = this.cues.find((c) => t >= c.start && t < c.start + c.dur)
    this.render(cur)
    this.raf = requestAnimationFrame(this.loop)
  }

  // M1：只渲染原文；M2 會擴充雙語（見 Task 12）
  private render(cue?: Cue) {
    if (!cue) { this.el.textContent = ''; return }
    this.el.textContent = cue.text
  }

  // M2 用：套用設定樣式（M1 先留空實作）
  applySettings(_s: Settings) {}
}
```

- [ ] **Step 2: 實作 content.ts 串接**

```ts
import { YouTubeAdapter } from '../sites/youtube-adapter'
import { Overlay } from './overlay'

const site = new YouTubeAdapter()
const overlay = new Overlay(
  () => site.getPlayerTime(),
  () => document.querySelector('#movie_player') as HTMLElement | null,
)

site.onSubtitleTrack((cues) => {
  console.log('[dualsub] got cues', cues.length)
  overlay.setCues(cues)
  overlay.mount()
})

console.log('[dualsub] content ready')
```

- [ ] **Step 3: build**

Run: `cd dualsub && npm run build`
Expected: 無錯誤。

- [ ] **Step 4: 手動驗證（M1 驗收）**

1. `chrome://extensions` 重新載入 dualsub。
2. 開一部**有字幕**的 YouTube 影片，**開啟 CC 字幕**（觸發 `timedtext` 請求）。
3. DevTools console 應出現 `[dualsub] timedtext hook installed`、`[dualsub] got cues N`（N>0）。
4. 畫面底部出現 dualsub overlay，顯示**原文字幕**，並隨播放、暫停、快轉**正確同步**。

Expected: overlay 原文與影片內容時間對得上（容忍 <0.5s 誤差）。若無觸發，確認已手動開 CC。

- [ ] **Step 5: Commit**

```bash
cd dualsub && git add -A && git commit -m "feat: overlay render + content sync showing original (M1 done)"
```

---

## Task 12: Background 翻譯協調 + 雙語渲染（M2 驗收）

content 把整段 cue 丟 background；background 用 chunker 分塊、DeepLAdapter 翻譯、回填譯文後回傳；overlay 改成雙語渲染。先用 background 內暫存 key（M4 再換 IndexedDB）。

**Files:**
- Modify: `dualsub/src/background/background.ts`
- Modify: `dualsub/src/content/content.ts`
- Modify: `dualsub/src/content/overlay.ts`

- [ ] **Step 1: 實作 background.ts**

```ts
import type { Message, Cue } from '../types'
import { chunkCues } from '../core/chunker'
import { DeepLAdapter } from '../translation/deepl-adapter'
import { runWithRetry } from '../translation/queue'

// M2：暫從 storage 取 DeepL key（Options 於 M3 提供）
async function getDeepLKey(): Promise<string> {
  const { deeplKey } = await chrome.storage.local.get('deeplKey')
  return deeplKey ?? ''
}

async function translateCues(cues: Cue[], srcLang: string | null, targetLang: string): Promise<Cue[]> {
  const key = await getDeepLKey()
  const adapter = new DeepLAdapter(key)
  const chunks = chunkCues(cues, adapter.capabilities().maxCharsPerReq)
  const out: Cue[] = cues.map((c) => ({ ...c }))
  for (const chunk of chunks) {
    const translated = await runWithRetry(
      () => adapter.translateBatch(chunk.texts, srcLang, targetLang),
      { retries: 3, baseMs: 500 },
    )
    chunk.indices.forEach((idx, i) => { out[idx].translated = translated[i] })
  }
  return out
}

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  if (msg.type !== 'TRANSLATE') return
  translateCues(msg.cues, msg.srcLang, msg.targetLang)
    .then((cues) => sendResponse({ type: 'TRANSLATE_RESULT', videoId: msg.videoId, cues }))
    .catch((e) => sendResponse({ type: 'TRANSLATE_ERROR', videoId: msg.videoId, error: String(e) }))
  return true // 非同步回應
})

console.log('[dualsub] background ready')
```

- [ ] **Step 2: 更新 content.ts，送翻譯請求**

將 `site.onSubtitleTrack` 回呼改為：
```ts
site.onSubtitleTrack(async (cues, ctx) => {
  overlay.setCues(cues)   // 先顯示原文
  overlay.mount()
  const res = await chrome.runtime.sendMessage({
    type: 'TRANSLATE', videoId: ctx.videoId, srcLang: ctx.srcLang,
    targetLang: 'zh-TW', engine: 'deepl', cues,
  })
  if (res?.type === 'TRANSLATE_RESULT') {
    overlay.setCues(res.cues)
    overlay.setBilingual(true)
  } else {
    console.warn('[dualsub] translate failed', res?.error)
  }
})
```

- [ ] **Step 3: 更新 overlay.ts 支援雙語渲染**

在 `Overlay` class 增加狀態與雙語渲染：
```ts
private bilingual = false
setBilingual(v: boolean) { this.bilingual = v }
```
並將 `render` 改為：
```ts
private render(cue?: Cue) {
  if (!cue) { this.el.replaceChildren(); return }
  const frag = document.createDocumentFragment()
  const orig = document.createElement('div')
  orig.textContent = cue.text
  Object.assign(orig.style, { fontSize: '90%', opacity: '0.8' })
  const trans = document.createElement('div')
  trans.textContent = cue.translated ?? ''
  Object.assign(trans.style, { fontSize: '120%' })
  // 原文在上、譯文在下
  if (this.bilingual && cue.translated) { frag.append(orig, trans) }
  else { frag.append(orig) }
  this.el.replaceChildren(frag)
}
```

- [ ] **Step 4: build**

Run: `cd dualsub && npm run build`
Expected: 無錯誤。

- [ ] **Step 5: 手動驗證（M2 驗收）**

1. 先在 background 設 key：`chrome://extensions` → dualsub → 「service worker」開 console，執行 `chrome.storage.local.set({ deeplKey: '你的DeepL免費key' })`。
2. 重新載入擴充套件，開有字幕的 YouTube 影片並開 CC。
3. overlay 先顯示原文，數秒後（翻譯完成）變成**原文 + 中譯雙語**。

Expected: 雙語同步顯示；service worker console 無錯誤。若顯示 `TRANSLATE_ERROR`，檢查 key 與 DeepL 額度。

- [ ] **Step 6: Commit**

```bash
cd dualsub && git add -A && git commit -m "feat: background translate orchestration + bilingual overlay (M2 done)"
```

---

## Task 13: Options/Popup 設定（M3）

提供設定 UI：目標語言、開關原文、引擎、樣式、DeepL key；存 `chrome.storage.local`，content/background 讀取套用。

**Files:**
- Modify: `dualsub/src/options/options.html`
- Modify: `dualsub/src/options/options.ts`
- Modify: `dualsub/src/popup/popup.html`
- Modify: `dualsub/src/popup/popup.ts`
- Create: `dualsub/src/core/settings-store.ts`
- Test: `dualsub/tests/settings-store.test.ts`

- [ ] **Step 1: 寫 settings-store 失敗測試（合併預設值）**

```ts
import { describe, it, expect } from 'vitest'
import { mergeSettings } from '../src/core/settings-store'
import { DEFAULT_SETTINGS } from '../src/types'

describe('mergeSettings', () => {
  it('以預設值補齊缺漏欄位', () => {
    const merged = mergeSettings({ targetLang: 'ja' })
    expect(merged.targetLang).toBe('ja')
    expect(merged.showOriginal).toBe(DEFAULT_SETTINGS.showOriginal)
    expect(merged.engine).toBe(DEFAULT_SETTINGS.engine)
  })

  it('空輸入回傳完整預設值', () => {
    expect(mergeSettings({})).toEqual(DEFAULT_SETTINGS)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd dualsub && npx vitest run tests/settings-store.test.ts`
Expected: FAIL（`mergeSettings` 未定義）。

- [ ] **Step 3: 實作 settings-store.ts**

```ts
import { DEFAULT_SETTINGS, type Settings } from '../types'

export function mergeSettings(partial: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...partial }
}

export async function loadSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings')
  return mergeSettings(settings ?? {})
}

export async function saveSettings(s: Partial<Settings>): Promise<void> {
  const merged = mergeSettings({ ...(await loadSettings()), ...s })
  await chrome.storage.local.set({ settings: merged })
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd dualsub && npx vitest run tests/settings-store.test.ts`
Expected: PASS（2 passed）。注意：此測試需 `chrome` 全域；`mergeSettings` 為純函式不依賴 chrome，測試只覆蓋純函式部分。

- [ ] **Step 5: 實作 options.html**

```html
<!doctype html><meta charset="utf-8"><title>dualsub 設定</title>
<body style="font-family:sans-serif;max-width:420px;margin:24px auto">
  <h1>dualsub 設定</h1>
  <label>目標語言
    <select id="targetLang">
      <option value="zh-TW">繁體中文</option>
      <option value="zh-CN">简体中文</option>
      <option value="ja">日本語</option>
      <option value="ko">한국어</option>
      <option value="en">English</option>
    </select>
  </label><br><br>
  <label><input type="checkbox" id="showOriginal"> 顯示原文字幕</label><br><br>
  <label>翻譯引擎
    <select id="engine"><option value="deepl">DeepL（免費）</option><option value="local">本機 LibreTranslate</option></select>
  </label><br><br>
  <label>DeepL API Key <input id="deeplKey" type="password" size="36"></label><br><br>
  <label>本機 server URL <input id="localUrl" type="text" size="36" placeholder="http://localhost:5000"></label><br><br>
  <label><input type="checkbox" id="originalFirst"> 原文顯示在譯文上方</label><br><br>
  <label>字級倍率 <input id="fontScale" type="number" min="0.5" max="2" step="0.1" style="width:5em"></label><br><br>
  <label>垂直位置 (0=最上, 1=最下) <input id="verticalPos" type="number" min="0" max="1" step="0.05" style="width:5em"></label><br><br>
  <label>背景透明度 (0–1) <input id="bgOpacity" type="number" min="0" max="1" step="0.05" style="width:5em"></label><br><br>
  <button id="save">儲存</button> <span id="status"></span>
  <script type="module" src="./options.ts"></script>
</body>
```

- [ ] **Step 6: 實作 options.ts**

```ts
import { loadSettings, saveSettings } from '../core/settings-store'

const $ = (id: string) => document.getElementById(id) as HTMLInputElement & HTMLSelectElement

async function init() {
  const s = await loadSettings()
  $('targetLang').value = s.targetLang
  $('showOriginal').checked = s.showOriginal
  $('engine').value = s.engine
  $('originalFirst').checked = s.originalFirst
  $('fontScale').value = String(s.fontScale)
  $('verticalPos').value = String(s.verticalPos)
  $('bgOpacity').value = String(s.bgOpacity)
  const { deeplKey, localUrl } = await chrome.storage.local.get(['deeplKey', 'localUrl'])
  $('deeplKey').value = deeplKey ?? ''
  $('localUrl').value = localUrl ?? 'http://localhost:5000'
}

$('save').addEventListener('click', async () => {
  await saveSettings({
    targetLang: $('targetLang').value,
    showOriginal: $('showOriginal').checked,
    engine: $('engine').value as 'deepl' | 'local',
    originalFirst: $('originalFirst').checked,
    fontScale: parseFloat($('fontScale').value),
    verticalPos: parseFloat($('verticalPos').value),
    bgOpacity: parseFloat($('bgOpacity').value),
  })
  await chrome.storage.local.set({ deeplKey: $('deeplKey').value, localUrl: $('localUrl').value })
  document.getElementById('status')!.textContent = '已儲存'
})

init()
```

- [ ] **Step 7: 實作 popup（快速開關，連到 options）**

`popup.html`：
```html
<!doctype html><meta charset="utf-8"><title>dualsub</title>
<body style="font-family:sans-serif;width:200px;padding:12px">
  <h3>dualsub</h3>
  <label><input type="checkbox" id="showOriginal"> 顯示原文</label><br><br>
  <button id="open">開啟設定</button>
  <script type="module" src="./popup.ts"></script>
</body>
```
`popup.ts`：
```ts
import { loadSettings, saveSettings } from '../core/settings-store'

const cb = document.getElementById('showOriginal') as HTMLInputElement
loadSettings().then((s) => { cb.checked = s.showOriginal })
cb.addEventListener('change', () => saveSettings({ showOriginal: cb.checked }))
document.getElementById('open')!.addEventListener('click', () => chrome.runtime.openOptionsPage())
```

- [ ] **Step 8: content/background 讀取 settings 取代寫死值**

在 `content.ts` 開頭載入設定，並用 `s.targetLang`、`s.engine`、`s.showOriginal` 取代 Task 12 寫死的 `'zh-TW'`/`'deepl'`：
```ts
import { loadSettings } from '../core/settings-store'
const settings = await loadSettings()
// sendMessage 改用 settings.targetLang / settings.engine
// overlay.setBilingual(settings.showOriginal && hasTranslation)
```
（content script 頂層改為 `(async () => { ... })()` 包裹以使用 await。）
background `getDeepLKey` 已從 storage 取，無需改。

- [ ] **Step 9: build + 手動驗證（M3 驗收）**

Run: `cd dualsub && npm run build`
重新載入擴充套件 → 右鍵擴充套件圖示「選項」→ 設定目標語言/key → 儲存 → 開 YouTube 影片，驗證使用所設語言翻譯、原文開關生效。
Expected: 設定持久化（重開瀏覽器仍在），翻譯語言與原文顯示依設定。

- [ ] **Step 10: Commit**

```bash
cd dualsub && git add -A && git commit -m "feat: options/popup settings + persistence (M3 done)"
```

---

## Task 14: IndexedDB 快取整合（M4 驗收）

background 翻譯前先查快取，命中直接回傳；未命中翻完寫入。用 `idb` + `fake-indexeddb` 測試。

**Files:**
- Modify: `dualsub/src/core/cache.ts`（取代 placeholder，若無則建立）
- Test: `dualsub/tests/cache.test.ts`
- Modify: `dualsub/src/background/background.ts`

- [ ] **Step 1: 寫 cache 失敗測試**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { getCached, putCached } from '../src/core/cache'
import type { Cue } from '../src/types'

const cues: Cue[] = [{ start: 0, dur: 1, text: 'Hi', translated: '嗨' }]

describe('cache', () => {
  it('未命中回 null，寫入後可取回', async () => {
    expect(await getCached('k1')).toBeNull()
    await putCached('k1', cues)
    expect(await getCached('k1')).toEqual(cues)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd dualsub && npx vitest run tests/cache.test.ts`
Expected: FAIL（`getCached`/`putCached` 未定義）。

- [ ] **Step 3: 實作 cache.ts**

```ts
import { openDB, type IDBPDatabase } from 'idb'
import type { Cue } from '../types'

let dbp: Promise<IDBPDatabase> | null = null
function db() {
  if (!dbp) dbp = openDB('dualsub', 1, { upgrade(d) { d.createObjectStore('cues') } })
  return dbp
}

export async function getCached(key: string): Promise<Cue[] | null> {
  const v = await (await db()).get('cues', key)
  return (v as Cue[]) ?? null
}

export async function putCached(key: string, cues: Cue[]): Promise<void> {
  await (await db()).put('cues', cues, key)
}

export async function clearCache(): Promise<void> {
  await (await db()).clear('cues')
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd dualsub && npx vitest run tests/cache.test.ts`
Expected: PASS（1 passed）。

- [ ] **Step 5: background 整合快取**

在 `background.ts` 的 `translateCues` 外層包快取（依 engine 決定 key）：
```ts
import { cacheKey } from '../core/cache-key'
import { getCached, putCached } from '../core/cache'

async function translateWithCache(
  videoId: string, cues: Cue[], srcLang: string | null, targetLang: string, engine: 'deepl' | 'local',
): Promise<Cue[]> {
  const key = cacheKey(videoId, srcLang, targetLang, engine)
  const hit = await getCached(key)
  if (hit) return hit
  const result = await translateCues(cues, srcLang, targetLang)
  await putCached(key, result)
  return result
}
```
並把 `onMessage` 內呼叫改為 `translateWithCache(msg.videoId, msg.cues, msg.srcLang, msg.targetLang, msg.engine)`。

- [ ] **Step 6: build + 手動驗證（M4 驗收）**

Run: `cd dualsub && npm run build`
1. 開一部影片翻譯一次（service worker console 觀察有打 DeepL）。
2. 重新整理同影片同語言 → 應**瞬間出現雙語、且無新的 DeepL 請求**（快取命中）。
Expected: 第二次無 API 呼叫；切到新語言才再打。

- [ ] **Step 7: Commit**

```bash
cd dualsub && git add -A && git commit -m "feat: IndexedDB translation cache (M4 done)"
```

---

## Task 15: LocalAdapter + fallback + 樣式打磨（M5）

新增本機 LibreTranslate adapter（`POST /translate`，body `{q, source, target, format:'text'}`，回 `{translatedText}`），engine=local 時使用；DeepL 失敗且有設本機時 fallback。套用 settings 樣式。

**Files:**
- Create: `dualsub/src/translation/local-adapter.ts`
- Test: `dualsub/tests/local-adapter.test.ts`
- Modify: `dualsub/src/background/background.ts`
- Modify: `dualsub/src/content/overlay.ts`

- [ ] **Step 1: 寫 LocalAdapter 失敗測試**

```ts
import { describe, it, expect, vi } from 'vitest'
import { LocalAdapter } from '../src/translation/local-adapter'

describe('LocalAdapter', () => {
  it('逐句呼叫 LibreTranslate 並回傳譯文', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ translatedText: '嗨' }), { status: 200 }),
    )
    const a = new LocalAdapter('http://localhost:5000', fetchMock as unknown as typeof fetch)
    const out = await a.translateBatch(['Hi'], 'en', 'zh-TW')
    expect(out).toEqual(['嗨'])
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://localhost:5000/translate')
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd dualsub && npx vitest run tests/local-adapter.test.ts`
Expected: FAIL（`LocalAdapter` 未定義）。

- [ ] **Step 3: 實作 local-adapter.ts**

```ts
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
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd dualsub && npx vitest run tests/local-adapter.test.ts`
Expected: PASS（1 passed）。

- [ ] **Step 5: background 依 engine 選 adapter + fallback**

注意：`translateWith` 在 `runWithRetry` 回傳後、`forEach` 回填前，已加入長度防護：
```ts
if (translated.length !== chunk.texts.length) {
  throw new Error(`translation length mismatch: got ${translated.length}, expected ${chunk.texts.length}`)
}
```
此防護防止 adapter 回傳短陣列時將 `undefined` 寫入快取。

把 `translateCues` 改為依 engine 建 adapter，並在 DeepL 失敗時若有 localUrl 則退到 LocalAdapter：
```ts
import { LocalAdapter } from '../translation/local-adapter'
import type { TranslationAdapter } from '../translation/adapter'

async function pickAdapter(engine: 'deepl' | 'local'): Promise<TranslationAdapter> {
  const { deeplKey, localUrl } = await chrome.storage.local.get(['deeplKey', 'localUrl'])
  if (engine === 'local') return new LocalAdapter(localUrl ?? 'http://localhost:5000')
  return new DeepLAdapter(deeplKey ?? '')
}
```
`translateCues(cues, srcLang, targetLang, engine)` 內用 `pickAdapter(engine)`；外層 try DeepL，catch 後若 `localUrl` 存在則改用 LocalAdapter 重跑一次（記錄 warn）。

- [ ] **Step 6: overlay 套用 settings 樣式**

實作 `Overlay.applySettings(s: Settings)`：依 `fontScale` 設字級、`verticalPos` 設 `bottom`、`bgOpacity` 設背景、`originalFirst` 決定原文/譯文順序、`showOriginal` 控制是否顯示原文列。content 載入 settings 後呼叫 `overlay.applySettings(settings)`。

```ts
applySettings(s: Settings) {
  this.el.style.bottom = `${(1 - s.verticalPos) * 100}%`
  this.fontScale = s.fontScale
  this.originalFirst = s.originalFirst
  this.showOriginal = s.showOriginal
  this.el.style.background = `rgba(0,0,0,${s.bgOpacity})`
}
```
（在 class 增加 `private fontScale=1; private originalFirst=true; private showOriginal=true;`，並讓 `render` 依 `originalFirst`/`showOriginal`/`fontScale` 組裝原文/譯文兩列。）

- [ ] **Step 7: build + 手動驗證（M5 驗收）**

Run: `cd dualsub && npm run build`
1. 啟動本機 LibreTranslate（`docker run -p 5000:5000 libretranslate/libretranslate` 或同等），Options 設 engine=local、localUrl。
2. 開 YouTube 影片 → 應走本機翻譯出雙語。
3. 切回 deepl 但故意清空 key → 若設了 localUrl，應 fallback 本機仍出譯文。
4. 調整字級/位置/原文順序 → overlay 即時或重載後反映。
Expected: 本機翻譯可用、fallback 生效、樣式設定生效。

- [ ] **Step 8: Commit**

```bash
cd dualsub && git add -A && git commit -m "feat: local LibreTranslate adapter, fallback, style settings (M5 done)"
```

---

## Self-Review 結果

**Spec coverage：**
- §2 形態/MV3 → Task 1–2 ✓
- §2 方案 B 攔截 → Task 3、9、10 ✓
- §2 DeepL 主力 → Task 7、12 ✓
- §2 本機備援 → Task 15 ✓
- §3 四層架構 → Task 2（manifest）、9（hook）、10–11（content）、12（background）✓
- §4 SiteAdapter/TranslationAdapter 介面 → Task 6、10 ✓
- §5 資料流批次+快取 → Task 4、12、14 ✓
- §6 overlay 雙語/同步/全螢幕 → Task 11、12、15 ✓
- §7 設定（語言/原文/引擎/樣式）→ Task 13、15 ✓
- §8 錯誤處理（限額退避、無字幕、fallback）→ Task 8、12、15 ✓
- §9 IndexedDB 快取 → Task 14 ✓
- §10 里程碑 → Task 對應表 ✓

**Placeholder scan：** 無 TBD/TODO；每個 code step 均含實際程式碼。瀏覽器整合 task 以完整程式碼 + 明確手動驗證步驟取代不可自動化的單元測試。

**Type consistency：** `Cue`、`Settings`、`EngineId`、`TranslationAdapter.translateBatch`、`SiteAdapter`、`cacheKey`、`runWithRetry` 等簽名跨 task 一致；`maxCharsPerReq` 統一用於 chunker。

**已知取捨：** §8「影片無字幕通知使用者」目前僅在 console warn（Task 11/12），未做使用者可見提示 UI——列為實作期可補強項，不影響 MVP 核心流程。
