# dualsub — YouTube 沉浸式即時翻譯擴充套件 設計文件

- **日期**：2026-06-23
- **狀態**：設計定稿，待實作
- **專案路徑**：`/home/finn/sideproject/dualsub/`
- **形態**：Chromium（Chrome/Edge）瀏覽器擴充套件（Manifest V3）

> 註：專案資料夾名 `dualsub`（dual subtitle）為暫定，可隨時重命名。

---

## 1. 目標與定位

讓使用者在**瀏覽器內**觀看影音時，取得**即時雙語字幕**。MVP 聚焦 YouTube 一站做透，定位為**純看片翻譯工具**：把雙語字幕做好、可選目標語言、可開關原文。

核心使用情境：

- 開啟一部有字幕的 YouTube 影片，自動顯示「原文 + 譯文」雙語字幕。
- 使用者可選擇目標語言、開關原文字幕、調整字幕樣式。
- 翻譯零成本（免費 API 或本機引擎），且免費額度撐得住一般觀看量。

### 非目標（YAGNI，明確排除）

- 桌面 app、Netflix 及其他站（MVP 暫不做，架構預留擴充）。
- ASR（語音辨識）/ OCR（畫面文字辨識）——僅處理影片**已有**的字幕軌。
- 學習型功能（hover 查詞、存單字、SRS、進度追蹤）。
- 帳號系統、雲端同步。
- Google 翻譯（品質過低，明確不採用）。

---

## 2. 核心技術決策

| 決策項 | 選擇 | 理由 |
|---|---|---|
| 形態 | 瀏覽器擴充套件（MV3，Chromium 先） | 網頁播放器字幕可直接取得，可行性最高 |
| 字幕取得 | **方案 B：攔截字幕軌（`timedtext`）+ 整段批次翻譯** | 免費 API 呼叫次數最少、有上下文、可快取 |
| 翻譯引擎（主力） | **DeepL 免費額**（500k 字/月，品質高） | 零成本且品質明顯優於 Google |
| 翻譯引擎（備援/離線） | **本機 LibreTranslate / 模型 server**（擴充套件呼叫 `localhost`） | 離線、隱私、無限額；不在擴充套件內跑模型，避免技術門檻 |
| 站點 | **YouTube 先做透**，adapter pattern 預留其他站 | 最快驗證可行性 |
| 顯示 | 自繪雙語 overlay，原文＋譯文上下排列，可設定 | 沉浸式體驗、可控樣式 |

### 為何選方案 B（而非 DOM 抓取）

主力是**免費翻譯 API**，免費額度最怕「逐句狂打」。方案 B 攔截整段字幕軌後**一次批次翻譯整部影片並快取**，把 API 呼叫次數壓到最低，且因有上下文而品質更好。DOM 逐句抓取雖簡單，但會在免費額度上吃大虧，故不採用。方案 C（攔截批次翻譯 + DOM 同步顯示）保留為 B 同步不夠穩時的升級路徑。

---

## 3. 架構分層

四層，責任單一、各自可獨立理解與測試：

| 層 | 執行環境 | 職責 | 依賴 |
|---|---|---|---|
| **Injected hook**（注入腳本） | YouTube 頁面 MAIN world | monkey-patch `fetch`/XHR，攔截 `timedtext` 字幕請求與回應，`postMessage` 給 content script | 無（純頁面端） |
| **Content script** | YouTube 頁面 ISOLATED world | 接收字幕、讀播放器 `currentTime`、掛載並渲染雙語 overlay、UI 互動、與 background 通訊 | Injected hook、Background、Site adapter |
| **Background service worker** | 擴充套件背景 | 翻譯 API 呼叫（繞 CORS）、批次/佇列/限額管理、IndexedDB 快取 | Translation adapter |
| **Options / popup UI** | 擴充套件 | 選目標語言、開關原文、選引擎、字幕樣式設定；存 `chrome.storage` | chrome.storage |

### 關鍵機制：為何需要 MAIN-world 注入

Content script 跑在 isolated world，看不到頁面自身的 `fetch`，攔不到 `timedtext` 請求。因此注入一支小腳本到 MAIN world 去 hook `fetch`/XHR，攔到字幕回應後以 `window.postMessage` 傳回 content script。注入腳本透過 `web_accessible_resources` 宣告以繞過 CSP。

---

## 4. 模組與介面

### 4.1 SiteAdapter（站點抽象）

```
interface SiteAdapter {
  detectVideo(): VideoContext | null     // 偵測當前頁是否為可處理影片，回傳 videoId 等
  captureSubtitleTrack(): Promise<Cue[]> // 取得整段原文字幕（透過注入 hook）
  getPlayerTime(): number                // 當前播放秒數，供 overlay 同步
  mountOverlay(el): void                 // 將 overlay 掛到播放器正確位置（含全螢幕）
}
```

- MVP 僅實作 **YouTubeAdapter**。
- Netflix / 其他站之後新增 adapter，**核心管線不變**。

### 4.2 TranslationAdapter（翻譯引擎抽象）

```
interface TranslationAdapter {
  translate(cues: Cue[], srcLang, tgtLang): Promise<Cue[]>  // 回傳譯文 cue
  capabilities(): { batch, maxCharsPerReq, langs }
}
```

- **DeepLAdapter**（主力）：DeepL 免費端點；依 `maxCharsPerReq` 分塊批次送。
- **LocalAdapter**（備援/離線）：呼叫 `localhost` 的 LibreTranslate/模型 server。
- 介面一致 → 新增引擎只新增 adapter，不動管線。

### 4.3 資料結構

```
Cue { start: number, dur: number, text: string, translated?: string }
```

---

## 5. 資料流（方案 B 管線）

1. 開啟有字幕的 YouTube 影片 → MAIN-world hook 攔到 `timedtext` 回應 → 解析成整段 `Cue[]`（`{start, dur, text}`）。
2. Content script 收到整段 → 丟 background **批次翻譯**（依 `maxCharsPerReq` 分塊送，遵守 API 限額）；background 依 `(videoId, srcLang, tgtLang, engine)` 為 key **快取**。
3. Background 回傳譯文 `Cue[]`。
4. Content script 以自繪 overlay 依播放器 `currentTime` **同步顯示**：譯文 ＋（可選）原文，上下排列。
5. 切換目標語言 → 重打一次翻譯；若該語言對已譯過則**快取命中**，不重打。

---

## 6. Overlay 顯示

- 自繪字幕層蓋在影片上方，可隱藏 YouTube 原生字幕、改用雙語層。
- 雙語上下排列：**原文（較小/較淡）＋ 譯文**；顯示順序與是否顯示原文皆可設定。
- 支援全螢幕；可調字級、垂直位置、背景透明度。
- 與播放器時間軸同步（依 `getPlayerTime()`），暫停/快轉/倒帶皆正確跟隨。

---

## 7. 設定項（對應「選語言 + 開關原文」需求）

- 目標語言下拉。
- 原文字幕開 / 關。
- 翻譯引擎選擇（DeepL 免費 / 本機）。
- 字幕樣式（字級、位置、背景透明度、雙語順序）。
- 全部存 `chrome.storage`，跨 session 保留。

---

## 8. 錯誤處理

| 情境 | 處理 |
|---|---|
| 影片無字幕軌（無原生且無自動字幕） | 通知使用者（ASR 不在範圍），不硬翻 |
| 翻譯 API 限額 / 失敗 | 佇列 + 指數退避重試；若已設本機引擎則 fallback |
| `timedtext` 格式 / 端點改版 | 偵測失敗優雅降級 + log，便於維護 |
| CSP 阻擋注入腳本 | 走 `web_accessible_resources` 宣告 |
| 本機引擎未啟動（localhost 連不上） | 提示使用者啟動，或回退主力引擎 |

---

## 9. 快取

- IndexedDB；key = `videoId + 語言對 + engine`。
- 存譯好的 `Cue[]`：重看不重翻、切回看過的語言對秒出。
- 提供清除快取的設定入口（避免無限成長）。

---

## 10. 里程碑

| 里程碑 | 內容 | 驗證重點 |
|---|---|---|
| **M0** | MV3 scaffold、載入 YouTube、掛 overlay 空殼 | 擴充套件能載入並運行 |
| **M1** | `timedtext` 攔截 → 解析整段 → 自繪 overlay 顯示**原文**並同步播放器時間 | 方案 B 的攔截 + 同步成立 |
| **M2** | 翻譯引擎層 + DeepLAdapter + 批次翻譯 + 雙語渲染 | 端到端翻譯打通 |
| **M3** | Options UI：選語言、開關原文、選引擎、樣式、持久化 | 可設定性符合需求 |
| **M4** | IndexedDB 快取 + 限額佇列 + 退避重試 | 免費額度撐得住 |
| **M5** | LocalAdapter（本機 LibreTranslate）+ fallback + 樣式打磨（全螢幕/位置） | 離線備援 + 體驗完整 |
| 未來 | Netflix adapter、Firefox 移植 | 超出 MVP，架構已預留 |

---

## 11. 開放問題 / 待實作期確認

- DeepL 免費端點的實際呼叫方式與 API key 取得流程（實作 M2 時確認）。
- 本機引擎預設指向哪個 server（LibreTranslate vs 自架模型）與 port 約定（M5 確認）。
- 字幕同步的容忍誤差與 overlay 對齊細節（M1 實測調整）。
