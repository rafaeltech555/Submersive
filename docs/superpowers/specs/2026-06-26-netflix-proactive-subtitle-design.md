# Submersive — Netflix proactive 字幕架構（攔 TTML 預翻 + 時間驅動）設計

## 背景與目標

`feat/toggle-3state` merge 後，使用者真機驗 Netflix 發現兩個既有 UX bug：

1. **譯文位置錯**：`Injector` `appendChild` 到 `.player-timedtext`（外層 normal flow），但原文 `.player-timedtext-text-container` 用 `position:absolute` 跑出 flow → 譯文飄到容器頂端、不在原文下方。
2. **譯文一閃即逝 / 來不及翻**：LibreTranslate 日→中繞英文中轉、單行常 2–5 秒；動畫字幕 ~2 秒一行 → reactive 路線（DOM 觀察→即時翻譯）必然 race，`onLine` guard `currentLine !== expectedLine` 把翻譯丟掉，少數來得及就被下一行 React 重渲掃掉。

兩個問題共同根因：**reactive DOM 觀察路線**——只能在原文出現「之後」開始翻、翻譯耗時下界 > 字幕停留時間上界、物理上修不掉。

本設計把 NetflixAdapter 改成 **proactive 預翻 + 時間驅動**，結構對齊既有 YouTubeAdapter，順帶解掉位置 + race，並把原生 CC 自動隱藏避免雙倍字幕。

## 範圍

- ✅ MAIN world hook 攔 `XMLHttpRequest` + `fetch` 對 Netflix 字幕 URL 的回應（仿 `src/inject/hook.ts` 既有手法）。
- ✅ 自寫 minimal imsc1.1/TTML parser（抽 `<p>` 的 `begin`/`end`/`textContent` → `Cue[]`），不引入 `imsc.js` lib（>30KB）。
- ✅ 重寫 `NetflixAdapter` 實作既有 `SiteAdapter` 介面（`detectVideo` / `onSubtitleTrack` / `getPlayerTime` / `getVideoElement`），語意對齊 `YouTubeAdapter`。
- ✅ 重寫 `netflix-content.ts` 結構照 `content.ts`（YouTube），共用 `Overlay`、`Notice`、`ToggleButton`、`Cue` 型別、settings/toggle store、`translateAndShow` 模式。
- ✅ Netflix 從此**真有**「原文」模式——`Overlay.setOriginalOnly` 自帶主要字級、與 YouTube 一致。
- ✅ 新增 `native-cc.ts` 工具：mode ∈ {bilingual, original} 時 inject `<style>` 隱藏 `.player-timedtext`；mode = off 時移除（避免我們 overlay + Netflix 原生 CC 雙倍字幕）。
- ✅ 棄用 `subtitle-observer.ts`、`injector.ts`、`netflix-extract-line.test.ts`（reactive 整套）。
- ❌ 不做多軌動態切換（以 hook 收到的最後一條 TTML 為準；使用者切語言時，下次 fetch 蓋過上次）。
- ❌ 不做原生 CC 樣式跟隨（字級/顏色/位置）。
- ❌ 不處理 Netflix 萬一改用 WebVTT 的情境（spec 只走 imsc/TTML）。
- ❌ 不保留任何「inject 譯文到原生字幕容器」的能力（DOM-reactive 路線整套退場）。
- ❌ 不刪 background 的 `TRANSLATE_LINE` handler 與 `translate-line.ts`（保留備用，視為未來清理）——本次只關掉 Netflix 對它的使用。

## 架構

```
MAIN world (hook)              background SW                content world (NetflixAdapter)
─────────────────              ─────────────                ──────────────────────────────
hook 攔 *.nflxvideo.net           收 TRANSLATE 訊息            window.addEventListener('message')
TTML/imsc XHR/fetch 回應 ───>     整批送 LibreTranslate ────>  過 imscParser → Cue[]
postMessage raw XML              cache by (videoId+srcLang+   onSubtitleTrack(cb)
                                        targetLang+engine)             │
                                                                       v
                                                                netflix-content.ts
                                                                記 lastCues / lastCtx
                                                                送整批 TRANSLATE
                                                                Overlay.setCues + mount
                                                                rAF loop：currentTime → cue
                                                                nativeCc.hide() / .show()
```

### 1. `src/inject/netflix-hook.ts`（新）

MAIN world script，仿既有 `src/inject/hook.ts` 結構：

- 同時 patch `XMLHttpRequest.prototype.open/send` 與 `window.fetch`
- URL 過濾：採**寬鬆 match**——URL 字串包含 `nflxvideo`（涵蓋 `*.nflxvideo.net` 與其變體）；response 內容若不以 `<?xml` 或 `<tt` 開頭則靜默略過（避免攔到非字幕資源）
- 回 `window.postMessage({ source:'submersive-hook', kind:'netflix-imsc', url, raw }, '*')` 給 content world
- console.log 一行 `[submersive] netflix hook installed`

### 2. `src/sites/netflix/imsc-parser.ts`（新）

```ts
import type { Cue } from '../../types'
export function parseImsc(xml: string): Cue[]
```

- 用 `DOMParser` 解 XML
- 取所有 `<p>` 元素：`begin` / `end` 屬性（格式 `HH:MM:SS.mmm`，先支援此種，遇其他格式 cue 略過 + warn）
- `textContent` 從子節點抽出（含 `<br/>` 轉成 `\n` 或空白），去除 inline 樣式
- 過濾空字串 cue
- 計算 `dur = end - start`；回傳 `Cue[]`（`translated` 留空）
- 失敗（XML 解析錯誤 / 無 `<p>`）回空陣列 + `console.warn`

### 3. `src/sites/netflix-adapter.ts`（新，原檔不存在）

實作 `SiteAdapter` 介面。建構式註冊 `window.addEventListener('message')`：

```ts
ev.source === window
&& ev.data?.source === 'submersive-hook'
&& ev.data?.kind === 'netflix-imsc'
```

過濾通過 → `parseImsc(ev.data.raw)` → 若 cues 非空 → 取 `detectVideo()` ctx → 廣播給 listeners。

- `detectVideo()`：`location.pathname.match(/\/watch\/(\d+)/)` → `{ videoId, srcLang: null }`（lang 在 TTML 標頭可拆，先 null，後續可從 `<tt xml:lang>` 取）
- `getVideoElement()`：`document.querySelector('video')`
- `getPlayerTime()`：上面的 `currentTime ?? 0`

### 4. `src/sites/netflix/native-cc.ts`（新）

```ts
export function hideNativeCc(): void  // inject <style id="submersive-hide-native-cc"> .player-timedtext { display: none !important }
export function showNativeCc(): void  // remove the <style>
```

- `hideNativeCc` idempotent：已存在則不重複加
- 注入到 `document.head`（簡單持久，不受 player React 重渲影響）

### 5. `src/content/netflix-content.ts`（重寫）

整檔對齊 `src/content/content.ts`（YouTube 版）的結構：

- 啟動：`loadSettings` / `loadMode` / `new NetflixAdapter()` / `new Overlay(getPlayerTime, getPlayerRoot)` / `Overlay.applySettings(settings)` / `new Notice(getPlayerRoot)` / `new ToggleButton(getPlayerRoot, onCycle, mode)`
- mode === 'off' 不 mount overlay，不隱藏原生 CC（`nativeCc.show()`）
- mode ∈ {bilingual, original}：`overlay.mount()` + `nativeCc.hide()`
- `translateAndShow(cues, ctx)`：fire-and-forget；回來時檢 `currentVideoId === expectedId && mode === 'bilingual'`，pass 才 `overlay.setCues(translated)` + `setBilingual(true)`，失敗顯示 `Notice`（沿用 `friendlyTranslateError`）
- `applyMode(m)`：完全照 YouTube 邏輯，多加 `m === 'off' ? nativeCc.show() : nativeCc.hide()`
- `onSubtitleTrack(cues, ctx)`：記 `lastCues / lastCtx`、若 mode ≠ off → mount overlay + setCues + setOriginalOnly + 若 bilingual 則 await translateAndShow
- `armNoCuesTimer`：5 秒沒收到 cue 且 mode ≠ off → Notice「請開啟字幕以啟用沉浸字幕」
- SPA 換片：`window.setInterval(onVideoMaybeChanged, 1000)` 同 YouTube，videoId 變即重置 `lastCues` / `currentVideoId` / clear notice

### 6. `src/sites/netflix/dom.ts`（修改）

- 保留 `PLAYER_ROOT`
- 移除 `SUBTITLE_CONTAINER`、`NATIVE_TEXT`、`INJECTED_ID`（棄用）

### 7. `src/sites/netflix/player.ts`（保留）

`getVideoId` / `getVideoElement` / `getPlayerRoot` 不變。`getContainer` 移除（沒人用了）。

### 8. `manifest.ts`（修改）

新增第 4 條 content_scripts entry：

```ts
{
  matches: ['https://*.netflix.com/*'],
  js: ['src/inject/netflix-hook.ts'],
  run_at: 'document_start',
  world: 'MAIN',
}
```

### 9. 棄用清單

- 刪 `src/sites/netflix/subtitle-observer.ts`
- 刪 `src/sites/netflix/injector.ts`
- 刪 `tests/netflix-extract-line.test.ts`

## 資料流

```
1. 載 /watch/<id>
   ├─ MAIN: netflix-hook 安裝（document_start，先於 Netflix 主程式）
   ├─ ISOLATED: netflix-content 啟動 → loadSettings + loadMode
   ├─ NetflixAdapter listen 'message'
   ├─ Overlay / Notice / ToggleButton mount
   └─ mode ≠ off → nativeCc.hide()

2. Netflix 主程式 fetch TTML (*.nflxvideo.net)
   ├─ hook 攔到 → postMessage raw XML
   └─ NetflixAdapter parseImsc → onSubtitleTrack(cues, ctx)

3. content 收 onSubtitleTrack
   ├─ lastCues = cues / lastCtx = ctx
   ├─ overlay.setCues(cues) + setOriginalOnly(mode==='original') + mount
   └─ mode === 'bilingual' → translateAndShow → overlay.setCues(translated) + setBilingual(true)

4. 觀看：Overlay rAF loop 讀 video.currentTime → 找命中 cue → render
   ├─ bilingual: 原文小淡 + 譯文大亮
   ├─ original: 只原文、120% × fontScale 主要尺寸
   └─ off: overlay unmount，無事

5. SPA 換片：setInterval 偵測 videoId 變 → 重置 lastCues / overlay.unmount / 等下一波 hook

6. 開關切換
   ├─ off：overlay.unmount() + nativeCc.show()
   ├─ original：overlay.mount() + setOriginalOnly(true) + nativeCc.hide()，不送翻譯
   └─ bilingual：overlay.mount() + setOriginalOnly(false) + nativeCc.hide()，lastCues 有 translated 直用、否則重送 TRANSLATE
```

## 錯誤處理與邊界

- **TTML 還沒到使用者就播放**：overlay 空白，`armNoCuesTimer` 5s 後彈 Notice「請開啟字幕…」。實務上 Netflix 早在按播放前就 prefetch 字幕，這個 window 通常 < 1s。
- **TTML parse 失敗**：parser 回空陣列 + `console.warn`，content 端視同無字幕，5s notice 仍會觸發。
- **背景翻譯失敗**：沿用既有 `friendlyTranslateError` + `Notice.show`（6s 自動消）。
- **多軌字幕**：以 hook 收到的最後一條 TTML 為準（覆蓋 `lastCues`）。使用者切換語言 → Netflix 主程式重新 fetch → hook 攔到 → 蓋掉舊 cue。沒有跨軌合併邏輯。
- **同片重看**：videoId 不變、Adapter 沒做 dedupe；新 fetch 進來會重新觸發 onSubtitleTrack → 重新翻譯（cache 命中）。可接受。
- **mode = off → bilingual 中途切換**：若 `lastCues` 有 `translated` 直接用、否則 fire-and-forget `translateAndShow(lastCues, lastCtx)`（與 YouTube 一致）。
- **跨片快取**：`cacheKey(videoId, srcLang, targetLang, engine)` 已含 videoId，自動隔離。
- **Netflix 用 WebVTT 而非 imsc**（少見）：parser 解析失敗 → 視同無字幕 → notice。後續可擴。
- **原生 CC 隱藏 idempotent**：`nativeCc.hide()` 在 mode 切換時可能反覆呼叫，內部檢查 `<style id="submersive-hide-native-cc">` 是否已存在。
- **使用者手動關 Netflix CC**：`nativeCc.hide()` 對 `display:none` 已隱藏的東西無害。當 mode 切到 off → `nativeCc.show()`，Netflix 自己的 CC 開關仍是使用者的選擇。

## 測試

### 單元測試（Vitest）

- `tests/netflix-imsc-parser.test.ts`（**新**）：餵 3 段樣本——(1) 標準兩行 TTML、(2) 含 `<br/>` 與 inline 樣式、(3) malformed XML → 預期分別回 `Cue[]` / `Cue[]` / `[]`
- `tests/netflix-adapter.test.ts`（**新**）：mock `window.postMessage` 流程，確認 `onSubtitleTrack` callback 收到 parser 產出的 `Cue[]` 與正確 ctx（videoId from `/watch/<id>`）
- 既有 `tests/netflix-extract-line.test.ts`：**刪**
- 既有 `tests/toggle-store.test.ts`：不動
- 全套 `npx vitest run` 維持 PASS（toggle-store 4 + parser 3 + adapter 2 + 其它原本 38 = 47）

### 手動驗證（真機 Edge / Chrome）

- Netflix `/watch/<id>` + CC：
  1. **bilingual**：overlay 顯示原文（小淡）+ 譯文（大亮），位置在播放器底部、跟原生 CC 不重疊（原生已被 hide）
  2. **original**：overlay 只顯示原文、字級倍率明顯有感
  3. **off**：overlay 消失、原生 CC 復原
  4. 字幕**不再一閃即逝**（cue 庫已有譯文、rAF loop 連續顯示）
  5. 切換流暢、循環同 YouTube
  6. SPA 換片重置正常
- Console 應出現：`[submersive] netflix hook installed`、`[submersive] netflix content ready`，無 `Cannot read properties of null` 之類

## 受影響檔案

| 檔案 | 操作 |
|---|---|
| `src/inject/netflix-hook.ts` | **新** |
| `src/sites/netflix/imsc-parser.ts` | **新** |
| `src/sites/netflix/native-cc.ts` | **新** |
| `src/sites/netflix-adapter.ts` | **新** |
| `src/content/netflix-content.ts` | **重寫** |
| `src/sites/netflix/dom.ts` | 修改（精簡） |
| `src/sites/netflix/player.ts` | 修改（移除 `getContainer`） |
| `src/manifest.ts` | 修改（加 MAIN world hook entry） |
| `src/sites/netflix/subtitle-observer.ts` | **刪** |
| `src/sites/netflix/injector.ts` | **刪** |
| `tests/netflix-extract-line.test.ts` | **刪** |
| `tests/netflix-imsc-parser.test.ts` | **新** |
| `tests/netflix-adapter.test.ts` | **新** |
