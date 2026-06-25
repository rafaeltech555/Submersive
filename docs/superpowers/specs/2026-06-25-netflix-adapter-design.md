# Submersive — NetflixAdapter 設計（DOM 讀取 + 原生字幕下方注入譯文）

## 背景與目標

Submersive 目前只支援 YouTube：MAIN-world hook 攔截 `timedtext` 字幕請求 → `parseJson3` 解析整軌 → background 批次翻譯 + cache → `Overlay` 元件在播放器底部繪製雙語字幕。

本設計把沉浸式雙語字幕擴展到 **Netflix**。Netflix 的字幕傳遞與顯示機制與 YouTube 根本不同，因此採取與 YouTube **不同的取得與顯示策略**，自成一條獨立 content 流程，只共用 background 翻譯、Notice、錯誤映射、cache 等核心。

### 關鍵決策（brainstorming 結論）

1. **字幕來源：讀 DOM 已渲染字幕。** Netflix 會把當前字幕行渲染進 `.player-timedtext` DOM；用 `MutationObserver` 讀畫面上那一行，**不攔網路、不解析 TTML/WebVTT、不碰 DRM**。代價：只拿得到「目前這行」，無法整軌預抓，翻譯改為逐行。
2. **雙語呈現：保留原生字幕 + 下方注入譯文。** Netflix 原生字幕（原文）不動，只在其下方注入一行譯文。時間軸/同步完全交給 Netflix。
3. **程式碼組織：兩個獨立 content entry。** `content.ts`（YouTube）維持不動；新增 `netflix-content.ts`，manifest 依 host match 路由。
4. **偏離舊假設：** 先前 memory 假設「Netflix 實作既有 `SiteAdapter` 介面」。該介面（`onSubtitleTrack→Cue[]` + `getPlayerTime` overlay loop）是為「攔截 + overlay」設計，套不進「DOM 逐行 + 注入」，故 Netflix **不沿用 `SiteAdapter`**，改用自己的小模組。YouTube 的 `SiteAdapter` / `YouTubeAdapter` 保留不動。

## 範圍

- ✅ 核心：Netflix 播放時逐行讀原文 → 翻譯 → 在原生字幕下方注入譯文。
- ✅ 翻譯失敗提示（重用 `Notice` + `friendlyTranslateError`，6s 自動消失，含防洪）。
- ✅ 未選字幕提示（時間門檻啟發式，類 YouTube 的「請開啟 CC」）。
- ✅ 逐行翻譯 cache（以原文文字為 key）。
- ❌ 不攔截 Netflix 字幕檔、不解析 TTML/WebVTT（YAGNI，避開 DRM 與非公開格式）。
- ❌ overlay 樣式設定（`showOriginal`/`originalFirst`/`fontScale`/`verticalPos`/`bgOpacity`）在 Netflix **不適用**——原文由 Netflix 自己渲染，我們只加譯文行（簡單預設樣式跟著 Netflix 字幕走）。僅 `targetLang` + `engine` 生效。
- ❌ 不重構 YouTube 既有流程。

## 架構

新增模組全為 Netflix 專屬，跑在 **ISOLATED world**，**不需要 MAIN-world hook**（無網路攔截）。

### 新增檔案

| 檔案 | 職責 | 可測性 |
|---|---|---|
| `src/sites/netflix/player.ts` | 定位播放器容器、`<video>`、從 `/watch/<id>` 取 videoId、SPA 換片偵測 | 薄 DOM 層，手動驗證 |
| `src/sites/netflix/subtitle-observer.ts` | `MutationObserver` 監看字幕容器；含純函式 `extractLineText(container) → string`，當前原文行變更時 callback | `extractLineText` 單元測試 |
| `src/sites/netflix/injector.ts` | `Injector` class：在原生字幕下方注入/更新譯文行、清除、React 重渲染時重新注入 | DOM 副作用，手動驗證 |
| `src/content/netflix-content.ts` | 編排：定位 → 觀察 → 逐行送翻譯 → 注入；接 Notice / 無字幕 timer / SPA reset | 整合層，手動驗證 |

選擇器常數（`.player-timedtext` 等 Netflix 非公開 DOM）集中放在 `player.ts` / `subtitle-observer.ts`，方便改版時單點修。

### 共用既有（不改其行為）

`Notice`、`friendlyTranslateError`、`cache.ts`、`types`（`Cue` / `Settings` / 訊息聯集）、`settings-store`。

### background 新增訊息路徑

`TRANSLATE_LINE`（逐行、文字級 cache），與 YouTube 既有整軌 `TRANSLATE` 並存、互不干擾（見〈資料流〉）。

### manifest 變更

- `host_permissions` 加 `https://*.netflix.com/*`。
- `content_scripts` 加一條：`matches: ['https://*.netflix.com/*']`、`js: ['src/content/netflix-content.ts']`、`world: 'ISOLATED'`、`run_at: 'document_idle'`（播放器載入晚）。**只有這一條，無 MAIN hook。**
- `content.ts`（YouTube）完全不動。
- web_accessible_resources：@crxjs 會依 content_scripts 的 match 自動補（動態 import chunk 需涵蓋 netflix origin）。

## 資料流

### 逐行雙語主流程

```
netflix-content.ts 啟動
  └─ player.ts 定位 .player-timedtext 容器 + <video> + videoId（容器未現則輪詢重試 ~30s）
       └─ subtitle-observer 監看容器
            ├─ 原文行變更為 L（非空）
            │    ├─ currentLine = L（守門用）
            │    ├─ sendMessage TRANSLATE_LINE { text:L, srcLang:null, targetLang, engine }
            │    └─ 回來時：currentLine 仍 === L 且未換片 → injector.setTranslation(T)
            │                否則丟棄（避免舊行譯文蓋到新行）
            └─ 原文行清空 → injector.clear()
```

### `TRANSLATE_LINE`（background 新增 handler）

- 訊息：`{ type:'TRANSLATE_LINE', text, srcLang, targetLang, engine }`
  → 回 `{ type:'TRANSLATE_LINE_RESULT', text, translated }` 或 `{ type:'TRANSLATE_LINE_ERROR', text, error }`。
- 內部重用既有核心：`pickAdapter(engine)` + `runWithRetry` + adapter，batch 大小為 1。
- **逐行 cache**：在既有 `src/core/cache-key.ts` 加 `lineCacheKey(text, srcLang, targetLang, engine)`（與 `cacheKey` 同檔，不另開檔），重用 `cache.ts` 的 `'cues'` store（值存單元素 `Cue[]`）。先查 cache，命中直接回；miss 才打翻譯、寫入。
- 與 YouTube 整軌 `TRANSLATE` 完全並存：不同訊息型別、不同 cache key 命名空間（line key 含原文、track key 含 videoId），不互相覆蓋。

### 為什麼逐行仍走 background

翻譯 adapter 在 background SW 跑（有 host_permissions、避開 CORS）；cache 的 IndexedDB 在 extension origin，content script（netflix.com origin）拿不到。content 只負責讀 DOM + 注入，翻譯與 cache 都在 background。

### 守門（stale 丟棄）

對應 YouTube 的 `currentVideoId !== expectedId`，Netflix 用「當前原文行 + 當前 videoId」雙重守門——慢回來的譯文若已不是當前行或已換片，直接丟棄不注入。

## 錯誤處理與邊界

- **翻譯失敗提示：** `TRANSLATE_LINE_ERROR` → `notice.show(friendlyTranslateError(error), { autoHideMs: 6000 })`。逐行失敗會每行觸發，故**防洪**：同訊息顯示中不重複 reset 計時器（或設最小重彈間隔）。該行單純不注入譯文，原文不受影響。
- **未選字幕提示：** `<video>` `playing` 後 arm 5s 計時器；期間攔到任何原文行即取消；逾時仍無字幕 → `notice.show('請開啟字幕以啟用雙語翻譯')`（常駐）。攔到第一行即 `hide` + 清計時器。常數 `NO_SUBTITLE_TIMEOUT_MS = 5000`。
- **SPA 換片重置：** Netflix 為 SPA、`/watch/<id>` 變更不重載、**無 `yt-navigate-finish` 對應事件**。改用 videoId 輪詢（小 interval 比對 `location.pathname` 的 id，或監看 player 容器重掛）。videoId 變 → 重置 `currentLine`、清 injector、`notice.hide()`、清計時器、重新定位 + 重掛 observer + 重 arm。
- **React 重渲染導致注入消失：** Netflix 換行時重建字幕子樹，注入節點會被沖掉。解法：observer 同時驅動「讀新原文」與「重新注入」，每次字幕變更都重算重注入，不依賴注入節點長存；注入點選在較穩的容器層。
- **容器尚未出現：** `document_idle` 時 `.player-timedtext` 可能還沒長出；輪詢重試定位（上限 ~30s，同 YouTube `startWatching` 慣例）。
- **邊界互斥：** 無字幕提示（沒攔到行）與翻譯失敗提示（有行才會翻、才可能失敗）天然互斥。
- **選擇器脆弱性（已知風險）：** Netflix 非公開 DOM 改版可能讓選擇器失效；偵測不到時 degrade 成無字幕提示，不崩潰。

## 測試

沿用慣例：`core/` 純邏輯走 Vitest TDD；content/observer/injector 整合層靠手動驗證。

### 單元測試（Vitest，TDD）

- `extractLineText(container)`：給 Netflix 形狀的字幕 DOM（多 span/巢狀），斷言抽出原文正確（空白合併、空節點回空字串）。
- `lineCacheKey(text, srcLang, targetLang, engine)`：key 格式穩定、不同輸入不碰撞、與整軌 `cacheKey` 命名空間不重疊。
- background `translateLine` 的 cache 命中/未命中：注入 `fetchFn` mock + `fake-indexeddb`（同 `cache.test.ts` / adapter 測試慣例），驗 miss 打翻譯並寫入、hit 不再打翻譯。

### 手動驗證（整合層）

真實 Netflix 需登入 + DRM 播放，難全自動。

- **主要：** Playwright + 合成「Netflix 形狀」DOM 頁（沿用 YouTube 字幕狀態提示驗證建好的 harness 模式）驗 observer→translate→inject、SPA reset、無字幕 timer、失敗提示——可控可重現。
- **真實 Netflix live smoke** 補一眼（實際 `.player-timedtext` 結構、換片、選/不選字幕軌），列為待驗項；選擇器對不上就在此抓出。

### 驗證情境

1. 播放有字幕的片 → 原文行下方出現譯文；換行時譯文跟著換、不殘留舊行。
2. 不選字幕軌 → ~5s 後出現「請開啟字幕」；選了字幕軌攔到行 → 提示消失、出譯文。
3. 翻譯失敗（engine 指向不可用）→ 出現失敗提示、6s 消失、且不每行洪水彈。
4. SPA 換到另一部片 → 舊提示/舊譯文清空、新片正常逐行雙語。
5. 重看同片/重複句子 → 走 cache、不重打翻譯（background log 或 mock 計數佐證）。

## 受影響檔案

- 新增：`src/sites/netflix/player.ts`、`src/sites/netflix/subtitle-observer.ts`、`src/sites/netflix/injector.ts`、`src/content/netflix-content.ts`。
- 新增測試：`tests/netflix-extract-line.test.ts`、`tests/line-cache-key.test.ts`、`tests/translate-line.test.ts`。
- 修改：`src/manifest.ts`（host_permissions + 一條 content_scripts）、`src/background/background.ts`（加 `TRANSLATE_LINE` handler）、`src/core/cache-key.ts`（加 `lineCacheKey`）、`src/types.ts`（訊息聯集加 `TRANSLATE_LINE` / `TRANSLATE_LINE_RESULT` / `TRANSLATE_LINE_ERROR`）。
- 不改：`content.ts`、`overlay.ts`、`youtube-adapter.ts`、`hook.ts`、`site-adapter.ts`、settings/popup/options。
