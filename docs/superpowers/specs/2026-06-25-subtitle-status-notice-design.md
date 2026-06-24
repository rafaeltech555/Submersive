# Submersive — 字幕狀態提示（無字幕／翻譯失敗）設計

## 背景與目標

目前 Submersive 在兩種情境下只在 console `warn`，使用者完全看不到回饋：

1. **翻譯失敗**：`content.ts` 收到 `TRANSLATE_ERROR`（或非 `TRANSLATE_RESULT`）時，僅 `console.warn('[submersive] translate failed', ...)`。常見原因包括 DeepL/Azure key 無效或額度用盡、本機 LibreTranslate server 未啟動。
2. **無字幕／CC 未開**：MAIN-world hook 只在 `timedtext` 請求發生時觸發；使用者沒開 CC 字幕就不會有請求，`onSubtitleTrack` 永不觸發，畫面上毫無提示，使用者不知道該開 CC。

這是 implementation plan（`docs/plans/2026-06-23-dualsub-youtube-immersive-translation.md`）Self-Review 明列的已知缺口（§8「影片無字幕通知使用者」目前僅 console warn）。本設計補上**使用者可見的狀態提示**。

本設計只涵蓋 YouTube（現有站台）。NetflixAdapter 為另一獨立 feature，走自己的 spec。

## 範圍

- ✅ 翻譯失敗時，於播放器上顯示可見、會自動消失的提示。
- ✅ 偵測到影片但一段時間內未攔到任何字幕時，提示使用者開啟 CC。
- ❌ 不做 Netflix 或其他站台（另開 spec）。
- ❌ 不精準區分「影片無字幕軌」與「有字幕但 CC 未開」——採時間門檻啟發式，兩者都導向同一句「請開啟 CC」提示（YAGNI；避免耦合 YouTube 非公開 player API）。

## 架構

沿用現有四層架構，本功能集中在 content 整合層，僅抽一個純函式到 core 做單元測試。依現有慣例：`core/`、`translation/` 為可單元測試的純模組；`content/`（如 `overlay.ts`）為瀏覽器整合層，靠手動驗證。

### 1. `src/content/notice.ts`（新增，整合層）

`Notice` class，負責在播放器上顯示**狀態訊息**，與 `Overlay`（只負責字幕）職責分離。

- 建構子：`constructor(getAnchor: () => HTMLElement | null)`，anchor 沿用 `#movie_player`。
- DOM：建立一個 `div#submersive-notice`，定位於播放器**上方中央**（與底部字幕 overlay 錯開），半透明深色底、白字、`pointer-events: none`、`z-index` 與 overlay 同層級。
- API：
  - `show(msg: string, opts?: { autoHideMs?: number }): void`
    - mount 到 anchor（若尚未 mount），設定文字並顯示。
    - 若帶 `autoHideMs`，啟動一個一次性計時器，到時自動 `hide()`；每次 `show` 會清掉前一個未觸發的自動隱藏計時器，避免殘留。
  - `hide(): void`：隱藏並清除自動隱藏計時器。
- 不做單元測試（DOM/計時器副作用，屬整合層，同 `overlay.ts` 慣例），以手動驗證涵蓋。

### 2. `src/core/translate-error.ts`（新增，純函式，TDD）

`friendlyTranslateError(error: string | undefined): string`，把後端原始 error 字串映射成友善繁中提示。

對應規則（依序比對，case-insensitive；命中即回傳）：

| error 字串包含 | 回傳訊息 |
|---|---|
| `403`、`456`、`401`、`Authorization`、`auth` | `翻譯失敗：API key 無效或額度用盡，請至設定檢查` |
| `Failed to fetch`、`localhost`、`127.0.0.1`、`ECONNREFUSED`、`NetworkError` | `翻譯失敗：本機翻譯 server 未啟動或無法連線` |
| `length mismatch` | `翻譯失敗：翻譯結果長度不符，請稍後重試` |
| 其他（含空字串／undefined） | `翻譯失敗：{原始訊息}`（空值時為 `翻譯失敗：未知錯誤`） |

純字串輸入輸出，為本功能唯一可測的純邏輯，以 Vitest 覆蓋上述每條分支。

### 3. `src/content/content.ts`（修改，接線）

引入 `Notice` 與 `friendlyTranslateError`，並建立無字幕偵測。

#### 翻譯失敗

現有 `else` 分支改為：

```ts
} else {
  console.warn('[submersive] translate failed', res?.error)
  notice.show(friendlyTranslateError(res?.error), { autoHideMs: 6000 })
}
```

翻譯失敗提示 6 秒後自動消失。

#### 無字幕／CC 未開（時間門檻啟發式）

狀態：`let gotCues = false`、`let timer: number | undefined`、`let currentVideoId: string | null`。

- **arm**：偵測到 video（`detectVideo()` 有 ctx）後，監聽 video element 的 `playing` 事件；首次 `playing` 時若計時器尚未啟動且 `!gotCues`，arm 一個 5 秒一次性計時器。
- **觸發**：計時器到時若仍 `!gotCues`，呼叫 `notice.show('請開啟 CC 字幕以啟用雙語翻譯')`（**常駐**，不帶 `autoHideMs`）。
- **取消**：`onSubtitleTrack` 攔到 cue 時設 `gotCues = true`、`notice.hide()`、清計時器。
- **SPA 換片重置**：YouTube 為 SPA，換片不重載頁面、videoId 改變。監聽 `document` 的 `yt-navigate-finish` 事件（YouTube 換頁完成事件）；若新的 `detectVideo()?.videoId` 與 `currentVideoId` 不同，重置 `gotCues = false`、清計時器、`notice.hide()`、更新 `currentVideoId`，並重新 arm。

常數 `NO_CUES_TIMEOUT_MS = 5000` 置於 content.ts 頂部，便於調整。

## 資料流

```
影片載入 / 換片
  └─ detectVideo() 有 ctx → 監聽 video 'playing' → arm 5s timer
       ├─ 期間 onSubtitleTrack 攔到 cue → gotCues=true, hide notice, 清 timer（正常路徑）
       └─ 5s 後仍無 cue → show「請開啟 CC 字幕」(常駐)

攔到 cue → 送 TRANSLATE → background
  ├─ TRANSLATE_RESULT → overlay 雙語（無 notice）
  └─ 失敗 → notice.show(friendlyTranslateError(error), autoHideMs:6000)
```

## 錯誤處理與邊界

- **重複 show**：每次 `show` 清前一個自動隱藏計時器，避免舊計時器提早關掉新訊息。
- **anchor 尚未存在**：`#movie_player` 在 `document_start` 時可能還沒出現；`Notice.show` 每次都重新嘗試取 anchor 並 mount（與 `Overlay.mount` 同策略）。
- **換片後殘留**：靠 `yt-navigate-finish` + videoId 比對重置，避免上一部片的 `gotCues` 或常駐提示殘留到新片。
- **翻譯失敗與無字幕互斥性**：翻譯失敗發生在已有 cue 之後（`gotCues=true`），此時無字幕提示已被 `hide`，兩者不會同時顯示。

## 測試

- **單元測試（Vitest）**：`tests/translate-error.test.ts` 覆蓋 `friendlyTranslateError` 的每條映射分支（auth/額度、本機 server、length mismatch、其他、空值）。
- **手動驗證**（content 整合層）：
  1. **翻譯失敗**：清空 DeepL key → 開有 CC 的影片並開 CC → 出現「API key 無效或額度用盡」提示，6 秒後消失。engine 設 local 但本機 server 沒開 → 出現「本機翻譯 server 未啟動」。
  2. **無字幕提示**：開影片但**不開 CC** → 約 5 秒後播放器上方出現「請開啟 CC 字幕以啟用雙語翻譯」；接著手動開 CC 攔到字幕 → 提示消失、出現雙語字幕。
  3. **換片重置**：在無字幕提示顯示中，透過 YouTube 內部連結換到另一部有開 CC 的片 → 舊提示消失、新片正常出字幕。

## 受影響檔案

- 新增：`src/content/notice.ts`、`src/core/translate-error.ts`、`tests/translate-error.test.ts`
- 修改：`src/content/content.ts`
- 不需改：manifest（無新權限）、overlay、background、settings。
