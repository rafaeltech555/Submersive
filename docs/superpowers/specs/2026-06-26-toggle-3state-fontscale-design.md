# Submersive — 沉浸開關改 3 段 + 原文字級修正設計

## 背景與目標

沉浸翻譯即時開關（`2026-06-25-immersive-toggle`）上線後，使用者實測回饋兩點：

1. **缺「完全關閉」**：目前開關只在「雙語」與「原文」間切，沒有讓擴充完全不顯示（只剩站台原生字幕）的狀態。
2. **原文模式字級無效**：YouTube 在「雙語」時字級倍率（`fontScale`）有效，但切到「原文」時看起來沒生效。原因：`Overlay.render` 在「只顯示原文」時把原文渲染成 `90% × fontScale` 的**次要尺寸**（設計上原文是雙語的配角），單獨顯示時偏小、像沒套字級。

本設計把開關改為 **3 段循環**並修正原文模式字級。

## 範圍

- ✅ 開關 3 段循環：`雙語 → 原文 → 關閉`，狀態存 `chrome.storage.local.immersiveMode`（`'bilingual' | 'original' | 'off'`，預設 `bilingual`），取代原本布林 `immersiveEnabled`。
- ✅ YouTube「關閉」= overlay 完全 unmount（只剩原生 CC）、不送翻譯。
- ✅ YouTube「原文」= overlay 只顯示原文、以**主要尺寸**（`120% × fontScale`）渲染，使字級倍率明顯生效；不送翻譯。
- ✅ Netflix：雙語注入譯文；原文/關閉都不注入（只剩原生字幕）。
- ✅ 跨分頁同步（`storage.onChanged`，key 改 `immersiveMode`）。
- ❌ 不做設定的即時套用（改 `fontScale` 仍需重載分頁；非本次回饋重點，維持現狀）。
- ❌ 不替 Netflix 注入譯文套 `fontScale`（維持固定 110%；使用者未提）。
- ❌ 不保留舊 `immersiveEnabled` key 的遷移（直接改用 `immersiveMode`，預設 bilingual，等同舊預設 ON）。

## 架構

沿用既有元件，改三處：`toggle-store`（狀態型別由布林改字串列舉）、`ToggleButton`（兩態改三態循環）、兩個 content entry 的套用邏輯與 YouTube overlay 原文尺寸。

### 1. `src/core/toggle-store.ts`（修改，純邏輯 TDD）

```ts
export type ImmersiveMode = 'bilingual' | 'original' | 'off'
export async function loadMode(): Promise<ImmersiveMode>   // 預設 'bilingual'
export async function saveMode(mode: ImmersiveMode): Promise<void>
```

- `loadMode` 讀 `immersiveMode`，未設過或非三值之一時回 `'bilingual'`。
- 取代原 `loadEnabled`/`saveEnabled`。測試覆蓋預設值、roundtrip、非法值回退。

### 2. `src/content/toggle-button.ts`（修改，整合層）

兩態布林改三態循環。

- 建構子：`constructor(getAnchor, onCycle: (mode: ImmersiveMode) => void, initialMode: ImmersiveMode)`。
- 點擊：依序 `bilingual → original → off → bilingual`，更新外觀並呼叫 `onCycle(newMode)`。
- `setMode(mode)`：外部（其他分頁）同步外觀，不觸發 `onCycle`。
- 外觀文字：`bilingual → '雙語 ✓'`、`original → '原文'`、`off → '關閉'`。

### 3. `src/content/overlay.ts`（修改，YouTube 原文尺寸）

`Overlay` 新增「原文以主要尺寸呈現」的能力。

- 加 `setOriginalOnly(v: boolean)`（或等義旗標）：為 true 時，`render` 的「只顯示原文」分支把原文用 `120% × fontScale`（主要尺寸）而非 `90% × fontScale`。
- 雙語分支不變（原文 90% 次要、譯文 120% 主要）。

### 4. `src/content/content.ts`（修改，YouTube 套用 mode）

- 啟動 `loadMode()` → `let mode`。
- `applyMode(mode)`：
  - `bilingual`：overlay.mount()、`setBilingual(true)`、`setOriginalOnly(false)`；若有 `lastCues/lastCtx` 補翻顯示。
  - `original`：overlay.mount()、`setBilingual(false)`、`setOriginalOnly(true)`（原文主要尺寸）；不送翻譯。
  - `off`：`overlay.unmount()`；不送翻譯。
- `onSubtitleTrack`：一律記 `lastCues/lastCtx`；`bilingual` 才送翻譯；`bilingual/original` 才 `overlay.mount()`＋顯示原文；`off` 不 mount。
- `armNoCuesTimer`：僅 `bilingual/original`（即非 off）才提示開 CC；`off` 不提示。
- `ToggleButton` 的 `onCycle` → `applyMode(mode)` + `saveMode(mode)`。
- `storage.onChanged`（`immersiveMode`）→ `setMode` + `applyMode`。

### 5. `src/content/netflix-content.ts`（修改，Netflix 套用 mode）

- 啟動 `loadMode()` → `let mode`。
- `onLine`：僅 `bilingual` 才送 `TRANSLATE_LINE` + 注入；`original`/`off` 一律 `injector.clear()` 不送請求。
- `applyMode(mode)`：非 `bilingual`（即 original 或 off）→ `injector.clear()`。
- `armNoSubTimer`：僅 `bilingual` 才提示開字幕（原文/關閉都不需翻譯，不提示）。
- `ToggleButton` onCycle / `storage.onChanged` 同 YouTube 接法。
- 註：Netflix 上 `original` 與 `off` 行為相同（皆只剩原生字幕），屬可接受的小重複。

## 資料流

```
content 啟動 → loadMode()（預設 bilingual）→ ToggleButton(initialMode) + mount
點按鈕 → 循環 bilingual→original→off → onCycle(mode) → saveMode + applyMode
                                          └→ storage 變更 → 他分頁 onChanged → setMode + applyMode
字幕事件 → 記 lastCues/onLine；僅 bilingual 才翻譯+雙語；original 顯示原文(YouTube 主要尺寸)；off 隱藏
```

## 錯誤處理與邊界

- **off → bilingual**：YouTube 用 `lastCues/lastCtx` 補翻，不重抓整軌；Netflix 等下一行。
- **off 時新字幕到**：YouTube 不 mount overlay；Netflix 不注入。
- **anchor 晚出現 / SPA 換片**：`mount()` 沿用 idempotent 重取 anchor；換片重置時依 mode 重新套用。
- **多分頁**：共用 `immersiveMode`，`storage.onChanged` 同步按鈕與顯示。
- **Netflix original≡off**：兩態視覺相同，無害；按鈕仍循環 3 標籤與 YouTube 一致。

## 測試

- **單元（Vitest, TDD）**：`tests/toggle-store.test.ts` 改測 `loadMode` 預設 `'bilingual'`、roundtrip、非法值回退 `'bilingual'`、`saveMode` 寫入 `immersiveMode` key。
- **手動（Playwright 合成頁 + 真實站台）**：
  1. 按鈕循環 `雙語 ✓ → 原文 → 關閉 → 雙語`。
  2. YouTube：雙語=原文+譯文；原文=只原文且字級倍率明顯（主要尺寸）；關閉=我們 overlay 消失（只剩原生 CC）。
  3. Netflix：雙語=注入譯文；原文/關閉=只原生字幕、不送翻譯（server log 佐證）。
  4. 重載記住 mode；兩分頁切換同步。

## 受影響檔案

- 修改：`src/core/toggle-store.ts`（型別改 mode）、`src/content/toggle-button.ts`（三態）、`src/content/overlay.ts`（原文主要尺寸）、`src/content/content.ts`、`src/content/netflix-content.ts`、`tests/toggle-store.test.ts`。
- 不需改：manifest、background、injector、notice、settings/options。
