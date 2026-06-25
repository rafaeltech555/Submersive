# NetflixAdapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 Submersive 在 Netflix 上做逐行雙語字幕——讀 Netflix 已渲染的字幕 DOM、在原生字幕下方注入譯文。

**Architecture:** Netflix 自成一條 ISOLATED-world content 流程（`netflix-content.ts`），用 `MutationObserver` 讀 `.player-timedtext` 的當前原文行，逐行經 background 新增的 `TRANSLATE_LINE` 訊息翻譯（以原文為 key 的逐行 cache），再把譯文注入原生字幕容器下方。YouTube 既有流程（`content.ts` + hook + Overlay）完全不動，只共用 background 翻譯、`Notice`、`friendlyTranslateError`、`cache`、`types`。

**Tech Stack:** TypeScript、Vite + @crxjs、Vitest（純邏輯 TDD）、fake-indexeddb（cache 測試）、jsdom（DOM 純函式測試）、Playwright（整合層手動驗證）。

**Spec:** `docs/superpowers/specs/2026-06-25-netflix-adapter-design.md`

---

### Task 1: `lineCacheKey` 逐行 cache key（純函式）

**Files:**
- Modify: `src/core/cache-key.ts`
- Test: `tests/line-cache-key.test.ts`

- [ ] **Step 1: 寫失敗測試**

`tests/line-cache-key.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { lineCacheKey } from '../src/core/cache-key'
import { cacheKey } from '../src/core/cache-key'

describe('lineCacheKey', () => {
  it('以原文 + 語言 + engine 組 key，格式穩定', () => {
    expect(lineCacheKey('Hello', null, 'zh-TW', 'deepl')).toBe('line:auto>zh-TW|deepl|Hello')
    expect(lineCacheKey('Hi', 'en', 'zh-TW', 'local')).toBe('line:en>zh-TW|local|Hi')
  })

  it('不同原文 → 不同 key', () => {
    const a = lineCacheKey('Hello', null, 'zh-TW', 'deepl')
    const b = lineCacheKey('World', null, 'zh-TW', 'deepl')
    expect(a).not.toBe(b)
  })

  it('與整軌 cacheKey 命名空間不碰撞', () => {
    const line = lineCacheKey('Hello', null, 'zh-TW', 'deepl')
    const track = cacheKey('Hello', null, 'zh-TW', 'deepl') // videoId 剛好同字串也不該撞
    expect(line).not.toBe(track)
    expect(line.startsWith('line:')).toBe(true)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/line-cache-key.test.ts`
Expected: FAIL — `lineCacheKey` is not exported / not a function。

- [ ] **Step 3: 實作**

在 `src/core/cache-key.ts` 末尾加（檔案開頭已 `import type { EngineId } from '../types'`）：

```typescript
export function lineCacheKey(
  text: string,
  srcLang: string | null,
  targetLang: string,
  engine: EngineId,
): string {
  return `line:${srcLang ?? 'auto'}>${targetLang}|${engine}|${text}`
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/line-cache-key.test.ts`
Expected: PASS（3 tests）。

- [ ] **Step 5: Commit**

```bash
git add src/core/cache-key.ts tests/line-cache-key.test.ts
git commit -m "feat: lineCacheKey 逐行翻譯 cache key"
```

---

### Task 2: 新增 `TRANSLATE_LINE` 訊息型別

**Files:**
- Modify: `src/types.ts`（`Message` 聯集）

- [ ] **Step 1: 加型別**

在 `src/types.ts` 的 `Message` 聯集（現有三條 `TRANSLATE` / `TRANSLATE_RESULT` / `TRANSLATE_ERROR`）後面加三條：

```typescript
  | { type: 'TRANSLATE_LINE'; text: string; srcLang: string | null; targetLang: string; engine: EngineId }
  | { type: 'TRANSLATE_LINE_RESULT'; text: string; translated: string }
  | { type: 'TRANSLATE_LINE_ERROR'; text: string; error: string }
```

- [ ] **Step 2: 確認型別檢查通過**

Run: `npx tsc --noEmit`
Expected: 無錯誤（純加聯集成員，不影響既有）。

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: TRANSLATE_LINE 訊息型別"
```

---

### Task 3: `translateLineCached` cache 包裝（純邏輯，可注入翻譯函式）

**Files:**
- Create: `src/background/translate-line.ts`
- Test: `tests/translate-line.test.ts`

- [ ] **Step 1: 寫失敗測試**

`tests/translate-line.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { translateLineCached } from '../src/background/translate-line'
import { clearCache } from '../src/core/cache'

beforeEach(async () => { await clearCache() })

describe('translateLineCached', () => {
  it('cache miss 時呼叫 doTranslate 並寫入', async () => {
    let calls = 0
    const doTranslate = async (t: string) => { calls++; return '譯:' + t }
    const out = await translateLineCached('Hi', null, 'zh-TW', 'deepl', doTranslate)
    expect(out).toBe('譯:Hi')
    expect(calls).toBe(1)
  })

  it('cache hit 時不再呼叫 doTranslate', async () => {
    let calls = 0
    const doTranslate = async (t: string) => { calls++; return '譯:' + t }
    await translateLineCached('Hi', null, 'zh-TW', 'deepl', doTranslate)
    const again = await translateLineCached('Hi', null, 'zh-TW', 'deepl', doTranslate)
    expect(again).toBe('譯:Hi')
    expect(calls).toBe(1)
  })

  it('不同 engine 各自 cache', async () => {
    let calls = 0
    const doTranslate = async (t: string) => { calls++; return '譯:' + t }
    await translateLineCached('Hi', null, 'zh-TW', 'deepl', doTranslate)
    await translateLineCached('Hi', null, 'zh-TW', 'local', doTranslate)
    expect(calls).toBe(2)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/translate-line.test.ts`
Expected: FAIL — 找不到 `src/background/translate-line`。

- [ ] **Step 3: 實作**

`src/background/translate-line.ts`：

```typescript
import type { EngineId } from '../types'
import { lineCacheKey } from '../core/cache-key'
import { getCached, putCached } from '../core/cache'

// 逐行翻譯的 cache 包裝：先查 cache，miss 才呼叫 doTranslate 並寫入。
// doTranslate 注入，方便單元測試（不依賴真 adapter / fetch / chrome.storage）。
export async function translateLineCached(
  text: string,
  srcLang: string | null,
  targetLang: string,
  engine: EngineId,
  doTranslate: (text: string) => Promise<string>,
): Promise<string> {
  const key = lineCacheKey(text, srcLang, targetLang, engine)
  const hit = await getCached(key)
  if (hit && hit[0]?.translated != null) return hit[0].translated
  const translated = await doTranslate(text)
  await putCached(key, [{ start: 0, dur: 0, text, translated }])
  return translated
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/translate-line.test.ts`
Expected: PASS（3 tests）。

- [ ] **Step 5: Commit**

```bash
git add src/background/translate-line.ts tests/translate-line.test.ts
git commit -m "feat: translateLineCached 逐行翻譯 cache 包裝"
```

---

### Task 4: background 接 `TRANSLATE_LINE` handler

**Files:**
- Modify: `src/background/background.ts`

- [ ] **Step 1: 加 import**

在 `src/background/background.ts` 既有 import 區加：

```typescript
import { translateLineCached } from './translate-line'
```

- [ ] **Step 2: 加逐行翻譯函式**

在 `src/background/background.ts` 既有 `translateWithCache` 函式定義之後、`chrome.runtime.onMessage.addListener` 之前，加：

```typescript
async function translateLine(
  text: string, srcLang: string | null, targetLang: string, engine: EngineId,
): Promise<string> {
  return translateLineCached(text, srcLang, targetLang, engine, async (t) => {
    const adapter = await pickAdapter(engine)
    const [translated] = await runWithRetry(
      () => adapter.translateBatch([t], srcLang, targetLang),
      { retries: 3, baseMs: 500 },
    )
    if (translated == null) throw new Error('translation empty')
    return translated
  })
}
```

- [ ] **Step 3: 改 listener 同時處理兩種訊息**

把 `src/background/background.ts` 既有的 listener：

```typescript
chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  if (msg.type !== 'TRANSLATE') return
  translateWithCache(msg.videoId, msg.cues, msg.srcLang, msg.targetLang, msg.engine)
    .then((cues) => sendResponse({ type: 'TRANSLATE_RESULT', videoId: msg.videoId, cues }))
    .catch((e) => sendResponse({ type: 'TRANSLATE_ERROR', videoId: msg.videoId, error: String(e) }))
  return true
})
```

改為：

```typescript
chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  if (msg.type === 'TRANSLATE') {
    translateWithCache(msg.videoId, msg.cues, msg.srcLang, msg.targetLang, msg.engine)
      .then((cues) => sendResponse({ type: 'TRANSLATE_RESULT', videoId: msg.videoId, cues }))
      .catch((e) => sendResponse({ type: 'TRANSLATE_ERROR', videoId: msg.videoId, error: String(e) }))
    return true
  }
  if (msg.type === 'TRANSLATE_LINE') {
    translateLine(msg.text, msg.srcLang, msg.targetLang, msg.engine)
      .then((translated) => sendResponse({ type: 'TRANSLATE_LINE_RESULT', text: msg.text, translated }))
      .catch((e) => sendResponse({ type: 'TRANSLATE_LINE_ERROR', text: msg.text, error: String(e) }))
    return true
  }
})
```

- [ ] **Step 4: 確認型別檢查與既有測試通過**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 無錯誤；全套測試 PASS（含 Task 1/3 新測試）。

- [ ] **Step 5: Commit**

```bash
git add src/background/background.ts
git commit -m "feat: background 接 TRANSLATE_LINE handler"
```

---

### Task 5: Netflix DOM 選擇器常數

**Files:**
- Create: `src/sites/netflix/dom.ts`

- [ ] **Step 1: 建常數檔**

`src/sites/netflix/dom.ts`：

```typescript
// Netflix 非公開 DOM 選擇器集中於此，改版時單點維護。
export const SUBTITLE_CONTAINER = '.player-timedtext'
export const NATIVE_TEXT = '.player-timedtext-text-container'
export const PLAYER_ROOT = '.watch-video'
export const INJECTED_ID = 'submersive-netflix-line'
```

- [ ] **Step 2: 確認型別檢查通過**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 3: Commit**

```bash
git add src/sites/netflix/dom.ts
git commit -m "feat: Netflix DOM 選擇器常數"
```

---

### Task 6: `extractLineText` 純函式（jsdom 測試）

**Files:**
- Create: `src/sites/netflix/subtitle-observer.ts`（先只放 `extractLineText`）
- Test: `tests/netflix-extract-line.test.ts`
- Modify: `package.json`（加 jsdom devDep）

- [ ] **Step 1: 安裝 jsdom**

Run: `npm i -D jsdom`
Expected: `jsdom` 進 devDependencies。

- [ ] **Step 2: 寫失敗測試**

`tests/netflix-extract-line.test.ts`（檔案第一行指定 jsdom 環境）：

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { extractLineText } from '../src/sites/netflix/subtitle-observer'

function makeContainer(html: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'player-timedtext'
  el.innerHTML = html
  return el
}

describe('extractLineText', () => {
  it('抽出原生字幕容器的文字（多容器以換行接）', () => {
    const c = makeContainer(`
      <div class="player-timedtext-text-container"><span>Hello there</span></div>
      <div class="player-timedtext-text-container"><span>second line</span></div>
    `)
    expect(extractLineText(c)).toBe('Hello there\nsecond line')
  })

  it('合併多餘空白、忽略空容器', () => {
    const c = makeContainer(`
      <div class="player-timedtext-text-container"><span>  Hello   world </span></div>
      <div class="player-timedtext-text-container"></div>
    `)
    expect(extractLineText(c)).toBe('Hello world')
  })

  it('忽略我們自己注入的譯文節點（避免回授）', () => {
    const c = makeContainer(`
      <div class="player-timedtext-text-container"><span>Original</span></div>
      <div id="submersive-netflix-line">譯文不該被讀到</div>
    `)
    expect(extractLineText(c)).toBe('Original')
  })

  it('null 或無原生容器回空字串', () => {
    expect(extractLineText(null)).toBe('')
    expect(extractLineText(makeContainer('<div>無關</div>'))).toBe('')
  })
})
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `npx vitest run tests/netflix-extract-line.test.ts`
Expected: FAIL — 找不到 `extractLineText`。

- [ ] **Step 4: 實作**

`src/sites/netflix/subtitle-observer.ts`：

```typescript
import { NATIVE_TEXT } from './dom'

// 只讀 Netflix 原生字幕容器（.player-timedtext-text-container），
// 刻意排除我們注入的譯文節點，避免回授。多容器以換行接。
export function extractLineText(root: Element | null): string {
  if (!root) return ''
  const parts: string[] = []
  root.querySelectorAll(NATIVE_TEXT).forEach((el) => {
    const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (t) parts.push(t)
  })
  return parts.join('\n')
}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npx vitest run tests/netflix-extract-line.test.ts`
Expected: PASS（4 tests）。

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/sites/netflix/subtitle-observer.ts tests/netflix-extract-line.test.ts
git commit -m "feat: extractLineText 讀 Netflix 原生字幕文字"
```

---

### Task 7: `SubtitleObserver` 監看字幕變更

**Files:**
- Modify: `src/sites/netflix/subtitle-observer.ts`（在 `extractLineText` 之後加 class）

- [ ] **Step 1: 加 class**

在 `src/sites/netflix/subtitle-observer.ts`（`extractLineText` 之後）加：

```typescript
// 監看字幕容器，當前原文行變更時回呼（空字串代表清空）。
// 注入譯文造成的 mutation 因 extractLineText 排除注入節點 + last 去重，不會回授。
export class SubtitleObserver {
  private mo: MutationObserver | null = null
  private last = ''

  constructor(
    private getContainer: () => Element | null,
    private onLine: (text: string) => void,
  ) {}

  start(): boolean {
    const container = this.getContainer()
    if (!container) return false
    this.mo = new MutationObserver(() => this.check(container))
    this.mo.observe(container, { childList: true, subtree: true, characterData: true })
    this.check(container)
    return true
  }

  private check(container: Element) {
    const text = extractLineText(container)
    if (text === this.last) return
    this.last = text
    this.onLine(text)
  }

  stop() {
    this.mo?.disconnect()
    this.mo = null
    this.last = ''
  }
}
```

- [ ] **Step 2: 確認型別檢查與既有測試通過**

Run: `npx tsc --noEmit && npx vitest run tests/netflix-extract-line.test.ts`
Expected: tsc 無錯誤；extractLineText 測試仍 PASS。

- [ ] **Step 3: Commit**

```bash
git add src/sites/netflix/subtitle-observer.ts
git commit -m "feat: SubtitleObserver 監看 Netflix 字幕變更"
```

---

### Task 8: `Injector` 注入譯文行

**Files:**
- Create: `src/sites/netflix/injector.ts`

- [ ] **Step 1: 實作**

`src/sites/netflix/injector.ts`：

```typescript
import { INJECTED_ID } from './dom'

// 在 Netflix 原生字幕容器內注入/更新一行譯文（位於原生字幕節點之後）。
// 不依賴注入節點長存：每次 setTranslation 都重新確保節點存在（React 重渲染會沖掉）。
export class Injector {
  constructor(private getContainer: () => Element | null) {}

  setTranslation(text: string) {
    const container = this.getContainer()
    if (!container) return
    let el = container.querySelector('#' + INJECTED_ID) as HTMLElement | null
    if (!el) {
      el = document.createElement('div')
      el.id = INJECTED_ID
      Object.assign(el.style, {
        textAlign: 'center', color: '#fff', fontSize: '110%',
        textShadow: '0 0 4px #000', marginTop: '2px', pointerEvents: 'none',
      } as Partial<CSSStyleDeclaration>)
      container.appendChild(el)
    }
    el.textContent = text
  }

  clear() {
    this.getContainer()?.querySelector('#' + INJECTED_ID)?.remove()
  }
}
```

- [ ] **Step 2: 確認型別檢查通過**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 3: Commit**

```bash
git add src/sites/netflix/injector.ts
git commit -m "feat: Injector 注入 Netflix 譯文行"
```

---

### Task 9: `player.ts` 定位與 videoId

**Files:**
- Create: `src/sites/netflix/player.ts`

- [ ] **Step 1: 實作**

`src/sites/netflix/player.ts`：

```typescript
import { SUBTITLE_CONTAINER, PLAYER_ROOT } from './dom'

// videoId 取自 /watch/<id>
export function getVideoId(): string | null {
  const m = location.pathname.match(/\/watch\/(\d+)/)
  return m ? m[1] : null
}

export function getContainer(): Element | null {
  return document.querySelector(SUBTITLE_CONTAINER)
}

export function getVideoElement(): HTMLVideoElement | null {
  return document.querySelector('video')
}

// Notice 的 anchor：播放器根容器（需為 positioned 祖先）。
export function getPlayerRoot(): HTMLElement | null {
  return (document.querySelector(PLAYER_ROOT) as HTMLElement | null)
    ?? (getVideoElement()?.parentElement ?? null)
}
```

- [ ] **Step 2: 確認型別檢查通過**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 3: Commit**

```bash
git add src/sites/netflix/player.ts
git commit -m "feat: Netflix player 定位與 videoId"
```

---

### Task 10: `netflix-content.ts` 編排

**Files:**
- Create: `src/content/netflix-content.ts`

- [ ] **Step 1: 實作**

`src/content/netflix-content.ts`：

```typescript
import { loadSettings } from '../core/settings-store'
import { Notice } from './notice'
import { friendlyTranslateError } from '../core/translate-error'
import { getVideoId, getContainer, getVideoElement, getPlayerRoot } from '../sites/netflix/player'
import { SubtitleObserver } from '../sites/netflix/subtitle-observer'
import { Injector } from '../sites/netflix/injector'

const NO_SUBTITLE_TIMEOUT_MS = 5000

;(async () => {
  const settings = await loadSettings()
  const notice = new Notice(getPlayerRoot)
  const injector = new Injector(getContainer)
  const observer = new SubtitleObserver(getContainer, onLine)

  let currentVideoId: string | null = null
  let currentLine = ''
  let gotLine = false
  let noSubTimer: number | undefined
  let poll: number | undefined
  let pollTimeout: number | undefined
  let watchedVideo: HTMLVideoElement | null = null
  let lastErrorMsg = ''
  let lastErrorAt = 0

  const clearNoSubTimer = () => {
    if (noSubTimer !== undefined) { clearTimeout(noSubTimer); noSubTimer = undefined }
  }
  const clearPoll = () => {
    if (poll !== undefined) { clearInterval(poll); poll = undefined }
    if (pollTimeout !== undefined) { clearTimeout(pollTimeout); pollTimeout = undefined }
  }

  const armNoSubTimer = () => {
    if (noSubTimer !== undefined || gotLine) return
    noSubTimer = window.setTimeout(() => {
      noSubTimer = undefined
      if (!gotLine) notice.show('請開啟字幕以啟用雙語翻譯')
    }, NO_SUBTITLE_TIMEOUT_MS)
  }

  async function onLine(text: string) {
    currentLine = text
    if (text === '') { injector.clear(); return }
    gotLine = true
    clearNoSubTimer()
    notice.hide()

    const expectedLine = text
    const expectedVid = currentVideoId
    const res = (await chrome.runtime.sendMessage({
      type: 'TRANSLATE_LINE', text, srcLang: null,
      targetLang: settings.targetLang, engine: settings.engine,
    })) as { type: string; translated?: string; error?: string }

    // 換行或換片就丟棄（避免舊行譯文蓋到新行/新片）
    if (currentLine !== expectedLine || currentVideoId !== expectedVid) return

    if (res?.type === 'TRANSLATE_LINE_RESULT' && res.translated != null) {
      injector.setTranslation(res.translated)
    } else {
      console.warn('[submersive] netflix translate failed', res?.error)
      // 防洪：同訊息 6s 內不重彈
      const msg = friendlyTranslateError(res?.error)
      const now = Date.now()
      if (msg !== lastErrorMsg || now - lastErrorAt > 6000) {
        lastErrorMsg = msg
        lastErrorAt = now
        notice.show(msg, { autoHideMs: 6000 })
      }
    }
  }

  const attachPlayingListener = (): boolean => {
    const v = getVideoElement()
    if (!v) return false
    if (watchedVideo !== v) {
      if (watchedVideo) watchedVideo.removeEventListener('playing', armNoSubTimer)
      v.addEventListener('playing', armNoSubTimer)
      watchedVideo = v
    }
    if (!v.paused) armNoSubTimer()
    return true
  }

  // 反覆嘗試直到 video + 字幕容器出現（最多 ~30s）；容器出現才掛 observer。
  const startWatching = () => {
    clearPoll()
    const tryStart = (): boolean => {
      attachPlayingListener()
      if (getContainer()) { observer.start(); return true }
      return false
    }
    if (tryStart()) return
    poll = window.setInterval(() => { if (tryStart()) clearPoll() }, 500)
    pollTimeout = window.setTimeout(() => clearPoll(), 30000)
  }

  // 初始 + SPA 換片：Netflix 無 yt-navigate-finish，靠 videoId 輪詢比對。
  const onVideoMaybeChanged = () => {
    const id = getVideoId()
    if (id === currentVideoId) return
    currentVideoId = id
    observer.stop()
    injector.clear()
    gotLine = false
    currentLine = ''
    clearNoSubTimer()
    clearPoll()
    notice.hide()
    if (id) startWatching()
  }

  onVideoMaybeChanged()
  window.setInterval(onVideoMaybeChanged, 1000)

  console.log('[submersive] netflix content ready')
})()
```

- [ ] **Step 2: 確認型別檢查通過**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 3: Commit**

```bash
git add src/content/netflix-content.ts
git commit -m "feat: netflix-content 編排逐行雙語注入"
```

---

### Task 11: manifest 加 Netflix content script

**Files:**
- Modify: `src/manifest.ts`

- [ ] **Step 1: 加 host_permissions**

在 `src/manifest.ts` 的 `host_permissions` 陣列加一行（放在 youtube 之後）：

```typescript
    'https://*.netflix.com/*',
```

- [ ] **Step 2: 加 content script**

在 `src/manifest.ts` 的 `content_scripts` 陣列尾端（YouTube 兩條之後）加一條：

```typescript
    {
      matches: ['https://*.netflix.com/*'],
      js: ['src/content/netflix-content.ts'],
      run_at: 'document_idle',
      world: 'ISOLATED',
    },
```

- [ ] **Step 3: build 確認 manifest 正確產出**

Run: `npm run build`
Expected: build 成功；`dist/manifest.json` 的 `content_scripts` 出現 netflix 那條、`host_permissions` 含 `https://*.netflix.com/*`。

Run: `node -e "const m=require('./dist/manifest.json'); console.log(JSON.stringify(m.content_scripts.map(c=>c.matches))); console.log(m.host_permissions.includes('https://*.netflix.com/*'))"`
Expected: 印出三組 matches（含 netflix）、最後一行 `true`。

- [ ] **Step 4: Commit**

```bash
git add src/manifest.ts
git commit -m "feat: manifest 加 Netflix content script 與權限"
```

---

### Task 12: 整合層手動驗證（Playwright + 合成 Netflix DOM 頁）

**Files:**
- Create: 驗證 harness（放 scratchpad，不入庫）

說明：真實 Netflix 需登入 + DRM，難全自動。沿用先前 YouTube 字幕狀態提示驗證建好的 Playwright harness 模式——載入真實 built extension + 一個合成「Netflix 形狀」DOM 頁，驗 observer→translate→inject、SPA reset、無字幕 timer、失敗提示。

- [ ] **Step 1: 重建並確認 dist 反映最新源碼**

Run: `npm run build`
Expected: build 成功。

- [ ] **Step 2: 準備 ext 副本（放寬 match 到 localhost）**

把 `dist` 複製到 scratchpad，patch `manifest.json`：在 netflix 那條 content_scripts 的 `matches`、`host_permissions`、`web_accessible_resources[].matches` 各加 `http://localhost/*`（與 YouTube 驗證同手法——只改程式在哪跑，不改被測碼）。

- [ ] **Step 3: 合成 Netflix 頁**

做一個本機頁：URL `/watch/111?...`（讓 `getVideoId` 抓到 `111`），含 `.watch-video` 根容器、`<video>`、可由 Playwright 動態建立/移除 `.player-timedtext > .player-timedtext-text-container > span` 來模擬字幕行出現/換行/清空，並能 `history.pushState` 到 `/watch/222` 模擬 SPA 換片。本機 server 兼當 LibreTranslate `/translate`（回 `{translatedText:'【譯】'+q}`），engine 設 `local`、localUrl 指向本機 server 使翻譯成功；另設不可連 localUrl 驗失敗提示。

- [ ] **Step 4: 跑 5 個驗證情境並截圖**

驅動腳本依序驗：
1. 建立一行原文 → 約 1~2s 後該行下方出現 `#submersive-netflix-line` 譯文（`【譯】…`）；換到新原文行 → 譯文跟著換、不殘留舊行。
2. video `playing` 但不建任何字幕 → 約 5s 後 `Notice` 出現「請開啟字幕以啟用雙語翻譯」；接著建第一行字幕 → 提示消失、出譯文。
3. localUrl 指向不可連 → 出現翻譯失敗提示、6s 自動消失；連續多行失敗時不每行洪水彈（同訊息 6s 內不重彈）。
4. `pushState` 到 `/watch/222` → 舊提示/舊譯文清空（約 1s 內 videoId 輪詢偵測）；新片建字幕 → 正常逐行雙語。
5. 同一行原文出現兩次（清空再出現同字串）→ 第二次走 cache（background 不再打 `/translate`，由 server log 或 mock 計數佐證）。

各情境截圖存 scratchpad，逐一肉眼確認。

- [ ] **Step 5: 全套單元測試最終回歸**

Run: `npx vitest run`
Expected: 全套 PASS（含本計畫新增的 line-cache-key / translate-line / netflix-extract-line）。

- [ ] **Step 6: 記錄驗證結果**

把 5 情境的 PASS/FAIL + 截圖路徑 + 任何 Netflix 真實 DOM 待核對項（選擇器是否對得上）記到驗證回報；真實 Netflix live smoke 列為後續待辦（需登入環境）。

---

## 已知限制（寫入後續待辦，非本計畫範圍）

- **真實 Netflix live smoke 未做**：合成頁驗證涵蓋邏輯，但 `.player-timedtext` / `.player-timedtext-text-container` / `.watch-video` 等選擇器需在真實 Netflix 核對；對不上時集中於 `src/sites/netflix/dom.ts` 修。
- **啟用字幕晚於 30s**：容器輪詢 30s 後停；若使用者超過 30s 才開字幕，observer 不會啟動（沿用 YouTube poll 慣例的同限制）。
- **overlay 樣式設定不適用 Netflix**：僅 `targetLang` + `engine` 生效（spec 已載明）。
