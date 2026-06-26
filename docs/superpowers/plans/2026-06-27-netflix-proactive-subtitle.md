# Netflix proactive 字幕架構 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 NetflixAdapter 從 reactive DOM 觀察改成 proactive：MAIN world 攔 TTML → 整集預翻 → 時間驅動 `Overlay` 顯示，同時自動隱藏原生 CC，與 YouTubeAdapter 結構對齊。

**Architecture:** 新增 hook (`netflix-hook.ts`)、imsc parser (`imsc-parser.ts`)、native-cc 工具 (`native-cc.ts`)、`NetflixAdapter`（實作 `SiteAdapter`）。重寫 `netflix-content.ts` 對齊 YouTube 結構，用 `Overlay` 取代 `Injector`。棄用 `subtitle-observer.ts` / `injector.ts`。

**Tech Stack:** TypeScript、Vite + @crxjs、Vitest（TDD）、DOMParser（imsc 解析）、Chrome MV3 MAIN world content_scripts。

**Spec:** `docs/superpowers/specs/2026-06-26-netflix-proactive-subtitle-design.md`

---

### Task 1: imsc parser（TDD，純函式）

**Files:**
- Create: `src/sites/netflix/imsc-parser.ts`
- Test: `tests/netflix-imsc-parser.test.ts`

- [ ] **Step 1: 寫測試（RED）** — Create `tests/netflix-imsc-parser.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { parseImsc } from '../src/sites/netflix/imsc-parser'

describe('parseImsc', () => {
  it('parses standard TTML with multiple cues', () => {
    const xml = `<?xml version="1.0"?>
<tt xmlns="http://www.w3.org/ns/ttml">
  <body><div>
    <p begin="00:00:01.000" end="00:00:03.000">Hello</p>
    <p begin="00:00:04.500" end="00:00:06.500">World</p>
  </div></body>
</tt>`
    const cues = parseImsc(xml)
    expect(cues).toEqual([
      { start: 1, dur: 2, text: 'Hello' },
      { start: 4.5, dur: 2, text: 'World' },
    ])
  })

  it('handles <br/> as line break', () => {
    const xml = `<?xml version="1.0"?>
<tt><body><div>
  <p begin="00:00:01.000" end="00:00:02.000">Line one<br/>Line two</p>
</div></body></tt>`
    const cues = parseImsc(xml)
    expect(cues).toHaveLength(1)
    expect(cues[0].text).toBe('Line one\nLine two')
  })

  it('skips cues with malformed time and warns', () => {
    const xml = `<?xml version="1.0"?>
<tt><body><div>
  <p begin="bogus" end="00:00:02.000">A</p>
  <p begin="00:00:03.000" end="00:00:05.000">B</p>
</div></body></tt>`
    expect(parseImsc(xml)).toEqual([{ start: 3, dur: 2, text: 'B' }])
  })

  it('returns [] for malformed XML', () => {
    expect(parseImsc('not <<xml>>')).toEqual([])
  })

  it('returns [] for TTML without <p>', () => {
    expect(parseImsc('<?xml version="1.0"?><tt><body><div></div></body></tt>')).toEqual([])
  })
})
```

- [ ] **Step 2: 跑測試確認 RED**

Run: `npx vitest run tests/netflix-imsc-parser.test.ts`
Expected: 5 個 test 全 FAIL（`parseImsc` 不存在）。

- [ ] **Step 3: 寫實作** — Create `src/sites/netflix/imsc-parser.ts`:

```typescript
import type { Cue } from '../../types'

// 解析 HH:MM:SS.mmm 為秒。失敗回 NaN。
function parseTime(s: string): number {
  const m = s.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/)
  if (!m) return NaN
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000
}

// 從 <p> 抽文字：text node 直收、<br/> 轉 \n、其他子元素遞迴文字內容。
function pToText(p: Element): string {
  let out = ''
  for (const child of Array.from(p.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) out += child.textContent ?? ''
    else if ((child as Element).tagName?.toLowerCase() === 'br') out += '\n'
    else out += (child as Element).textContent ?? ''
  }
  return out.trim()
}

// 解析 Netflix imsc1.1/TTML XML，回 Cue[]。XML 失敗、無 <p>、無有效時間皆回 []。
export function parseImsc(xml: string): Cue[] {
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml')
  } catch {
    console.warn('[submersive] imsc parse threw')
    return []
  }
  if (doc.querySelector('parsererror')) {
    console.warn('[submersive] imsc parsererror')
    return []
  }
  const cues: Cue[] = []
  doc.querySelectorAll('p').forEach((p) => {
    const begin = p.getAttribute('begin')
    const end = p.getAttribute('end')
    if (!begin || !end) return
    const start = parseTime(begin)
    const eEnd = parseTime(end)
    if (Number.isNaN(start) || Number.isNaN(eEnd) || eEnd <= start) {
      console.warn('[submersive] imsc cue invalid time, skipped', begin, end)
      return
    }
    const text = pToText(p)
    if (!text) return
    cues.push({ start, dur: eEnd - start, text })
  })
  return cues
}
```

- [ ] **Step 4: 跑測試確認 GREEN**

Run: `npx vitest run tests/netflix-imsc-parser.test.ts`
Expected: 5 個 test 全 PASS。

- [ ] **Step 5: 整套迴歸**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean；全套 PASS（既有 45 + 新 5 = 50）。

- [ ] **Step 6: Commit**

```bash
git add src/sites/netflix/imsc-parser.ts tests/netflix-imsc-parser.test.ts
git commit -m "feat: Netflix imsc/TTML parser（5 TDD cases）"
```

---

### Task 2: native-cc 隱藏工具

**Files:**
- Create: `src/sites/netflix/native-cc.ts`

> 不寫單元測試——`<style>` 注入是 DOM 副作用，整合層手動驗證足夠。

- [ ] **Step 1: 寫實作** — Create `src/sites/netflix/native-cc.ts`:

```typescript
const STYLE_ID = 'submersive-hide-native-cc'

// 注入 <style> 隱藏 Netflix 原生字幕容器；已存在則不重複加（idempotent）。
export function hideNativeCc(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = '.player-timedtext { display: none !important }'
  document.head.appendChild(style)
}

// 移除上面注入的 <style>，原生字幕回復；不存在則 no-op。
export function showNativeCc(): void {
  document.getElementById(STYLE_ID)?.remove()
}
```

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
Expected: clean。

- [ ] **Step 3: Commit**

```bash
git add src/sites/netflix/native-cc.ts
git commit -m "feat: Netflix native-cc 隱藏/還原工具"
```

---

### Task 3: NetflixAdapter（TDD，整合 hook 訊息 + parser）

**Files:**
- Create: `src/sites/netflix-adapter.ts`
- Test: `tests/netflix-adapter.test.ts`

- [ ] **Step 1: 寫測試（RED）** — Create `tests/netflix-adapter.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NetflixAdapter } from '../src/sites/netflix-adapter'

describe('NetflixAdapter', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/watch/12345' },
      writable: true,
    })
  })

  it('emits parsed cues + ctx to subscribers on hook message', async () => {
    const adapter = new NetflixAdapter()
    const cb = vi.fn()
    adapter.onSubtitleTrack(cb)

    const xml = `<?xml version="1.0"?>
<tt><body><div>
  <p begin="00:00:01.000" end="00:00:03.000">Test</p>
</div></body></tt>`

    window.postMessage(
      { source: 'submersive-hook', kind: 'netflix-imsc', url: 'x', raw: xml },
      '*',
    )
    await new Promise((r) => setTimeout(r, 0))

    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith(
      [{ start: 1, dur: 2, text: 'Test' }],
      { videoId: '12345', srcLang: null },
    )
  })

  it('ignores non-submersive messages', async () => {
    const adapter = new NetflixAdapter()
    const cb = vi.fn()
    adapter.onSubtitleTrack(cb)

    window.postMessage({ source: 'other', raw: '<tt/>' }, '*')
    await new Promise((r) => setTimeout(r, 0))

    expect(cb).not.toHaveBeenCalled()
  })

  it('does not emit when parser returns []', async () => {
    const adapter = new NetflixAdapter()
    const cb = vi.fn()
    adapter.onSubtitleTrack(cb)

    window.postMessage(
      { source: 'submersive-hook', kind: 'netflix-imsc', url: 'x', raw: 'garbage' },
      '*',
    )
    await new Promise((r) => setTimeout(r, 0))

    expect(cb).not.toHaveBeenCalled()
  })

  it('detectVideo returns videoId from /watch/<id>', () => {
    const adapter = new NetflixAdapter()
    expect(adapter.detectVideo()).toEqual({ videoId: '12345', srcLang: null })
  })
})
```

- [ ] **Step 2: 跑測試確認 RED**

Run: `npx vitest run tests/netflix-adapter.test.ts`
Expected: FAIL — `NetflixAdapter` 不存在。

- [ ] **Step 3: 寫實作** — Create `src/sites/netflix-adapter.ts`:

```typescript
import type { SiteAdapter } from './site-adapter'
import type { Cue, VideoContext } from '../types'
import { parseImsc } from './netflix/imsc-parser'

export class NetflixAdapter implements SiteAdapter {
  private listeners: ((cues: Cue[], ctx: VideoContext) => void)[] = []

  constructor() {
    // hook 由 manifest 以 world:'MAIN' content script 自動注入，這裡只接收其廣播。
    window.addEventListener('message', (ev) => {
      const d = ev.data
      if (ev.source !== window || !d || d.source !== 'submersive-hook' || d.kind !== 'netflix-imsc') return
      const ctx = this.detectVideo()
      if (!ctx) { console.warn('[submersive] netflix 收到字幕但偵測不到 videoId，略過'); return }
      const cues = parseImsc(d.raw)
      if (cues.length) this.listeners.forEach((cb) => cb(cues, ctx))
    })
  }

  detectVideo(): VideoContext | null {
    const m = location.pathname.match(/\/watch\/(\d+)/)
    return m ? { videoId: m[1], srcLang: null } : null
  }

  onSubtitleTrack(cb: (cues: Cue[], ctx: VideoContext) => void): void {
    this.listeners.push(cb)
  }

  getVideoElement(): HTMLVideoElement | null {
    return document.querySelector('video')
  }

  getPlayerTime(): number {
    return this.getVideoElement()?.currentTime ?? 0
  }
}
```

- [ ] **Step 4: 跑測試確認 GREEN**

Run: `npx vitest run tests/netflix-adapter.test.ts`
Expected: 4 個 test 全 PASS。

- [ ] **Step 5: 整套迴歸**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean；全套 PASS（50 + 4 = 54）。

- [ ] **Step 6: Commit**

```bash
git add src/sites/netflix-adapter.ts tests/netflix-adapter.test.ts
git commit -m "feat: NetflixAdapter（SiteAdapter 介面，hook→parser→cue 廣播）"
```

---

### Task 4: Netflix MAIN world hook + manifest（原子）

**Files:**
- Create: `src/inject/netflix-hook.ts`
- Modify: `src/manifest.ts`

> 兩個檔耦合（manifest 引用 hook 路徑）；一起改才能在實際擴充內運作。無單元測試（DOM 全域 patch，整合層手動驗）。

- [ ] **Step 1: 寫 hook** — Create `src/inject/netflix-hook.ts`:

```typescript
// 注入到 Netflix 頁面 MAIN world，攔截字幕請求（Netflix 字幕從 *.nflxvideo.net 取）。
// 同時 patch fetch + XHR（Netflix 字幕走 XHR 機率較高）。

function maybeBroadcast(url: string, raw: string) {
  if (!raw) return
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith('<?xml') && !trimmed.startsWith('<tt')) return // 非字幕資源略過
  window.postMessage({ source: 'submersive-hook', kind: 'netflix-imsc', url, raw }, '*')
}

const origFetch = window.fetch
window.fetch = async function (...args: Parameters<typeof fetch>) {
  const res = await origFetch.apply(this, args)
  try {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url
    if (url && url.includes('nflxvideo')) {
      const clone = res.clone()
      clone.text().then((raw) => maybeBroadcast(url, raw)).catch(() => { /* 忽略讀取失敗 */ })
    }
  } catch { /* 不影響原請求 */ }
  return res
}

const xhrProto = XMLHttpRequest.prototype
const origOpen = xhrProto.open
xhrProto.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
  ;(this as XMLHttpRequest & { __submersiveUrl?: string }).__submersiveUrl =
    typeof url === 'string' ? url : String(url)
  // @ts-expect-error 透傳原生多載參數
  return origOpen.call(this, method, url, ...rest)
}
const origSend = xhrProto.send
xhrProto.send = function (this: XMLHttpRequest, ...args: unknown[]) {
  const url = (this as XMLHttpRequest & { __submersiveUrl?: string }).__submersiveUrl
  if (url && url.includes('nflxvideo')) {
    this.addEventListener('load', () => {
      try { maybeBroadcast(url, this.responseText) } catch { /* 忽略 */ }
    })
  }
  // @ts-expect-error 透傳原生多載參數
  return origSend.apply(this, args)
}

console.log('[submersive] netflix hook installed (fetch + XHR)')
```

- [ ] **Step 2: 改 manifest** — 在 `src/manifest.ts` 的 `content_scripts` 陣列**插入新 entry**（順序：放在既有 Netflix isolated entry **之前**，與 YouTube hook entry 對齊位置）。

把現有：
```typescript
    {
      matches: ['https://*.netflix.com/*'],
      js: ['src/content/netflix-content.ts'],
      run_at: 'document_idle',
      world: 'ISOLATED',
    },
```
改成（**前面**多一個 MAIN world entry）：
```typescript
    {
      matches: ['https://*.netflix.com/*'],
      js: ['src/inject/netflix-hook.ts'],
      run_at: 'document_start',
      world: 'MAIN',
    },
    {
      matches: ['https://*.netflix.com/*'],
      js: ['src/content/netflix-content.ts'],
      run_at: 'document_idle',
      world: 'ISOLATED',
    },
```

- [ ] **Step 3: build + 型別 + 測試確認**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: 全 clean；`dist/manifest.json` 應有 4 條 content_scripts、其中一條為 `netflix-hook` MAIN world。

- [ ] **Step 4: 驗 build 產物 manifest**

Run: `grep -c '"world": "MAIN"' dist/manifest.json`
Expected: `2`（YouTube hook + Netflix hook）。

- [ ] **Step 5: Commit**

```bash
git add src/inject/netflix-hook.ts src/manifest.ts
git commit -m "feat: Netflix MAIN world hook + manifest entry（攔 nflxvideo 字幕 XHR/fetch）"
```

---

### Task 5: 重寫 netflix-content.ts（對齊 YouTube 結構）

**Files:**
- Modify: `src/content/netflix-content.ts`（整檔取代）

- [ ] **Step 1: 整檔取代** `src/content/netflix-content.ts`:

```typescript
import { NetflixAdapter } from '../sites/netflix-adapter'
import { Overlay } from './overlay'
import { Notice } from './notice'
import { ToggleButton } from './toggle-button'
import { loadSettings } from '../core/settings-store'
import { loadMode, saveMode, type ImmersiveMode } from '../core/toggle-store'
import { friendlyTranslateError } from '../core/translate-error'
import { hideNativeCc, showNativeCc } from '../sites/netflix/native-cc'
import { getPlayerRoot, getVideoElement, getVideoId } from '../sites/netflix/player'
import type { Cue, VideoContext } from '../types'

const NO_CUES_TIMEOUT_MS = 5000

;(async () => {
  const settings = await loadSettings()
  let mode = await loadMode()
  const site = new NetflixAdapter()
  const anchor = getPlayerRoot
  const overlay = new Overlay(() => site.getPlayerTime(), anchor)
  overlay.applySettings(settings)
  const notice = new Notice(anchor)

  let gotCues = false
  let timer: number | undefined
  let poll: number | undefined
  let pollTimeout: number | undefined
  let watchedVideo: HTMLVideoElement | null = null
  let currentVideoId: string | null = null
  let lastCues: Cue[] | null = null
  let lastCtx: VideoContext | null = null

  const clearTimer = () => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined }
  }
  const clearPoll = () => {
    if (poll !== undefined) { clearInterval(poll); poll = undefined }
    if (pollTimeout !== undefined) { clearTimeout(pollTimeout); pollTimeout = undefined }
  }

  const armNoCuesTimer = () => {
    if (timer !== undefined || gotCues || mode === 'off') return
    timer = window.setTimeout(() => {
      timer = undefined
      if (!gotCues && mode !== 'off') notice.show('請開啟字幕以啟用沉浸字幕')
    }, NO_CUES_TIMEOUT_MS)
  }

  // 翻譯整軌並顯示雙語；非 bilingual 或已換片時放棄。
  const translateAndShow = async (cues: Cue[], ctx: VideoContext) => {
    const expectedId = ctx.videoId
    const res = (await chrome.runtime.sendMessage({
      type: 'TRANSLATE', videoId: ctx.videoId, srcLang: ctx.srcLang,
      targetLang: settings.targetLang, engine: settings.engine, cues,
    })) as { type: string; cues?: Cue[]; error?: string }
    if (currentVideoId !== expectedId || mode !== 'bilingual') return
    if (res?.type === 'TRANSLATE_RESULT' && res.cues) {
      overlay.setCues(res.cues)
      overlay.setBilingual(true)
    } else {
      console.warn('[submersive] netflix translate failed', res?.error)
      notice.show(friendlyTranslateError(res?.error), { autoHideMs: 6000 })
    }
  }

  // 套用 mode 到目前畫面 + 控制原生 CC 顯示。translateAndShow 為 fire-and-forget。
  const applyMode = (m: ImmersiveMode) => {
    mode = m
    if (m === 'off') { overlay.unmount(); showNativeCc(); return }
    hideNativeCc()
    overlay.setOriginalOnly(m === 'original')
    overlay.setBilingual(false)
    if (lastCues) overlay.setCues(lastCues)
    overlay.mount()
    if (m === 'bilingual' && lastCues && lastCtx) translateAndShow(lastCues, lastCtx)
  }

  // 啟動時就依目前 mode 決定原生 CC 狀態。
  if (mode !== 'off') hideNativeCc()

  const toggle = new ToggleButton(anchor, (m) => { applyMode(m); saveMode(m) }, mode)

  // 其他分頁改了 mode → 同步本頁。
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.immersiveMode) return
    const m = (changes.immersiveMode.newValue ?? 'bilingual') as ImmersiveMode
    toggle.setMode(m)
    applyMode(m)
  })

  const attachPlayingListener = (): boolean => {
    const v = getVideoElement()
    if (!v) return false
    toggle.mount()
    if (watchedVideo !== v) {
      if (watchedVideo) watchedVideo.removeEventListener('playing', armNoCuesTimer)
      v.addEventListener('playing', armNoCuesTimer)
      watchedVideo = v
    }
    if (!v.paused) armNoCuesTimer()
    return true
  }

  const startWatching = () => {
    clearPoll()
    if (attachPlayingListener()) return
    poll = window.setInterval(() => {
      if (attachPlayingListener()) clearPoll()
    }, 500)
    pollTimeout = window.setTimeout(() => clearPoll(), 30000)
  }

  const onVideoMaybeChanged = () => {
    const id = getVideoId()
    if (id === currentVideoId) return
    currentVideoId = id
    gotCues = false
    lastCues = null
    lastCtx = null
    clearTimer()
    clearPoll()
    notice.hide()
    overlay.setBilingual(false)
    if (id) startWatching()
  }

  onVideoMaybeChanged()
  window.setInterval(onVideoMaybeChanged, 1000)

  site.onSubtitleTrack(async (cues, ctx) => {
    gotCues = true
    clearTimer()
    notice.hide()
    lastCues = cues
    lastCtx = ctx
    if (mode === 'off') return
    overlay.setCues(cues)
    overlay.setOriginalOnly(mode === 'original')
    overlay.setBilingual(false)
    overlay.mount()
    if (mode === 'bilingual') await translateAndShow(cues, ctx)
  })

  console.log('[submersive] netflix content ready')
})()
```

- [ ] **Step 2: 型別 + 全套測試**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean；全套 PASS（54）。**注意**：`subtitle-observer.ts` / `injector.ts` 仍在但已成 dead code，tsc 不報錯（沒人 import 它們）；`netflix-extract-line.test.ts` 仍會跑 PASS（它直接 import `extractLineText`）。

- [ ] **Step 3: Commit**

```bash
git add src/content/netflix-content.ts
git commit -m "refactor: 重寫 netflix-content.ts 走 NetflixAdapter + Overlay + native-cc"
```

---

### Task 6: 刪除 reactive 路線 dead code

**Files:**
- Delete: `src/sites/netflix/subtitle-observer.ts`
- Delete: `src/sites/netflix/injector.ts`
- Delete: `tests/netflix-extract-line.test.ts`
- Modify: `src/sites/netflix/dom.ts`（移除廢棄 export）
- Modify: `src/sites/netflix/player.ts`（移除 `getContainer`）

- [ ] **Step 1: 刪檔**

```bash
git rm src/sites/netflix/subtitle-observer.ts
git rm src/sites/netflix/injector.ts
git rm tests/netflix-extract-line.test.ts
```

- [ ] **Step 2: 整檔取代** `src/sites/netflix/dom.ts`:

```typescript
// Netflix 非公開 DOM 選擇器集中於此，改版時單點維護。
export const PLAYER_ROOT = '.watch-video'
```

> `SUBTITLE_CONTAINER` / `NATIVE_TEXT` / `INJECTED_ID` 已隨 reactive 路線退場。`PLAYER_ROOT` 仍被 `player.ts` 使用。

- [ ] **Step 3: 整檔取代** `src/sites/netflix/player.ts`:

```typescript
import { PLAYER_ROOT } from './dom'

// videoId 取自 /watch/<id>
export function getVideoId(): string | null {
  const m = location.pathname.match(/\/watch\/(\d+)/)
  return m ? m[1] : null
}

export function getVideoElement(): HTMLVideoElement | null {
  return document.querySelector('video')
}

// 播放器根容器（用作 anchor）。
export function getPlayerRoot(): HTMLElement | null {
  return (document.querySelector(PLAYER_ROOT) as HTMLElement | null)
    ?? (getVideoElement()?.parentElement ?? null)
}
```

> 移除 `getContainer`（已無人用）。

- [ ] **Step 4: 確認無殘留引用**

Run: `grep -rn 'SubtitleObserver\|Injector\|getContainer\|SUBTITLE_CONTAINER\|NATIVE_TEXT\|INJECTED_ID\|extractLineText' src/ tests/`
Expected: **0 hits**。若有殘留 → 補修。

- [ ] **Step 5: 型別 + 全套測試**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean；全套 PASS（54 - 4 刪掉的 netflix-extract-line = 50）。

- [ ] **Step 6: Commit**

```bash
git add src/sites/netflix/dom.ts src/sites/netflix/player.ts
git commit -m "refactor: 刪 reactive Netflix 路線（subtitle-observer/injector/extract-line test）"
```

---

### Task 7: build + 手動驗證 + 紀錄

**Files:**
- 沿用既有 `dist/`，使用者載 unpacked。

- [ ] **Step 1: 乾淨 build**

Run: `npm run build`
Expected: 成功；`dist/manifest.json` 含 4 條 content_scripts、2 條 `world: MAIN`、3 條 host_permissions（含 `*.netflix.com`）。

- [ ] **Step 2: 驗 build 產物**

Run: `grep -o '"world":"MAIN"' dist/manifest.json | wc -l`
Expected: `2`。

Run: `ls dist/assets/ | grep -E 'netflix-hook|netflix-content'`
Expected: 兩個 chunk 都在。

- [ ] **Step 3: 真機驗證情境**（使用者執行）

在 Edge / Chrome 載 unpacked `dist/`，到 Netflix `/watch/<id>` 開 CC，依序確認：

| 情境 | 預期 |
|---|---|
| 1. 載入 | console 出 `[submersive] netflix hook installed` + `[submersive] netflix content ready`；無紅字 error |
| 2. bilingual + CC | overlay 顯示原文（小淡）+ 譯文（大亮）；**位置在播放器底部**；原生 CC **不見** |
| 3. 譯文穩定 | 字幕**不再一閃即逝**（rAF loop 連續顯示）；切換多行流暢 |
| 4. original | overlay 只顯示原文、**字級倍率明顯**（options 拉 fontScale 比對）；原生 CC **不見** |
| 5. off | overlay **完全消失**；原生 CC **回復顯示** |
| 6. 切換 | 按鈕循環 雙語 ✓ → 原文 → 關閉 → 雙語；每態行為符合上面 |
| 7. SPA 換片 | 切到另一集 → overlay 重置，新 cue 進來後恢復；無殘留舊字幕 |
| 8. 重載分頁 | mode 持久化（按鈕標籤同上次） |
| 9. 多分頁 | A 分頁切 mode → B 分頁按鈕 + 原生 CC 顯示同步 |

- [ ] **Step 4: 全套測試最終回歸**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean；全套 PASS（50）。

- [ ] **Step 5: 記錄結果**

驗證 PASS / FAIL 回報到本 plan 的下方 comment 或執行 session 內；FAIL 的話視情況新增追修 task。

---

## 已知限制（非本計畫範圍）

- **多軌動態切換**：使用者觀看中切換字幕語言，會觸發 Netflix 重新 fetch TTML，hook 攔到後新 cue 蓋過舊的；本次不處理「同時保有多軌、語意上記住每軌獨立 cache」。
- **WebVTT 字幕**：若 Netflix 某些片用 WebVTT，parser 直接回 `[]`、視同無字幕；後續可擴 parser。
- **原生 CC 樣式跟隨**：我們 overlay 用 settings 的字級/位置，與 Netflix CC 原生樣式（顏色、字型、陰影）分離；本次不對齊。
- **TTML 抵達前播放**：若 Netflix 還沒 fetch 字幕、使用者就播，overlay 空白 5 秒後出「請開啟字幕…」提示。Netflix 實務上會 prefetch，window 通常 <1 秒。
- **background 的 `TRANSLATE_LINE` handler 與 `translate-line.ts`**：本次不刪、留待未來清理（若確認所有站台都改 batch 翻譯）。
