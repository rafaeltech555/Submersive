# Submersive

**Sub**titles × I**mmersive** — 在 YouTube 看片時，攔截原文字幕軌、翻譯，並以自繪 overlay 顯示雙語（原文＋譯文）字幕，依播放器時間同步。

> **MVP 範圍**：純看片雙語字幕，不含學習功能。需影片本身有字幕軌（不做語音辨識）。支援 **YouTube**。

---

## 功能概覽

- 攔截 YouTube `timedtext` API 取得原文字幕
- 批次送翻譯引擎、IndexedDB 快取（key = `videoId + 語言對 + engine`）
- 自繪 overlay 浮層，依播放時間同步顯示雙語字幕
- 四個翻譯引擎可在 Options 切換
- 可調整：目標語言、字級、垂直位置、背景透明度、原文上下位置

---

## 翻譯引擎

在 Options 頁面的「Engine」選項切換（`EngineId = 'deepl' | 'azure' | 'local' | 'ollama'`）。

| 引擎 | 免費額度 | 需要設定 |
|------|---------|---------|
| **DeepL** | 新用戶 Developer 一次性 100 萬字（用完不補） | `deeplKey`（API key） |
| **Azure Translator** | F0 免費層每月 200 萬字，循環免費 | `azureKey`、`azureRegion`（如 `eastasia`） |
| **Local LibreTranslate** | 無限、離線、隱私最佳，品質略遜 | `localUrl`（如 `http://localhost:5000`） |
| **Ollama**（本機 LLM）| 無限、離線、隱私最佳，品質最優 | `ollamaUrl`（如 `http://localhost:11434`）、`ollamaModel`（如 `qwen3:4b-instruct`） |

> **LibreTranslate 品質提醒**：使用 Argos 模型，en→zh 尚可；**ja→zh 品質明顯偏弱**（疑似經英文中轉），品質敏感者建議改用 Ollama 或 DeepL。

> **Ollama 使用提醒**：需本機安裝並執行 Ollama，自行 pull 所選模型（如 `ollama pull qwen3:4b-instruct`）。翻譯品質優於 LibreTranslate，推薦作為本機首選。

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

---

## Options 設定項

所有設定存於 `chrome.storage.local`。

| 設定鍵 | 說明 |
|--------|------|
| `targetLang` | 目標翻譯語言 |
| `showOriginal` | 是否顯示原文 |
| `engine` | 翻譯引擎（`deepl` / `azure` / `local` / `ollama`） |
| `originalFirst` | 原文在上（`true`）或譯文在上（`false`） |
| `fontScale` | 字級縮放 |
| `verticalPos` | 字幕垂直位置 |
| `bgOpacity` | 背景透明度 |
| `deeplKey` | DeepL API key |
| `azureKey` | Azure Translator key |
| `azureRegion` | Azure 資源 region（如 `eastasia`） |
| `localUrl` | LibreTranslate server URL |
| `ollamaUrl` | Ollama server URL（如 `http://localhost:11434`） |
| `ollamaModel` | Ollama 使用的模型名稱（如 `qwen3:4b-instruct`） |

---

## 架構

四層設計，以 adapter pattern 方便擴充新站點與翻譯引擎：

```
┌─ YouTube 路線 ──────────────────────────────────────────────────────┐
│  MAIN-world hook (src/inject/hook.ts)                               │
│    └─ patch fetch，攔截 timedtext 字幕請求                          │
│          ↓                                                          │
│  content script (src/content/)                                      │
│    └─ 整軌批次 TRANSLATE → background → IDB 快取 → overlay         │
└─────────────────────────────────────────────────────────────────────┘

共用
  Background service worker (src/background/)
    └─ 翻譯引擎呼叫、IndexedDB 快取
  Options / Popup
    └─ 設定管理（引擎、key、顯示偏好）
```

### Adapter 設計

- **`SiteAdapter`**：抽象站點（目前實作：YouTubeAdapter；設計上方便日後擴充）
- **`TranslationAdapter`**：抽象翻譯引擎（DeepL / Azure / LibreTranslate / Ollama 各一實作，新增引擎只需實作 adapter）

---

## 開發指令

```bash
npm test        # 執行單元測試（Vitest，目前 48 passed）
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
| Ollama 本機 LLM 引擎 | ✅ 完成 |
| 48 unit tests | ✅ 全綠 |
| `tsc --noEmit` | ✅ 乾淨 |
| `npm run build` | ✅ 乾淨 |
| YouTube 真機驗收 | ✅ 通過 |

---

## 相關文件

spec 與 plan 詳見 `docs/superpowers/`：

- `docs/superpowers/specs/` — 功能規格
- `docs/superpowers/plans/` — 實作計劃

---

## 授權

授權尚未指定。
