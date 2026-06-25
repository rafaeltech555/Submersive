# 沉浸翻譯即時開關 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 YouTube/Netflix 播放器右上角加一顆浮動按鈕，讓使用者即時開/關沉浸式雙語翻譯，狀態跨分頁/重載記憶。

**Architecture:** 新增 `toggle-store`（純邏輯，存 `chrome.storage.local` 的 `immersiveEnabled`，預設 ON）與 `ToggleButton`（整合層自有元件）。`content.ts`、`netflix-content.ts` 各建一顆按鈕並維護 `enabled` 旗標：OFF 時不送翻譯請求並清掉已顯示譯文，原文不受影響；用 `chrome.storage.onChanged` 跨分頁同步。

**Tech Stack:** TypeScript、Vite + @crxjs、Vitest（純邏輯 TDD）、Playwright（整合層手動驗證）。

**Spec:** `docs/superpowers/specs/2026-06-25-immersive-toggle-design.md`

---

### Task 1: `toggle-store` 開關狀態讀寫（TDD）

**Files:**
- Create: `src/core/toggle-store.ts`
- Test: `tests/toggle-store.test.ts`

- [ ] **Step 1: 寫失敗測試** `tests/toggle-store.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { loadEnabled, saveEnabled } from '../src/core/toggle-store'

let store: Record<string, unknown>
beforeEach(() => {
  store = {}
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (keys: string[]) => {
          const o: Record<string, unknown> = {}
          for (const k of keys) if (k in store) o[k] = store[k]
          return o
        },
        set: async (obj: Record<string, unknown>) => { Object.assign(store, obj) },
      },
    },
  }
})

describe('toggle-store', () => {
  it('未設定過預設為 ON(true)', async () => {
    expect(await loadEnabled()).toBe(true)
  })

  it('saveEnabled 寫入後 loadEnabled 讀回', async () => {
    await saveEnabled(false)
    expect(await loadEnabled()).toBe(false)
    await saveEnabled(true)
    expect(await loadEnabled()).toBe(true)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/toggle-store.test.ts`
Expected: FAIL — 找不到 `src/core/toggle-store`。

- [ ] **Step 3: 實作** `src/core/toggle-store.ts`：

```typescript
// 沉浸翻譯開關狀態，存 chrome.storage.local，預設 ON。
export async function loadEnabled(): Promise<boolean> {
  const { immersiveEnabled } = await chrome.storage.local.get(['immersiveEnabled'])
  return immersiveEnabled ?? true
}

export async function saveEnabled(on: boolean): Promise<void> {
  await chrome.storage.local.set({ immersiveEnabled: on })
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/toggle-store.test.ts`
Expected: PASS（2 tests）。

- [ ] **Step 5: Commit**

```bash
git add src/core/toggle-store.ts tests/toggle-store.test.ts
git commit -m "feat: toggle-store 沉浸翻譯開關狀態（預設 ON）"
```

---

### Task 2: `ToggleButton` 浮動開關元件

**Files:**
- Create: `src/content/toggle-button.ts`

整合層 DOM 元件（仿 `Notice`），無單元測試，靠後續手動驗證。

- [ ] **Step 1: 實作** `src/content/toggle-button.ts`：

```typescript
// 播放器右上角的沉浸翻譯開關鈕（自有元件，不碰站台原生控制列）。
export class ToggleButton {
  private el: HTMLDivElement
  private on: boolean

  constructor(
    private getAnchor: () => HTMLElement | null,
    private onToggle: (on: boolean) => void,
    initialOn: boolean,
  ) {
    this.on = initialOn
    this.el = document.createElement('div')
    this.el.id = 'submersive-toggle'
    Object.assign(this.el.style, {
      position: 'absolute', top: '8px', right: '8px',
      padding: '4px 10px', borderRadius: '6px',
      background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: '13px',
      fontFamily: 'sans-serif', cursor: 'pointer', pointerEvents: 'auto',
      zIndex: '60', userSelect: 'none',
    } as Partial<CSSStyleDeclaration>)
    this.el.addEventListener('click', () => {
      this.on = !this.on
      this.render()
      this.onToggle(this.on)
    })
    this.render()
  }

  private render() {
    this.el.textContent = this.on ? '雙語 ✓' : '原文'
  }

  // anchor 可能晚出現，每次重取並掛上（idempotent）。
  mount() {
    const anchor = this.getAnchor()
    if (anchor && !anchor.contains(this.el)) anchor.appendChild(this.el)
  }

  // 外部（其他分頁）同步狀態，不觸發 onToggle。
  setState(on: boolean) {
    if (this.on === on) return
    this.on = on
    this.render()
  }
}
```

- [ ] **Step 2: 確認型別檢查通過**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 3: Commit**

```bash
git add src/content/toggle-button.ts
git commit -m "feat: ToggleButton 浮動開關元件"
```

---

### Task 3: `content.ts`（YouTube）接上開關

**Files:**
- Modify: `src/content/content.ts`（整檔取代）

- [ ] **Step 1: 用以下內容整檔取代** `src/content/content.ts`：

```typescript
import { YouTubeAdapter } from '../sites/youtube-adapter'
import { Overlay } from './overlay'
import { Notice } from './notice'
import { ToggleButton } from './toggle-button'
import { loadSettings } from '../core/settings-store'
import { loadEnabled, saveEnabled } from '../core/toggle-store'
import { friendlyTranslateError } from '../core/translate-error'
import type { Cue, VideoContext } from '../types'

const NO_CUES_TIMEOUT_MS = 5000

;(async () => {
  const settings = await loadSettings()
  let enabled = await loadEnabled()
  const site = new YouTubeAdapter()
  const anchor = () => document.querySelector('#movie_player') as HTMLElement | null
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
    if (timer !== undefined || gotCues || !enabled) return
    timer = window.setTimeout(() => {
      timer = undefined
      if (!gotCues && enabled) notice.show('請開啟 CC 字幕以啟用雙語翻譯')
    }, NO_CUES_TIMEOUT_MS)
  }

  // 翻譯整軌並顯示雙語；OFF 或已換片時放棄。
  const translateAndShow = async (cues: Cue[], ctx: VideoContext) => {
    const expectedId = ctx.videoId
    const res = (await chrome.runtime.sendMessage({
      type: 'TRANSLATE', videoId: ctx.videoId, srcLang: ctx.srcLang,
      targetLang: settings.targetLang, engine: settings.engine, cues,
    })) as { type: string; cues?: Cue[]; error?: string }
    if (currentVideoId !== expectedId || !enabled) return
    if (res?.type === 'TRANSLATE_RESULT' && res.cues) {
      overlay.setCues(res.cues)
      overlay.setBilingual(true)
    } else {
      console.warn('[submersive] translate failed', res?.error)
      notice.show(friendlyTranslateError(res?.error), { autoHideMs: 6000 })
    }
  }

  // 套用開關狀態到目前畫面。
  const applyEnabled = (on: boolean) => {
    enabled = on
    if (on) {
      if (lastCues && lastCtx) translateAndShow(lastCues, lastCtx)
    } else {
      overlay.setBilingual(false)
    }
  }

  const toggle = new ToggleButton(anchor, (on) => { applyEnabled(on); saveEnabled(on) }, enabled)

  // 其他分頁改了開關 → 同步本頁。
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.immersiveEnabled) return
    const on = changes.immersiveEnabled.newValue ?? true
    toggle.setState(on)
    applyEnabled(on)
  })

  const attachPlayingListener = (): boolean => {
    const v = site.getVideoElement()
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
    const id = site.detectVideo()?.videoId ?? null
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
  document.addEventListener('yt-navigate-finish', onVideoMaybeChanged)

  site.onSubtitleTrack(async (cues, ctx) => {
    gotCues = true
    clearTimer()
    notice.hide()
    overlay.setCues(cues)
    overlay.mount()
    lastCues = cues
    lastCtx = ctx
    if (enabled) await translateAndShow(cues, ctx)
  })

  console.log('[submersive] content ready')
})()
```

- [ ] **Step 2: 確認型別檢查與既有測試通過**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 無錯誤；全套測試 PASS。

- [ ] **Step 3: Commit**

```bash
git add src/content/content.ts
git commit -m "feat: YouTube content 接上沉浸翻譯開關"
```

---

### Task 4: `netflix-content.ts`（Netflix）接上開關

**Files:**
- Modify: `src/content/netflix-content.ts`（整檔取代）

- [ ] **Step 1: 用以下內容整檔取代** `src/content/netflix-content.ts`：

```typescript
import { loadSettings } from '../core/settings-store'
import { loadEnabled, saveEnabled } from '../core/toggle-store'
import { Notice } from './notice'
import { ToggleButton } from './toggle-button'
import { friendlyTranslateError } from '../core/translate-error'
import { getVideoId, getContainer, getVideoElement, getPlayerRoot } from '../sites/netflix/player'
import { SubtitleObserver } from '../sites/netflix/subtitle-observer'
import { Injector } from '../sites/netflix/injector'

const NO_SUBTITLE_TIMEOUT_MS = 5000

;(async () => {
  const settings = await loadSettings()
  let enabled = await loadEnabled()
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

  const toggle = new ToggleButton(getPlayerRoot, (on) => {
    enabled = on
    saveEnabled(on)
    if (!on) injector.clear()
  }, enabled)

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.immersiveEnabled) return
    enabled = changes.immersiveEnabled.newValue ?? true
    toggle.setState(enabled)
    if (!enabled) injector.clear()
  })

  const clearNoSubTimer = () => {
    if (noSubTimer !== undefined) { clearTimeout(noSubTimer); noSubTimer = undefined }
  }
  const clearPoll = () => {
    if (poll !== undefined) { clearInterval(poll); poll = undefined }
    if (pollTimeout !== undefined) { clearTimeout(pollTimeout); pollTimeout = undefined }
  }

  const armNoSubTimer = () => {
    if (noSubTimer !== undefined || gotLine || !enabled) return
    noSubTimer = window.setTimeout(() => {
      noSubTimer = undefined
      if (!gotLine && enabled) notice.show('請開啟字幕以啟用雙語翻譯')
    }, NO_SUBTITLE_TIMEOUT_MS)
  }

  async function onLine(text: string) {
    currentLine = text
    if (text === '') { injector.clear(); return }
    gotLine = true
    clearNoSubTimer()
    notice.hide()
    if (!enabled) { injector.clear(); return }

    const expectedLine = text
    const expectedVid = currentVideoId
    let res: { type: string; translated?: string; error?: string }
    try {
      res = (await chrome.runtime.sendMessage({
        type: 'TRANSLATE_LINE', text, srcLang: null,
        targetLang: settings.targetLang, engine: settings.engine,
      })) as { type: string; translated?: string; error?: string }
    } catch {
      return // background 不可用時靜默略過該行
    }

    // 換行/換片/中途關掉就丟棄
    if (currentLine !== expectedLine || currentVideoId !== expectedVid || !enabled) return

    if (res?.type === 'TRANSLATE_LINE_RESULT' && res.translated != null) {
      injector.setTranslation(res.translated)
    } else {
      console.warn('[submersive] netflix translate failed', res?.error)
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
    toggle.mount()
    if (watchedVideo !== v) {
      if (watchedVideo) watchedVideo.removeEventListener('playing', armNoSubTimer)
      v.addEventListener('playing', armNoSubTimer)
      watchedVideo = v
    }
    if (!v.paused) armNoSubTimer()
    return true
  }

  const startWatching = () => {
    clearPoll()
    observer.start()
    if (attachPlayingListener()) return
    poll = window.setInterval(() => { if (attachPlayingListener()) clearPoll() }, 500)
    pollTimeout = window.setTimeout(() => clearPoll(), 30000)
  }

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
    if (watchedVideo) {
      watchedVideo.removeEventListener('playing', armNoSubTimer)
      watchedVideo = null
    }
    if (id) startWatching()
  }

  onVideoMaybeChanged()
  window.setInterval(onVideoMaybeChanged, 1000)

  console.log('[submersive] netflix content ready')
})()
```

- [ ] **Step 2: 確認型別檢查與既有測試通過**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 無錯誤；全套測試 PASS。

- [ ] **Step 3: Commit**

```bash
git add src/content/netflix-content.ts
git commit -m "feat: Netflix content 接上沉浸翻譯開關"
```

---

### Task 5: 整合層手動驗證（Playwright 合成頁）

**Files:**
- 沿用 scratchpad 的 Netflix/YouTube Playwright harness（不入庫）。

- [ ] **Step 1: 重建並確認 dist**

Run: `npm run build`
Expected: build 成功。

- [ ] **Step 2: 準備 ext 副本（放寬 match 到 localhost）**

把 `dist` 複製到 scratchpad，patch `manifest.json`：對 youtube/netflix 兩條 content_scripts 的 `matches`、`host_permissions`、`web_accessible_resources[].matches` 各加 `http://localhost/*`（與既有 harness 同手法）。

- [ ] **Step 3: 驗證 5 個情境（合成頁 + 真實站台）**

用 Playwright 載入 ext + 合成頁，並對照真實 YouTube/Netflix：
1. 播放器**右上角出現開關鈕**、初始顯示「雙語 ✓」。
2. 點一下 → 變「原文」：YouTube `#submersive-overlay` 不再有譯文行（`setBilingual(false)`）／Netflix `#submersive-netflix-line` 被移除；且 OFF 後新字幕**不再送翻譯請求**（server `/translate` 計數不增）。
3. 再點 → 「雙語 ✓」：YouTube 立即補翻顯示雙語（用 lastCues，不重抓整軌）／Netflix 下一行恢復注入。
4. 重載分頁 → 按鈕記住上次狀態（OFF 就維持 OFF）。
5. 開兩個分頁 → 一邊切換，另一邊按鈕外觀與顯示**同步**（`chrome.storage.onChanged`）。

各情境截圖存 scratchpad，逐一確認。

- [ ] **Step 4: 全套單元測試最終回歸**

Run: `npx vitest run`
Expected: 全套 PASS（含 Task 1 的 toggle-store）。

- [ ] **Step 5: 記錄驗證結果**

把 5 情境 PASS/FAIL + 截圖路徑記到驗證回報。

---

## 已知限制（非本計畫範圍）

- **Netflix ON 不補當前行**：切回 ON 時不立即翻譯當前顯示的那一行，等下一行（per-line 設計；MVP 取捨）。
- **OFF 時抑制無字幕提示**：OFF 時不再彈「請開啟 CC／字幕」（避免與「不需要翻譯」矛盾）；OFF 中途切 ON 且當下無字幕，提示可能要等下個 playing 事件才出現。
