# Submersive

**Sub**titles × I**mmersive** — 在 YouTube 與 Netflix 看片時，攔截原文字幕軌、翻譯，並以自繪 overlay 顯示雙語（原文＋譯文）字幕，依播放器時間同步。

> **MVP 範圍**：純看片雙語字幕，不含學習功能。需影片本身有字幕軌（不做語音辨識）。支援 **YouTube** 與 **Netflix**。

---

## 功能概覽

- 攔截 YouTube `timedtext` API 取得原文字幕
- 攔截 Netflix `nflxvideo` 字幕 XHR/fetch，自行解析 TTML/imsc（含 tick 時間格式），隱藏原生 CC
- 批次送翻譯引擎、IndexedDB 快取（key = `videoId + 語言對 + engine`）
- 自繪 overlay 浮層，依播放時間同步顯示雙語字幕
- 三個翻譯引擎可在 Options 切換
- 可調整：目標語言、字級、垂直位置、背景透明度、原文上下位置

---

## 翻譯引擎

在 Options 頁面的「Engine」選項切換（`EngineId = 'deepl' | 'azure' | 'local'`）。

| 引擎 | 免費額度 | 需要設定 |
|------|---------|---------|
| **DeepL** | 新用戶 Developer 一次性 100 萬字（用完不補） | `deeplKey`（API key） |
| **Azure Translator** | F0 免費層每月 200 萬字，循環免費 | `azureKey`、`azureRegion`（如 `eastasia`） |
| **Local LibreTranslate** | 無限、離線、隱私最佳，品質略遜 | `localUrl`（如 `http://localhost:5000`） |

> **LibreTranslate 品質提醒**：使用 Argos 模型，en→zh 尚可；**ja→zh 品質明顯偏弱**（疑似經英文中轉），品質敏感者建議改用 DeepL 或 Azure。

### Fallback 機制

當引擎為 `deepl` 或 `azure`，且已設定 `localUrl` 時，若翻譯失敗會自動 fallback 到本機 LibreTranslate。

### 架設 LibreTranslate（安全跑法）

```bash
docker run -ti --rm -p 127.0.0.1:5000:5000 libretranslate/libretranslate
```

Options 的 `localUrl` 填 `http://localhost:5000`。

---

## 安裝（開發 / 載入未封裝）

**需求**：Node.js、npm、Chrome 或 Edge（Chromium 系）。

```bash
# 1. 安裝相依套件
npm install

# 2. 建置（產出 dist/）
npm run build
```

1. 開啟 Chrome/Edge，前往 `chrome://extensions`
2. 開啟右上角「開發人員模式」
3. 點「載入未封裝項目」，選取 `dist/` 資料夾
4. 開啟擴充套件的 **Options** 設定引擎與對應 key
5. **YouTube**：開一部有 CC 字幕的影片並開啟字幕，overlay 即啟動
6. **Netflix**：開一部有字幕的影片並開啟字幕，原文先出、譯文逐句漸進補上

---

## Options 設定項

所有設定存於 `chrome.storage.local`。

| 設定鍵 | 說明 |
|--------|------|
| `targetLang` | 目標翻譯語言 |
| `showOriginal` | 是否顯示原文 |
| `engine` | 翻譯引擎（`deepl` / `azure` / `local`） |
| `originalFirst` | 原文在上（`true`）或譯文在上（`false`） |
| `fontScale` | 字級縮放 |
| `verticalPos` | 字幕垂直位置 |
| `bgOpacity` | 背景透明度 |
| `deeplKey` | DeepL API key |
| `azureKey` | Azure Translator key |
| `azureRegion` | Azure 資源 region（如 `eastasia`） |
| `localUrl` | LibreTranslate server URL |

---

## 架構

四層設計，以 adapter pattern 方便擴充新站點與翻譯引擎。YouTube 與 Netflix 各有獨立的攔截路線與翻譯策略：

```
┌─ YouTube 路線 ──────────────────────────────────────────────────────┐
│  MAIN-world hook (src/inject/hook.ts)                               │
│    └─ patch fetch，攔截 timedtext 字幕請求                          │
│          ↓                                                          │
│  content script (src/content/)                                      │
│    └─ 整軌批次 TRANSLATE → background → IDB 快取 → overlay         │
└─────────────────────────────────────────────────────────────────────┘

┌─ Netflix 路線 ──────────────────────────────────────────────────────┐
│  MAIN-world hook (src/inject/netflix-hook.ts)                       │
│    └─ patch XHR/fetch，攔截 nflxvideo 字幕（TTML/imsc 格式）       │
│          ↓                                                          │
│  imsc parser (src/sites/netflix/imsc-parser.ts)                     │
│    └─ 解析 TTML，支援 ttp:tickRate tick 時間格式                    │
│          ↓                                                          │
│  NetflixAdapter + content script (src/content/)                     │
│    └─ 隱藏原生 CC、自繪 overlay                                     │
│    └─ TranslationScheduler：以 playhead 視窗優先、序列化小批次      │
│          TRANSLATE_BATCH（≤8 句 ≤2000 字）送 background            │
│          ↓                                                          │
│  Background (src/background/translate-batch.ts)                     │
│    └─ 無狀態 handler：查 IDB → 只翻 miss → 回填 cue.translated     │
└─────────────────────────────────────────────────────────────────────┘

共用
  Background service worker (src/background/)
    └─ 翻譯引擎呼叫、IndexedDB 快取
  Options / Popup
    └─ 設定管理（引擎、key、顯示偏好）
```

### 翻譯策略差異

| | YouTube | Netflix |
|---|---|---|
| **攔截方式** | fetch patch（`timedtext`）| XHR + fetch patch（`nflxvideo`）|
| **字幕格式** | JSON（YouTubeAdapter）| TTML/imsc（imsc-parser）|
| **翻譯時機** | 啟動時整軌一次批次（`TRANSLATE`）| 視窗化 on-demand 小批次（`TRANSLATE_BATCH`）|
| **批次大小** | 整軌（可能數百句）| ≤8 句、≤2000 字 |
| **IDB 快取** | 以 videoId+語言對 整軌存取 | 逐句查 miss、回填 |

**Netflix 採視窗化設計的原因**：LibreTranslate 每句約 0.7 秒，整軌一次翻譯太慢；且大批次 fetch 超過 MV3 service worker 生命週期上限會被強制中斷，導致譯文全部遺失。改為 playhead 前方優先、每批極短，既能即時顯示，也不再撞 SW 生命週期。

### 關鍵新增模組

| 模組 | 說明 |
|------|------|
| `src/inject/netflix-hook.ts` | MAIN-world hook：攔 Netflix 字幕 XHR/fetch |
| `src/sites/netflix/imsc-parser.ts` | TTML/imsc 解析（支援 tick 時間） |
| `src/sites/netflix/netflix-adapter.ts` | NetflixAdapter：隱藏原生 CC、餵 cue 給 overlay |
| `src/content/translation-scheduler.ts` | 視窗化排程：playhead 前方優先、序列化小批次 |
| `src/background/translate-batch.ts` | 無狀態批次翻譯 handler（逐句 IDB 快取）|

### Adapter 設計

- **`SiteAdapter`**：抽象站點（YouTube / Netflix 各一實作，方便日後擴充）
- **`TranslationAdapter`**：抽象翻譯引擎（新增引擎只需實作 adapter）

---

## 開發指令

```bash
npm test        # 執行單元測試（Vitest，目前 70 passed）
npm run build   # 建置 dist/
```

---

## 技術棧

- **TypeScript** + **Vite**
- **@crxjs/vite-plugin**（MV3 打包）
- **Vitest**（單元測試）
- **idb**（IndexedDB 快取）

---

## 現況

| 項目 | 狀態 |
|------|------|
| M0–M5 實作 + Azure 引擎（YouTube）| ✅ 完成 |
| Netflix MAIN-world hook + imsc parser | ✅ 完成 |
| Netflix 視窗化 on-demand 翻譯（TranslationScheduler）| ✅ 完成 |
| 70 unit tests | ✅ 全綠 |
| `tsc --noEmit` | ✅ 乾淨 |
| `npm run build` | ✅ 乾淨 |
| YouTube 真機驗收 | ✅ 通過 |
| Netflix 真機驗收（原文先出、繁中逐句漸進）| ✅ 通過 |

---

## 相關文件

spec 與 plan 詳見 `docs/superpowers/`：

- `docs/superpowers/specs/` — 功能規格
- `docs/superpowers/plans/` — 實作計劃

---

## 授權

授權尚未指定。
