# Submersive — Netflix 視窗化 on-demand 翻譯架構設計

## 背景與目標

`feat/netflix-proactive-subtitle` 分支真機驗證時，原文字幕已正常，但 **bilingual 譯文永遠出不來**。SW console + 本機壓測確認 root cause：

- 本機 LibreTranslate（CTranslate2/CPU）**~0.7 秒/句、線性累加**，且並發不會變快（array 16 句 = 12s、concurrent 16 句 = 11.5s，幾乎相同）。
- 現行架構在 `onSubtitleTrack` 時**一次翻整軌**：446 cues × 0.7s ≈ **5 分鐘**純後端時間，遠超過 **MV3 service worker 生命週期**（30 秒無活動即可能被回收、5 分鐘硬上限）。
- 結果：SW 的 `fetch` 永不 settle → content 端 `await chrome.runtime.sendMessage` reject「message channel closed before a response was received」→ 譯文永遠回不來。
- 加重因素：`onSubtitleTrack` 在真機觸發 **3 次**（hook replay + adapter replay + live fetch），等於 3 條整軌翻譯並發互搶 CPU。

本設計把翻譯從「啟動時一次翻整軌」改成 **視窗化 on-demand**：只優先翻 playhead 前方一小段，邊播邊補，背景再低優先補完整軌，逐句持久化快取。核心目標是**從結構上消除 SW 生命週期問題**——每次後端請求都短到必定在 SW 存活期內完成。

## 範圍

- ✅ 新增 `src/content/translation-scheduler.ts`：純邏輯排程器（可注入 clock / translate fn，單元測試）。
- ✅ `background.ts`：把整軌的 `TRANSLATE` handler 改成小批次 `TRANSLATE_BATCH`（cache-aware、miss 才打一次 adapter）。
- ✅ `netflix-content.ts`：以 scheduler 取代 `translateAndShow` 整軌路線；建立 / 啟停 scheduler、餵 cues + `getPlayerTime`。
- ✅ 逐句持久化快取：**重用**既有 `core/cache.ts` 的 `cues` store + `core/cache-key.ts` 的 `lineCacheKey`（**不改 IDB schema**）。
- ✅ 順帶消滅 3× 並發：改成單一 scheduler 持有狀態，重複到達的相同 cue track 只更新引用、不重啟翻譯。
- ❌ 不改 `overlay.ts`：其 render loop 每幀重讀 `cue.translated`，scheduler 就地填值即自動顯示（見〈資料流〉）。
- ❌ 不改 `adapter.ts` / `local-adapter.ts` / `queue.ts` / opencc 簡轉繁（重用）。
- ❌ 不動 YouTube 路線（`content.ts` 仍走既有 `translateAndShow`，本次只改 Netflix；YouTube 後續可比照遷移，非本 spec 範圍）。
- ❌ 不做後端提速（CPU transformer 推論本就慢、無 GPU；使用者偏好本機，故以「架構容忍慢」為主）。
- ❌ 不刪 `translate-line.ts` / `TRANSLATE_LINE` handler（保留備用）。

## 整體架構

```
content world (netflix-content.ts)           background SW (background.ts)
──────────────────────────────────           ────────────────────────────
NetflixAdapter.onSubtitleTrack ─┐
                                v
              TranslationScheduler
              ├ 持有 cues[]（與 Overlay 同一引用）
              ├ getPlayerTime() 算視窗
              ├ 優先佇列：視窗 → 背景
              ├ 序列化單一 in-flight 批次
              └ 每批 ≤8 句、≤2000 字
                       │ TRANSLATE_BATCH {texts,srcLang,target,engine}
                       └──────────────────────────>  逐句查 lineCacheKey 快取
                                                      收集 miss → 一次 adapter.translateBatch
                                                      回填快取 + opencc 簡轉繁
                       <──────────────────────────   回 {translated[]}（順序對齊輸入）
              就地寫 cues[idx].translated = translated[i]
                       │
                       v
              Overlay rAF loop 下一幀讀到 translated → 顯示第二行
```

### 1. `src/content/translation-scheduler.ts`（新）

純邏輯類別，**不直接碰 chrome API**（translate 以函式注入，便於測試）：

```ts
export interface SchedulerDeps {
  getTime: () => number                                   // playhead 秒數（video.currentTime）
  translate: (texts: string[]) => Promise<string[]>       // 包 chrome.runtime.sendMessage(TRANSLATE_BATCH)
  notify: (msg: string | null) => void                    // 顯示 Notice；傳 null 清除（注入便於測試）
  setTimer: (fn: () => void, ms: number) => number        // 注入 setTimeout
  clearTimer: (id: number) => void                        // 注入 clearTimeout
}

export class TranslationScheduler {
  setCues(cues: Cue[]): void   // 設定 / 更新要翻的 cue 陣列（就地 mutate 同一引用）
  start(): void                // 開始排程（bilingual 進入時）
  stop(): void                 // 停止 + 清 timer（off/original/換片）
}
```

排程狀態：
- `cues: Cue[]`（外部傳入的同一引用；填譯文就地寫 `cues[i].translated`）。
- `translatedIdx: Set<number>`、`inflightIdx: Set<number>`（去重，避免同句重送）。
- `failCount: number`（指數退避用）、`noticeShown: boolean`。

### 2. `background.ts` — `TRANSLATE_BATCH` handler（改）

取代整軌 `TRANSLATE`。輸入小批次 texts，回對齊順序的 translated[]：

```
onMessage TRANSLATE_BATCH {texts, srcLang, targetLang, engine}
  1. 對每個 text 算 lineCacheKey，查 cache（getCached）→ 命中填入結果槽
  2. 收集所有 miss 的 texts
  3. 若有 miss：一次 adapter.translateBatch(misses)（過 runWithRetry）→ opencc 已在 adapter 內
  4. 逐句 putCached(lineCacheKey, [{start:0,dur:0,text,translated}])（沿用 translate-line.ts 寫法）
  5. 組回與輸入同序的 translated[]，sendResponse({type:'TRANSLATE_BATCH_RESULT', translated})
  失敗 → sendResponse({type:'TRANSLATE_BATCH_ERROR', error})
```

要點：每批 ≤8 句 → 最壞 ~5.6s → **必定在 SW 存活期內完成**，不需 keepalive。`pickAdapter` / fallback 邏輯沿用現有。

### 3. `netflix-content.ts`（改）

- 移除 `translateAndShow` 整軌路線。
- 建立單一 `TranslationScheduler`，`translate` 注入為包 `chrome.runtime.sendMessage({type:'TRANSLATE_BATCH', ...})` 的函式（含 try/catch，reject 視為批次失敗）。
- `onSubtitleTrack(cues, ctx)`：`overlay.setCues(cues)` + `scheduler.setCues(cues)`；若 `mode==='bilingual'` 則 `scheduler.start()`。重複到達相同 track 只 `setCues`（同內容 → 去重 Set 讓它不重翻）。
- `applyMode`：切到 `bilingual` → `scheduler.start()`；切到 `original`/`off` → `scheduler.stop()`。
- 換片（`onVideoMaybeChanged`）→ `scheduler.stop()` + 重建 / 清 cues。

## 排程邏輯（核心）

每次「選下一批」：

1. **視窗 cues**：`start ∈ [playhead, playhead + 90s]` 且 ∉ translatedIdx ∪ inflightIdx，依 `start` 升序。
2. 視窗為空才取 **背景 cues**：全體未翻 cues 依 `start` 升序的最前面。
3. 從選出的來源**依序**取，累積到 **≤8 句且字元總和 ≤2000** 為一批。
4. 該批 idx 全加入 `inflightIdx`，呼叫 `translate(texts)`。
5. 成功：逐 idx 寫 `cues[idx].translated`、移出 inflight、加入 translatedIdx、`failCount=0`、清 notice；**立即排下一批**（不等 tick）。
6. 失敗：移出 inflight（不標 translated，下輪可重試）、`failCount++`、指數退避 `min(500 * 2^failCount, 30000)ms` 後再排；首次失敗 `notify(friendlyTranslateError(...))`，下一批成功時 `notify(null)` 清除，恢復前不重跳。

驅動：
- **tick**：每 `1500ms` 依當前 playhead 重算視窗並嘗試排批（若無 in-flight）。
- **seek**：tick 重算視窗即自動讓新位置的 cues 進入視窗、搶在背景前；in-flight 的小批次跑完即可（最多浪費 ~5s）。
- **序列化**：恆定最多一個 in-flight 批次（並發無益、且保持 SW 請求短）。

收斂性：邊播 playhead 前進，視窗持續供給；視窗清空時背景補洞 → 整軌最終翻完並逐句入快取 → **重看 / 重複句秒出**（批次全 cache-hit、不打後端）。

## 資料流與「好了再填入」

`overlay.ts` 的 `loop()` 每個 rAF 幀做 `cues.find(t∈[start,start+dur))` 並讀 `cue.translated`（line 39、46）。因此：

- scheduler 與 overlay **共用同一個 `cues` 陣列引用**。
- 批次回來後 scheduler 只需 `cues[idx].translated = result`，**下一幀 overlay 自動顯示第二行**，無需再 `setCues`。
- 未翻的 cue（`translated == null`）在 bilingual 下 `hasTrans=false` → 自動只渲染原文（line 57–61），完全符合「只顯原文、好了再填入」。

## 錯誤處理

- 後端 down / 批次 reject：scheduler 指數退避重試（cap 30s），只跳一次 `Notice`，恢復後清掉。
- `TRANSLATE_BATCH_ERROR`：同上，當批失敗處理。
- 換片 / stop：清 timer、丟棄 in-flight 結果（回來時 cues 引用已換或 stopped，忽略）。
- SW respawn：無狀態，下一批正常喚醒；opencc Converter 於該 SW 生命期首次 `toTraditional` 初始化（觀看期間批次密集，SW 多半保持 warm，Converter 只初始化一次）。

## 參數（初值，之後可調）

| 參數 | 值 | 理由 |
|---|---|---|
| `WINDOW_AHEAD_SEC` | 90 | 領先 playhead 約 1.5 分鐘，密集對白也多半來得及 |
| `BATCH_MAX_CUES` | 8 | ~5.6s/批，安全落在 SW 存活期 |
| `BATCH_MAX_CHARS` | 2000 | 對齊 `LocalAdapter.capabilities().maxCharsPerReq` |
| `TICK_MS` | 1500 | 反應 seek / 補視窗 |
| `BACKOFF_CAP_MS` | 30000 | 後端故障時不狂打 |

## 測試

- `translation-scheduler.test.ts`（fake clock / fake translate / fake cues）：
  - 視窗優先於背景；背景僅在視窗清空時動。
  - 去重：同 idx 不重送；序列化：恆 ≤1 in-flight。
  - 批次上限：≤8 句且 ≤2000 字。
  - seek：playhead 跳動後新視窗 cues 搶先。
  - 就地填值：成功後 `cues[idx].translated` 被寫入。
  - 錯誤退避：失敗後依退避再試、notice 只跳一次。
- `background` `TRANSLATE_BATCH`（fake adapter + `fake-indexeddb`）：
  - cache hit/miss 切分正確；只對 miss 打一次 adapter。
  - 回填快取；輸出順序對齊輸入。
- 既有 54 tests 不得破壞（整軌 `TRANSLATE` 相關測試隨路線移除而調整）。

## 拒絕的替代方案

- **SW 內跑背景 job + keepalive（alarms/port）**：佇列與長迴圈放 SW，靠 keepalive 硬撐數分鐘。就是現行壞掉路線的加強版；SW respawn 掉狀態、脆弱，且仍逼近 5 分鐘硬上限。
- **維持整軌但切塊 + 漸進 + keepalive**：改動最小，但仍在和 SW 生命週期搏鬥，且不天然支援「視窗優先」。
- **逐句並發打滿多核加速**：實測並發不變快（CTranslate2 每請求已吃多核），且會讓 SW 請求變多變亂。

## 收尾

實作走 subagent-driven（見專案慣例）。本 spec 通過後 → `writing-plans` 拆 task → 逐 task 實作 + review。真機驗證 bilingual 譯文漸進出現後，併入既有 9 情境驗收，再委派 Sonnet renew docs + merge + push。
