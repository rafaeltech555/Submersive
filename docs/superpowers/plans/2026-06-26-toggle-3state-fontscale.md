# 沉浸開關 3 段化 + 原文字級修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把沉浸開關由 2 段（雙語/原文）改成 3 段循環（雙語→原文→關閉），並修正 YouTube 原文模式字級倍率無效。

**Architecture:** 狀態由布林 `immersiveEnabled` 改為列舉 `immersiveMode`（`'bilingual'|'original'|'off'`，預設 bilingual）。`Overlay` 新增 `setOriginalOnly` 讓原文單獨顯示時用主要尺寸。`ToggleButton` 改三態循環。兩個 content entry 改用 `applyMode`。因 ToggleButton 簽名與 toggle-store 型別耦合 content/netflix，core 切換需原子性一次改完以保持 tsc 綠。

**Tech Stack:** TypeScript、Vite + @crxjs、Vitest（TDD）、Playwright（手動驗證）。

**Spec:** `docs/superpowers/specs/2026-06-26-toggle-3state-fontscale-design.md`

---

### Task 1: Overlay 原文主要尺寸（`setOriginalOnly`）

**Files:**
- Modify: `src/content/overlay.ts`

- [ ] **Step 1: 加旗標欄位**

在 `src/content/overlay.ts` 既有 `private fontScale = 1` 那一行**之後**加：
```typescript
  private originalOnly = false
```

- [ ] **Step 2: 加 setter**

在既有 `setBilingual(v: boolean) { this.bilingual = v }` 那一行**之後**加：
```typescript
  setOriginalOnly(v: boolean) { this.originalOnly = v }
```

- [ ] **Step 3: 改 render 的「只顯示原文」分支**

把 `render` 裡現有的：
```typescript
    } else {
      lines.push(orig) // 還沒翻譯好，先顯示原文
    }
```
改成：
```typescript
    } else {
      // originalOnly（開關=原文）時原文用主要尺寸，讓字級倍率明顯；雙語未翻好的暫顯維持次要尺寸。
      if (this.originalOnly) Object.assign(orig.style, { fontSize: `${120 * this.fontScale}%`, opacity: '1' })
      lines.push(orig)
    }
```

- [ ] **Step 4: 確認型別檢查通過**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 5: Commit**

```bash
git add src/content/overlay.ts
git commit -m "feat: Overlay setOriginalOnly 原文單獨顯示用主要尺寸"
```

---

### Task 2: 狀態改 immersiveMode（toggle-store + ToggleButton + 兩 content 原子切換）

**Files:**
- Modify: `src/core/toggle-store.ts`（整檔取代）
- Modify: `src/content/toggle-button.ts`（整檔取代）
- Modify: `src/content/content.ts`（整檔取代）
- Modify: `src/content/netflix-content.ts`（整檔取代）
- Test: `tests/toggle-store.test.ts`（整檔取代）

> 這四個檔耦合（ToggleButton 簽名 + ImmersiveMode 型別），需一次改完才 tsc 綠，故合為一個 task。

- [ ] **Step 1: 改測試（RED）** — 用以下內容整檔取代 `tests/toggle-store.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { loadMode, saveMode } from '../src/core/toggle-store'

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
  it('未設定過預設為 bilingual', async () => {
    expect(await loadMode()).toBe('bilingual')
  })

  it('saveMode 寫入後 loadMode 讀回', async () => {
    await saveMode('original')
    expect(await loadMode()).toBe('original')
    await saveMode('off')
    expect(await loadMode()).toBe('off')
  })

  it('非法值回退 bilingual', async () => {
    store['immersiveMode'] = 'garbage'
    expect(await loadMode()).toBe('bilingual')
  })

  it('saveMode 寫入 immersiveMode key', async () => {
    await saveMode('off')
    expect(store['immersiveMode']).toBe('off')
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/toggle-store.test.ts`
Expected: FAIL — `loadMode`/`saveMode` 不存在。

- [ ] **Step 3: 整檔取代** `src/core/toggle-store.ts`：

```typescript
export type ImmersiveMode = 'bilingual' | 'original' | 'off'

const MODES: ImmersiveMode[] = ['bilingual', 'original', 'off']

// 沉浸翻譯模式，存 chrome.storage.local，預設 bilingual。
export async function loadMode(): Promise<ImmersiveMode> {
  const { immersiveMode } = await chrome.storage.local.get(['immersiveMode'])
  return MODES.includes(immersiveMode as ImmersiveMode) ? (immersiveMode as ImmersiveMode) : 'bilingual'
}

export async function saveMode(mode: ImmersiveMode): Promise<void> {
  await chrome.storage.local.set({ immersiveMode: mode })
}
```

- [ ] **Step 4: 整檔取代** `src/content/toggle-button.ts`：

```typescript
import type { ImmersiveMode } from '../core/toggle-store'

const LABELS: Record<ImmersiveMode, string> = { bilingual: '雙語 ✓', original: '原文', off: '關閉' }
const NEXT: Record<ImmersiveMode, ImmersiveMode> = { bilingual: 'original', original: 'off', off: 'bilingual' }

// 播放器右上角的沉浸翻譯開關鈕（自有元件，不碰站台原生控制列）。點擊循環 bilingual→original→off。
export class ToggleButton {
  private el: HTMLDivElement
  private mode: ImmersiveMode

  constructor(
    private getAnchor: () => HTMLElement | null,
    private onCycle: (mode: ImmersiveMode) => void,
    initialMode: ImmersiveMode,
  ) {
    this.mode = initialMode
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
      this.mode = NEXT[this.mode]
      this.render()
      this.onCycle(this.mode)
    })
    this.render()
  }

  private render() {
    this.el.textContent = LABELS[this.mode]
  }

  // anchor 可能晚出現，每次重取並掛上（idempotent）。
  mount() {
    const anchor = this.getAnchor()
    if (anchor && !anchor.contains(this.el)) anchor.appendChild(this.el)
  }

  // 外部（其他分頁）同步狀態，不觸發 onCycle。
  setMode(mode: ImmersiveMode) {
    if (this.mode === mode) return
    this.mode = mode
    this.render()
  }
}
```

- [ ] **Step 5: 整檔取代** `src/content/content.ts`：

```typescript
import { YouTubeAdapter } from '../sites/youtube-adapter'
import { Overlay } from './overlay'
import { Notice } from './notice'
import { ToggleButton } from './toggle-button'
import { loadSettings } from '../core/settings-store'
import { loadMode, saveMode, type ImmersiveMode } from '../core/toggle-store'
import { friendlyTranslateError } from '../core/translate-error'
import type { Cue, VideoContext } from '../types'

const NO_CUES_TIMEOUT_MS = 5000

;(async () => {
  const settings = await loadSettings()
  let mode = await loadMode()
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
    if (timer !== undefined || gotCues || mode === 'off') return
    timer = window.setTimeout(() => {
      timer = undefined
      if (!gotCues && mode !== 'off') notice.show('請開啟 CC 字幕以啟用雙語翻譯')
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
      console.warn('[submersive] translate failed', res?.error)
      notice.show(friendlyTranslateError(res?.error), { autoHideMs: 6000 })
    }
  }

  // 套用 mode 到目前畫面。translateAndShow 為 fire-and-forget；呼叫者不需 await，mode 即時可讀。
  const applyMode = (m: ImmersiveMode) => {
    mode = m
    if (m === 'off') { overlay.unmount(); return }
    overlay.setOriginalOnly(m === 'original')
    overlay.setBilingual(false)
    if (lastCues) overlay.setCues(lastCues)
    overlay.mount()
    if (m === 'bilingual' && lastCues && lastCtx) translateAndShow(lastCues, lastCtx)
  }

  const toggle = new ToggleButton(anchor, (m) => { applyMode(m); saveMode(m) }, mode)

  // 其他分頁改了 mode → 同步本頁。
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.immersiveMode) return
    const m = (changes.immersiveMode.newValue ?? 'bilingual') as ImmersiveMode
    toggle.setMode(m)
    applyMode(m)
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
    lastCues = cues
    lastCtx = ctx
    if (mode === 'off') return
    overlay.setCues(cues)
    overlay.setOriginalOnly(mode === 'original')
    overlay.setBilingual(false)
    overlay.mount()
    if (mode === 'bilingual') await translateAndShow(cues, ctx)
  })

  console.log('[submersive] content ready')
})()
```

- [ ] **Step 6: 整檔取代** `src/content/netflix-content.ts`：

```typescript
import { loadSettings } from '../core/settings-store'
import { loadMode, saveMode, type ImmersiveMode } from '../core/toggle-store'
import { Notice } from './notice'
import { ToggleButton } from './toggle-button'
import { friendlyTranslateError } from '../core/translate-error'
import { getVideoId, getContainer, getVideoElement, getPlayerRoot } from '../sites/netflix/player'
import { SubtitleObserver } from '../sites/netflix/subtitle-observer'
import { Injector } from '../sites/netflix/injector'

const NO_SUBTITLE_TIMEOUT_MS = 5000

;(async () => {
  const settings = await loadSettings()
  let mode = await loadMode()
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

  // 套用 mode：非 bilingual（原文/關閉）就清掉注入的譯文。onCycle / onChanged 共用。
  const applyMode = (m: ImmersiveMode) => {
    mode = m
    if (m !== 'bilingual') injector.clear()
  }

  const toggle = new ToggleButton(getPlayerRoot, (m) => { applyMode(m); saveMode(m) }, mode)

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.immersiveMode) return
    const m = (changes.immersiveMode.newValue ?? 'bilingual') as ImmersiveMode
    applyMode(m)
    toggle.setMode(m)
  })

  const clearNoSubTimer = () => {
    if (noSubTimer !== undefined) { clearTimeout(noSubTimer); noSubTimer = undefined }
  }
  const clearPoll = () => {
    if (poll !== undefined) { clearInterval(poll); poll = undefined }
    if (pollTimeout !== undefined) { clearTimeout(pollTimeout); pollTimeout = undefined }
  }

  const armNoSubTimer = () => {
    if (noSubTimer !== undefined || gotLine || mode !== 'bilingual') return
    noSubTimer = window.setTimeout(() => {
      noSubTimer = undefined
      if (!gotLine && mode === 'bilingual') notice.show('請開啟字幕以啟用雙語翻譯')
    }, NO_SUBTITLE_TIMEOUT_MS)
  }

  async function onLine(text: string) {
    currentLine = text
    if (text === '') { injector.clear(); return }
    gotLine = true
    clearNoSubTimer()
    notice.hide()
    if (mode !== 'bilingual') { injector.clear(); return }

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

    // 換行/換片/中途切離 bilingual 就丟棄
    if (currentLine !== expectedLine || currentVideoId !== expectedVid || mode !== 'bilingual') return

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

- [ ] **Step 7: 確認型別檢查與全套測試通過**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 無錯誤；全套測試 PASS（toggle-store 變 4 條）。

- [ ] **Step 8: Commit**

```bash
git add src/core/toggle-store.ts src/content/toggle-button.ts src/content/content.ts src/content/netflix-content.ts tests/toggle-store.test.ts
git commit -m "feat: 沉浸開關改 3 段（bilingual/original/off）immersiveMode"
```

---

### Task 3: 整合層手動驗證（Playwright 合成頁）

**Files:**
- 沿用 scratchpad 的 Netflix Playwright harness（不入庫）。

- [ ] **Step 1: 重建並確認 dist**

Run: `npm run build`
Expected: build 成功。

- [ ] **Step 2: 準備 ext 副本（放寬 match 到 localhost）**

把 `dist` 複製到 scratchpad，patch `manifest.json`：對 youtube/netflix 兩條 content_scripts 的 `matches`、`host_permissions`、`web_accessible_resources[].matches` 各加 `http://localhost/*`（同既有 harness 手法）。

- [ ] **Step 3: 驗證情境（合成 Netflix 頁 + 真實 YouTube）**

Netflix 合成頁（數字 videoId，例 `/watch/771`）：
1. 按鈕循環：點擊依序顯示 `雙語 ✓ → 原文 → 關閉 → 雙語`。
2. **雙語**：showLine → 注入譯文（`#submersive-netflix-line` 有值）。
3. **原文**：注入消失（`#submersive-netflix-line` 不存在）、showLine 不送翻譯（server `/translate` log 不增）。
4. **關閉**：同原文（Netflix 上兩態相同）、不送翻譯。
5. 重載分頁 → 記住上次 mode；兩分頁切換 → 按鈕同步。

真實 YouTube（使用者執行）：
6. 切到 **原文** → overlay 只顯示原文、字級倍率明顯（主要尺寸）。
7. 切到 **關閉** → 我們的 overlay 消失（只剩原生 CC）。

- [ ] **Step 4: 全套單元測試最終回歸**

Run: `npx vitest run`
Expected: 全套 PASS。

- [ ] **Step 5: 記錄驗證結果**

把情境 PASS/FAIL + 截圖路徑記到驗證回報；YouTube 原文字級與關閉 overlay 消失列為使用者真機核對項。

---

## 已知限制（非本計畫範圍）

- **Netflix 原文≡關閉**：兩態皆只剩原生字幕、視覺相同（Netflix 原生字幕即原文，我們無自有原文 overlay）。
- **設定不即時套用**：改 `fontScale` 等仍需重載分頁才生效（維持現狀）。
- **Netflix 注入譯文不套 fontScale**：維持固定 110%。
