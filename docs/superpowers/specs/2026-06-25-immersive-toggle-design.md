# Submersive — 沉浸翻譯即時開關設計

## 背景與目標

使用者不是隨時都需要沉浸式雙語翻譯（有時只想看原文）。目前 Submersive 一旦載入就一直翻譯/顯示，無法在看片途中關掉。本設計新增一個**浮在播放器上的小按鈕**，讓使用者**即時開/關**沉浸翻譯，狀態跨分頁/重載記憶。

## 範圍

- ✅ 播放器角落一顆**自有浮動按鈕**，顯示目前狀態，點擊切換 ON/OFF。
- ✅ **OFF = 停止翻譯（不送 translate 請求）+ 清掉已顯示的譯文**；原文不受影響。
- ✅ 狀態存 `chrome.storage.local`，**預設 ON**，跨分頁/重載記憶，YouTube 與 Netflix **共用同一全域開關**（用 `chrome.storage.onChanged` 同步）。
- ❌ 不做鍵盤快捷鍵、不做工具列 popup 開關（YAGNI；按鈕已涵蓋需求）。
- ❌ 不做 YouTube/Netflix 各自獨立開關（共用一個全域狀態即可）。
- ❌ 不碰站台原生控制列 DOM（按鈕是我們自有的 `position:absolute` 元件，避免選擇器脆弱）。

## 架構

沿用現有四層慣例：新增一個 content 整合層元件 `ToggleButton`（仿 `Notice`/`Overlay`，DOM 副作用靠手動驗證），兩個 content entry（`content.ts`、`netflix-content.ts`）各建一個並接上既有的翻譯/顯示流程；開關狀態集中放 `core` 的純函式 + `chrome.storage`。

### 1. `src/core/toggle-store.ts`（新增，純邏輯，TDD）

封裝開關狀態的讀寫，與 `settings-store` 並列。

- `loadEnabled(): Promise<boolean>` — 讀 `chrome.storage.local` 的 `immersiveEnabled`，**預設 `true`**（未設過時回 true）。
- `saveEnabled(on: boolean): Promise<void>` — 寫入。
- 純讀寫，可用 mock `chrome.storage` 單元測試（預設值、round-trip）。

### 2. `src/content/toggle-button.ts`（新增，整合層）

`ToggleButton` class，在播放器上顯示可點的開關。

- 建構子：`constructor(getAnchor: () => HTMLElement | null, onToggle: (on: boolean) => void, initialOn: boolean)`。
- DOM：建立 `div#submersive-toggle`，定位於播放器**右上角**（`position:absolute; top:8px; right:8px`），半透明深底白字藥丸，**`pointer-events:auto`**（要可點，與 Notice 的 `none` 不同），`z-index` 與 overlay 同層。
- 內部維護 `on` 狀態，點擊時翻轉、呼叫 `onToggle(newOn)`、更新外觀文字。
- API：
  - `mount()`：每次重新取 anchor 並掛上（anchor 可能晚出現，同 Overlay/Notice 策略）。
  - `setState(on: boolean)`：外部（如其他分頁改了狀態）同步外觀，不觸發 `onToggle`。
- 外觀文字：ON → 「雙語 ✓」；OFF →「原文」（純文字，不依賴圖檔）。
- 不做單元測試（DOM/事件副作用，屬整合層，同 overlay/notice 慣例），以手動驗證涵蓋。

### 3. `src/content/content.ts`（修改，YouTube 接線）

- 啟動時 `loadEnabled()` → `let enabled`，建 `ToggleButton`（anchor 沿用 `#movie_player`），`mount()`。
- `onSubtitleTrack`：
  - 一律 `overlay.setCues(cues); overlay.mount()`（原文照顯示）。
  - 只有 `enabled` 才送 `TRANSLATE`、回來 `setBilingual(true)`；否則不送、保持 `setBilingual(false)`。
- `onToggle(on)`：更新 `enabled`、`saveEnabled(on)`：
  - **ON**：若目前該片已有攔到的 cues（記住最後一批 `lastCues`/`lastCtx`），立即補送 `TRANSLATE` 並顯示；否則等下次字幕。
  - **OFF**：`overlay.setBilingual(false)`（畫面只剩原文，譯文消失）。
- 監聽 `chrome.storage.onChanged`：別的分頁改了 `immersiveEnabled` → 更新 `enabled` + `toggleButton.setState(on)` + 套用上述 ON/OFF 顯示。

### 4. `src/content/netflix-content.ts`（修改，Netflix 接線）

- 啟動時 `loadEnabled()` → `enabled`，建 `ToggleButton`（anchor 用 `getPlayerRoot`），`mount()`（在 `startWatching`/換片時一併確保 mount）。
- `onLine(text)`：只有 `enabled` 才送 `TRANSLATE_LINE`/`injector.setTranslation`；OFF 時 `injector.clear()` 且不送請求。
- `onToggle(on)`：更新 `enabled`、`saveEnabled(on)`：
  - **OFF**：`injector.clear()`（移除譯文行）。
  - **ON**：下一行字幕自然會翻譯注入（per-line，不需補翻當前行；如要可選對 `currentLine` 立即補一次，MVP 不做）。
- 同樣監聽 `chrome.storage.onChanged` 同步 `enabled` + 按鈕外觀 + OFF 時 `injector.clear()`。

## 資料流

```
content 啟動 → loadEnabled()（預設 ON）→ 建 ToggleButton(initialOn) + mount
點按鈕 → on 翻轉 → onToggle(on) → saveEnabled(on) + 立即套用顯示
                                   └→ storage 變更 → 其他分頁 onChanged → setState + 套用
字幕事件（YT onSubtitleTrack / NF onLine）→ 若 enabled 才翻譯+顯示；否則只留原文
```

## 錯誤處理與邊界

- **anchor 尚未出現**：`mount()` 每次重取 anchor（同 Overlay/Notice），播放器晚載入也能補掛。
- **SPA 換片**：換片重置流程中一併 `toggleButton.mount()`（Netflix）/ 依賴 `#movie_player` 穩定（YouTube）。確保換片後按鈕還在、狀態不變（全域）。
- **OFF 期間攔到字幕**：YouTube 仍顯示原文 overlay、不送翻譯；Netflix 原生字幕本就在、我們不注入。
- **ON 補翻（YouTube）**：需記住該片最後一批 cues + ctx，避免 ON 時整軌重抓；換片時清掉這份暫存。
- **多分頁一致性**：靠 `chrome.storage.onChanged`；同一狀態 key，避免兩分頁顯示不一致。
- **按鈕與字幕重疊**：按鈕在右上、字幕在底部，錯開；`pointer-events:auto` 僅按鈕本身，不擋影片。

## 測試

- **單元測試（Vitest, TDD）**：`tests/toggle-store.test.ts` — `loadEnabled` 預設 true、寫入後讀回、`saveEnabled` 寫入正確 key（mock `chrome.storage.local`）。
- **手動驗證（整合層）**，沿用 Playwright 合成頁 + 真實站台：
  1. 按鈕出現在播放器右上、顯示 ON。
  2. 點一下 → 變 OFF：YouTube 雙語譯文消失剩原文 / Netflix 注入譯文消失；且不再送翻譯請求。
  3. 再點 → ON：恢復翻譯顯示。
  4. 重載分頁 → 記住上次狀態。
  5. 兩個分頁 → 一邊切換，另一邊按鈕與顯示同步。

## 受影響檔案

- 新增：`src/core/toggle-store.ts`、`src/content/toggle-button.ts`、`tests/toggle-store.test.ts`。
- 修改：`src/content/content.ts`（YouTube 接線 + 記住 lastCues）、`src/content/netflix-content.ts`（Netflix 接線）。
- 不需改：manifest（無新權限，storage 已有）、background、overlay、injector、settings/options。
