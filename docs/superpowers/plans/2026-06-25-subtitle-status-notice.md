# 字幕狀態提示（無字幕／翻譯失敗）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 YouTube 播放器上顯示使用者可見的狀態提示——翻譯失敗時給友善錯誤訊息，偵測到影片但一段時間未攔到字幕時提示開啟 CC。

**Architecture:** 沿用現有四層，集中在 content 整合層。新增純函式 `friendlyTranslateError`（core，TDD）做錯誤訊息映射；新增 `Notice` class（content，整合層，手動驗證）顯示狀態 pill；於 `content.ts` 接線：翻譯失敗 → 6 秒自動消失提示；時間門檻啟發式偵測無字幕 → 常駐「請開啟 CC」提示，攔到 cue 即消，SPA 換片重置。

**Tech Stack:** TypeScript、Vite、Vitest。無新依賴、無新權限。

對應 spec：`docs/superpowers/specs/2026-06-25-subtitle-status-notice-design.md`

---

## File Structure

```
src/
  core/
    translate-error.ts       # 新增：error 字串 -> 友善繁中訊息（純函式）
  content/
    notice.ts                # 新增：Notice class，播放器上方狀態 pill
    content.ts               # 修改：接線翻譯失敗提示 + 無字幕偵測
tests/
  translate-error.test.ts    # 新增：friendlyTranslateError 單元測試
```

設計原則：`translate-error.ts` 為純字串函式可單元測試；`notice.ts` 與 `content.ts` 為 DOM/事件整合層，沿用 `overlay.ts` 慣例以手動驗證涵蓋。

---

## Task 1: friendlyTranslateError 純函式（TDD）

把後端原始 error 字串映射成友善繁中提示。純字串輸入輸出。

**Files:**
- Create: `src/core/translate-error.ts`
- Test: `tests/translate-error.test.ts`

- [ ] **Step 1: 寫失敗測試**

`tests/translate-error.test.ts`：
```ts
import { describe, it, expect } from 'vitest'
import { friendlyTranslateError } from '../src/core/translate-error'

describe('friendlyTranslateError', () => {
  it('auth/額度類錯誤 → key 提示', () => {
    expect(friendlyTranslateError('DeepL HTTP 403')).toBe(
      '翻譯失敗：API key 無效或額度用盡，請至設定檢查',
    )
    expect(friendlyTranslateError('DeepL HTTP 456 quota')).toBe(
      '翻譯失敗：API key 無效或額度用盡，請至設定檢查',
    )
    expect(friendlyTranslateError('Error: Authorization failed')).toBe(
      '翻譯失敗：API key 無效或額度用盡，請至設定檢查',
    )
  })

  it('本機連線類錯誤 → 本機 server 提示', () => {
    expect(friendlyTranslateError('TypeError: Failed to fetch')).toBe(
      '翻譯失敗：本機翻譯 server 未啟動或無法連線',
    )
    expect(friendlyTranslateError('connect ECONNREFUSED 127.0.0.1:5000')).toBe(
      '翻譯失敗：本機翻譯 server 未啟動或無法連線',
    )
  })

  it('長度不符錯誤 → 重試提示', () => {
    expect(friendlyTranslateError('translation length mismatch: got 2, expected 3')).toBe(
      '翻譯失敗：翻譯結果長度不符，請稍後重試',
    )
  })

  it('其他錯誤 → 保留原訊息', () => {
    expect(friendlyTranslateError('something weird')).toBe('翻譯失敗：something weird')
  })

  it('空值 / undefined → 未知錯誤', () => {
    expect(friendlyTranslateError(undefined)).toBe('翻譯失敗：未知錯誤')
    expect(friendlyTranslateError('')).toBe('翻譯失敗：未知錯誤')
    expect(friendlyTranslateError('   ')).toBe('翻譯失敗：未知錯誤')
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/translate-error.test.ts`
Expected: FAIL（`friendlyTranslateError` 未定義 / 找不到模組）。

- [ ] **Step 3: 實作**

`src/core/translate-error.ts`：
```ts
// 將後端回傳的原始 error 字串映射成使用者可讀的繁中提示。
export function friendlyTranslateError(error: string | undefined): string {
  const raw = error ?? ''
  if (!raw.trim()) return '翻譯失敗：未知錯誤'
  const e = raw.toLowerCase()
  if (/(401|403|456|authorization|auth)/.test(e)) {
    return '翻譯失敗：API key 無效或額度用盡，請至設定檢查'
  }
  if (/(failed to fetch|localhost|127\.0\.0\.1|econnrefused|networkerror)/.test(e)) {
    return '翻譯失敗：本機翻譯 server 未啟動或無法連線'
  }
  if (e.includes('length mismatch')) {
    return '翻譯失敗：翻譯結果長度不符，請稍後重試'
  }
  return `翻譯失敗：${raw}`
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/translate-error.test.ts`
Expected: PASS（5 passed）。

- [ ] **Step 5: Commit**

```bash
git add src/core/translate-error.ts tests/translate-error.test.ts
git commit -m "feat: friendlyTranslateError 錯誤訊息映射 (純函式 TDD)"
```

---

## Task 2: Notice class（整合層）

播放器上方中央的狀態 pill，與 overlay（底部字幕）職責分離。

**Files:**
- Create: `src/content/notice.ts`

- [ ] **Step 1: 實作 Notice**

`src/content/notice.ts`：
```ts
// 在播放器上方顯示狀態訊息（與 Overlay 的底部字幕分離）。
export class Notice {
  private el: HTMLDivElement
  private pill: HTMLSpanElement
  private hideTimer: number | undefined

  constructor(private getAnchor: () => HTMLElement | null) {
    this.el = document.createElement('div')
    this.el.id = 'submersive-notice'
    Object.assign(this.el.style, {
      position: 'absolute', left: '0', right: '0', top: '8%',
      textAlign: 'center', pointerEvents: 'none', zIndex: '60', display: 'none',
    } as Partial<CSSStyleDeclaration>)

    this.pill = document.createElement('span')
    Object.assign(this.pill.style, {
      display: 'inline-block', padding: '6px 14px', borderRadius: '6px',
      background: 'rgba(0,0,0,0.75)', color: '#fff', fontSize: '14px',
      fontFamily: 'sans-serif', textShadow: '0 0 4px #000',
    } as Partial<CSSStyleDeclaration>)
    this.el.appendChild(this.pill)
  }

  show(msg: string, opts?: { autoHideMs?: number }) {
    const anchor = this.getAnchor()
    if (anchor && !anchor.contains(this.el)) anchor.appendChild(this.el)
    this.pill.textContent = msg
    this.el.style.display = 'block'
    if (this.hideTimer !== undefined) { clearTimeout(this.hideTimer); this.hideTimer = undefined }
    if (opts?.autoHideMs) {
      this.hideTimer = window.setTimeout(() => this.hide(), opts.autoHideMs)
    }
  }

  hide() {
    if (this.hideTimer !== undefined) { clearTimeout(this.hideTimer); this.hideTimer = undefined }
    this.el.style.display = 'none'
  }
}
```

- [ ] **Step 2: build 驗證型別無誤**

Run: `npx tsc --noEmit`
Expected: 無型別錯誤。

- [ ] **Step 3: Commit**

```bash
git add src/content/notice.ts
git commit -m "feat: Notice 播放器狀態提示元件"
```

---

## Task 3: content.ts 接線（翻譯失敗提示 + 無字幕偵測）

整合 `Notice` 與 `friendlyTranslateError`；加時間門檻啟發式偵測無字幕，並處理 SPA 換片重置。

**Files:**
- Modify: `src/content/content.ts`

- [ ] **Step 1: 以完整版取代 content.ts**

`src/content/content.ts`：
```ts
import { YouTubeAdapter } from '../sites/youtube-adapter'
import { Overlay } from './overlay'
import { Notice } from './notice'
import { loadSettings } from '../core/settings-store'
import { friendlyTranslateError } from '../core/translate-error'
import type { Cue } from '../types'

const NO_CUES_TIMEOUT_MS = 5000

;(async () => {
  const settings = await loadSettings()
  const site = new YouTubeAdapter()
  const anchor = () => document.querySelector('#movie_player') as HTMLElement | null
  const overlay = new Overlay(() => site.getPlayerTime(), anchor)
  overlay.applySettings(settings)
  const notice = new Notice(anchor)

  let gotCues = false
  let timer: number | undefined
  let currentVideoId: string | null = null

  const clearTimer = () => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined }
  }

  const armNoCuesTimer = () => {
    if (timer !== undefined || gotCues) return
    timer = window.setTimeout(() => {
      timer = undefined
      if (!gotCues) notice.show('請開啟 CC 字幕以啟用雙語翻譯')
    }, NO_CUES_TIMEOUT_MS)
  }

  // video 元素在 document_start 時可能尚未存在；附上 playing 監聽，已在播放則直接 arm。
  const attachPlayingListener = (): boolean => {
    const v = site.getVideoElement()
    if (!v) return false
    v.addEventListener('playing', armNoCuesTimer) // 同一函式 ref，瀏覽器自動去重
    if (!v.paused) armNoCuesTimer()
    return true
  }

  // 反覆嘗試直到 video 出現（最多 ~30s）。
  const startWatching = () => {
    if (attachPlayingListener()) return
    const poll = window.setInterval(() => {
      if (attachPlayingListener()) clearInterval(poll)
    }, 500)
    window.setTimeout(() => clearInterval(poll), 30000)
  }

  // 初始 + SPA 換片：videoId 變才重置。
  const onVideoMaybeChanged = () => {
    const id = site.detectVideo()?.videoId ?? null
    if (id === currentVideoId) return
    currentVideoId = id
    gotCues = false
    clearTimer()
    notice.hide()
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
    const res = (await chrome.runtime.sendMessage({
      type: 'TRANSLATE', videoId: ctx.videoId, srcLang: ctx.srcLang,
      targetLang: settings.targetLang, engine: settings.engine, cues,
    })) as { type: string; cues?: Cue[]; error?: string }
    if (res?.type === 'TRANSLATE_RESULT' && res.cues) {
      overlay.setCues(res.cues)
      overlay.setBilingual(true)
    } else {
      console.warn('[submersive] translate failed', res?.error)
      notice.show(friendlyTranslateError(res?.error), { autoHideMs: 6000 })
    }
  })

  console.log('[submersive] content ready')
})()
```

- [ ] **Step 2: 跑全測試 + 型別檢查確認無回歸**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全測試 PASS（含 Task 1 新增的 5 個）、無型別錯誤。

- [ ] **Step 3: build**

Run: `npm run build`
Expected: 無錯誤，產生 `dist/`。

- [ ] **Step 4: 手動驗證**

1. **翻譯失敗**：`chrome://extensions` 重新載入擴充套件。Options 清空 DeepL key（engine=deepl）→ 開有字幕影片並開 CC → 攔到 cue 後出現「翻譯失敗：API key 無效或額度用盡，請至設定檢查」，6 秒後自動消失。改 engine=local 但本機 server 沒開 → 出現「本機翻譯 server 未啟動或無法連線」。
2. **無字幕提示**：開一部影片但**不開 CC** → 約 5 秒後播放器上方中央出現「請開啟 CC 字幕以啟用雙語翻譯」；接著手動開 CC → 攔到字幕後提示消失、出現雙語字幕。
3. **換片重置**：在無字幕提示顯示中，點 YouTube 內部連結換到另一部有開 CC 的片 → 舊提示消失、新片正常攔字幕出雙語（不殘留舊狀態）。

Expected: 三種情境皆如描述；console 無錯誤。

- [ ] **Step 5: Commit**

```bash
git add src/content/content.ts
git commit -m "feat: 無字幕/CC 未開提示 + 翻譯失敗可見提示 (content 接線)"
```

---

## Self-Review 結果

**Spec coverage：**
- spec §範圍「翻譯失敗可見提示」→ Task 1（訊息映射）+ Task 3 Step 1（else 分支接線）✓
- spec §範圍「無字幕提示（時間門檻）」→ Task 3（arm/觸發/取消/換片重置）✓
- spec §架構 1 `Notice` → Task 2 ✓
- spec §架構 2 `friendlyTranslateError` → Task 1 ✓
- spec §架構 3 content.ts 接線 → Task 3 ✓
- spec §測試（單元 + 手動三情境）→ Task 1 Step 1（5 分支）、Task 3 Step 4（三情境）✓

**Placeholder scan：** 無 TBD/TODO；每個 code step 均含完整程式碼；整合層以完整程式碼 + 明確手動驗證取代不可自動化的單元測試。

**Type consistency：** `friendlyTranslateError(error: string | undefined): string`、`Notice.show(msg, opts?)`、`Notice.hide()`、`anchor()` 取得器跨 Task 一致；`NO_CUES_TIMEOUT_MS` 常數於 content.ts 頂部定義並使用。`onSubtitleTrack` 回呼簽名 `(cues, ctx)` 與現有 `YouTubeAdapter` 一致，未更動。

**已知取捨：** 採時間門檻啟發式，不區分「影片無字幕軌」與「有字幕但 CC 未開」，兩者皆導向同一句「請開啟 CC」提示（避免耦合 YouTube 非公開 player API；YAGNI）。
