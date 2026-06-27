# Submersive — Ollama 本機 LLM 翻譯引擎（qwen3）設計

## 背景與目標

Netflix 視窗化 on-demand 翻譯架構已上線（譯文逐句出現），但真機回報**本機翻譯品質差**：LibreTranslate/Argos 的 ja→zh 疑似經英文中轉、雙重劣化，en→zh 也偏弱。

機器無獨立 GPU（Intel Iris Xe），但已裝 Ollama 且已 pull `qwen3:4b-instruct`。實測該模型 ja→zh／en→zh 品質明顯優於 Argos，輸出道地台繁；速度暖機後約 2.8s/單句，**一次 prompt 翻整批可攤平到 ~1s/句**，配合既有視窗化＋逐句快取可接受。

本設計新增一個 **Ollama 翻譯引擎**（`EngineId = 'ollama'`），實作既有 `TranslationAdapter` 介面，與現有引擎並存、可在 Options 切換。LibreTranslate（`'local'`）保留為「快但品質低」的選項與 fallback。

## 範圍

- ✅ 新增 `src/translation/ollama-adapter.ts`：`OllamaAdapter implements TranslationAdapter`，走 Ollama `/api/chat` + 結構化輸出（`format` JSON schema）+ `think:false`。
- ✅ 批次翻譯：一次 prompt 翻整批；回傳 `translations` 長度與輸入不符（或非合法 JSON / 非字串陣列）時，**退回逐句重翻**（每句一個 `/api/chat` 請求）組回。
- ✅ `EngineId` 加 `'ollama'`；`background.ts pickAdapter` 支援；Options 加引擎選項與 `ollamaUrl` / `ollamaModel` 兩個設定欄。
- ✅ 重用既有分層 fallback：OllamaAdapter 逐句仍失敗才 throw → background 既有 `translateBatchMisses`／`translateCues` 在 `localUrl` 有設時 fallback 到 LibreTranslate（**不改 background fallback 邏輯**）。
- ❌ 不掛 OpenCC 簡→繁（prompt 已要求台繁；日後若發現夾簡再加，YAGNI）。
- ❌ 不改視窗化 scheduler、`TRANSLATE_BATCH` handler、`translateBatchCached`、overlay、cache（純新增引擎，資料流不變）。
- ❌ 不做串流（`stream:false`）。
- ❌ 不做 LLM 跨行語境最佳化（批次內模型本就看得到同批各行；輸出仍嚴格 1:1，不合併不增刪）。
- ❌ 不自動偵測 / 下載模型（model 由設定指定，預設 `qwen3:4b-instruct`；模型不存在時 Ollama 回錯，走 fallback）。

## 架構

```
background SW pickAdapter(engine)
  engine==='ollama' → new OllamaAdapter(ollamaUrl, ollamaModel)
        │ translateBatch(texts, srcLang, targetLang)
        v
  OllamaAdapter
   ├ 組 system + user(JSON 陣列來源行)，format=JSON schema {translations:string[]}，think:false
   ├ POST {baseUrl}/api/chat (stream:false)
   ├ 解析 message.content(JSON) → translations
   ├ 長度/型別符 → 回傳
   └ 不符 → 逐句：每句 POST /api/chat（format {translation:string}）→ 組回
        │ (逐句再失敗 → throw)
        v
  background translateBatchMisses/translateCues 既有 fallback → LibreTranslate（若 localUrl 有設）
```

呼叫端不變：Netflix 視窗化 `TRANSLATE_BATCH`（≤8 句）與 YouTube 整軌 chunker（用 `capabilities().maxCharsPerReq`）都透過 `pickAdapter` 取得 adapter，對 OllamaAdapter 一視同仁。

### 1. `src/translation/ollama-adapter.ts`（新）

```ts
export class OllamaAdapter implements TranslationAdapter {
  constructor(
    private readonly baseUrl = 'http://localhost:11434',
    private readonly model = 'qwen3:4b-instruct',
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}
  capabilities(): TranslationCapabilities { return { maxCharsPerReq: 2000 } }
  async translateBatch(texts: string[], srcLang: string | null, targetLang: string): Promise<string[]>
}
```

**目標語言映射**（→ prompt 中的人類可讀語言名）：
`zh-TW`→「台灣正體中文（繁體）」、`zh-CN`→「简体中文」、`en`→「English」、`ja`→「日本語」、`ko`→「한국어」；其餘用原碼。`srcLang` 不放入 prompt（auto；字幕原文語言不一定可靠，讓模型自行判斷）。

**批次請求**（`POST {baseUrl}/api/chat`）：
- `model`、`stream:false`、`think:false`
- `format`: JSON schema `{ type:'object', properties:{ translations:{ type:'array', items:{ type:'string' } } }, required:['translations'] }`
- `messages`:
  - system：「你是專業影視字幕翻譯。將使用者提供的每一行字幕翻成<TARGET>。輸出 JSON 物件，`translations` 為與輸入等長、同順序的譯文字串陣列。只翻譯，不要解釋、不要註解、不要保留原文、不要合併或增刪行。」
  - user：`JSON.stringify(texts)`（來源行陣列）
- 解析 `data.message.content`（JSON 字串）→ `translations`。
- 驗證：`Array.isArray(translations) && translations.length === texts.length && translations.every(t => typeof t === 'string')` → 回傳；否則進逐句。

**逐句 fallback**（任一驗證不過時，對 `texts` 每句各發一次）：
- 同 system，`format`: `{ type:'object', properties:{ translation:{ type:'string' } }, required:['translation'] }`，user 為單行。
- 解析 `translation`（字串）。逐句以 `Promise.all` 併發（Ollama 端序列化處理，但併發送出簡化程式碼）。
- 任一句請求非 200 或解析不出字串 → throw `Error('Ollama 逐句翻譯失敗')`。

**錯誤**：`/api/chat` 非 200 → throw `Error('Ollama HTTP ' + res.status)`。`texts` 為空 → 直接回 `[]`（不發請求）。

### 2. `src/types.ts`（改）

`EngineId` 由 `'deepl' | 'local' | 'azure'` 改為 `'deepl' | 'local' | 'azure' | 'ollama'`。

### 3. `src/background/background.ts`（改）

`pickAdapter` 加分支：
```ts
const { deeplKey, localUrl, azureKey, azureRegion, ollamaUrl, ollamaModel } =
  await chrome.storage.local.get([...既有, 'ollamaUrl', 'ollamaModel'])
if (engine === 'ollama') return new OllamaAdapter(ollamaUrl ?? 'http://localhost:11434', ollamaModel ?? 'qwen3:4b-instruct')
```
其餘 fallback 邏輯不動（`translateBatchMisses`/`translateCues` 對 `engine !== 'local' && localUrl` 仍會 fallback LibreTranslate，涵蓋 `'ollama'`）。

### 4. `src/options/options.html` + `options.ts`（改）

- engine `<select>` 加 `<option value="ollama">Local Ollama（qwen3，品質佳）</option>`。
- 新增兩個 `<input>`：`ollamaUrl`（預設 `http://localhost:11434`）、`ollamaModel`（預設 `qwen3:4b-instruct`）。
- `options.ts`：`init()` 讀 `ollamaUrl`/`ollamaModel` 填欄（含預設）；save 時 `engine` 型別 cast 加 `'ollama'`，並把 `ollamaUrl`/`ollamaModel` 寫入 `chrome.storage.local`。

## 錯誤處理

- 批次 JSON 不合法 / 長度不符 → 不視為錯誤，靜默走逐句（記一行 `console.warn`）。
- 逐句仍失敗 → throw → 由 background 既有層 fallback 到 LibreTranslate（若使用者有設 `localUrl`）；否則整批 `TRANSLATE_BATCH_ERROR`，scheduler 退避重試＋跳一次 notice（既有行為）。
- 模型不存在 / Ollama 未啟動 → `/api/chat` 連線失敗或 404 → throw → 同上 fallback。

## 測試 `tests/ollama-adapter.test.ts`（注入 fetchFn）

- **批次 happy path**：fetchFn 回 `{message:{content: JSON.stringify({translations:['譯a','譯b']})}}` → `translateBatch(['a','b'])` 回 `['譯a','譯b']`，且只呼叫一次 fetch。
- **長度不符 → 逐句**：批次回 `{translations:['只一個']}`（長度 1 ≠ 2）→ 改逐句：fetchFn 對單行回 `{message:{content:JSON.stringify({translation:'譯'+行})}}` → 回 `['譯a','譯b']`，fetch 被呼叫 1(批次)+2(逐句)=3 次。
- **非陣列 / 非字串 → 逐句**：批次回 `{translations:'x'}` 或含非字串 → 走逐句。
- **request body 形狀**：批次請求 body 含 `model`、`think:false`、`format.properties.translations`、user 為 `JSON.stringify(texts)`、system 含目標語言名（zh-TW→台灣正體中文）。
- **HTTP 錯誤**：fetchFn 回 `{ok:false,status:500}` → `rejects.toThrow(/Ollama HTTP 500/)`。
- **逐句失敗傳遞**：批次長度不符且逐句某句 `ok:false` → `rejects.toThrow(/逐句/)`。
- **空輸入**：`translateBatch([])` 回 `[]`，fetch 不被呼叫。
- 既有 70 tests 不得破壞。

## 拒絕的替代方案

- **編號清單純文字解析**：prompt 要 `1./2./3.`、regex 拆；LLM 偶發併行/漏號，比 `format` JSON schema 脆。
- **一律逐句（不批次）**：最穩但每句一次請求（~2.8s），整軌過慢；批次 + 逐句 fallback 兼顧吞吐與穩健。
- **取代 `'local'`**：失去「LibreTranslate 快但品質低」選項與快速 fallback；改為新增引擎並存。

## 收尾

實作走 subagent-driven。spec 通過 → `writing-plans` 拆 task → 逐 task 實作 + review。真機驗證（Options 切 ollama、Netflix bilingual 看品質明顯提升、ja/en→zh 皆通）後，委派 Sonnet renew docs（README 引擎表加 Ollama）+ commit + push。
