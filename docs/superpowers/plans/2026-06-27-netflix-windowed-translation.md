# Netflix 視窗化 on-demand 翻譯 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Netflix 字幕翻譯從「啟動時一次翻整軌」改成「視窗化 on-demand 小批次」，讓每次後端請求都短到必定在 MV3 service worker 存活期內完成，譯文邊播邊漸進出現。

**Architecture:** content script 內的 `TranslationScheduler`（視窗優先→背景補軌、序列化單一 in-flight 小批次）驅動翻譯，就地寫 `cue.translated`，overlay 既有 rAF loop 下一幀自動顯示第二行。background SW 新增無狀態 `TRANSLATE_BATCH` handler：逐句查快取、只把 miss 丟一次 adapter、回填快取。YouTube 既有整軌 `TRANSLATE` 路線保留不動。

**Tech Stack:** TypeScript、Vitest（node env、`fake-indexeddb/auto`）、Chrome MV3、`idb`、既有 `LocalAdapter`/`runWithRetry`/`lineCacheKey`/`Overlay`。

**Spec:** `docs/superpowers/specs/2026-06-27-netflix-windowed-translation-design.md`

---

## 檔案結構

| 檔案 | 動作 | 責任 |
|---|---|---|
| `src/types.ts` | 改 | `Message` union 加 `TRANSLATE_BATCH` / `_RESULT` / `_ERROR` 三型別 |
| `src/background/translate-batch.ts` | 新 | `translateBatchCached`：逐句 cache-aware 批次翻譯（純邏輯、注入 translateMisses） |
| `tests/translate-batch.test.ts` | 新 | `translateBatchCached` 單元測試 |
| `src/background/background.ts` | 改 | 新增 `TRANSLATE_BATCH` handler + `translateBatchMisses`（primary→local fallback）；保留既有 `TRANSLATE`/`TRANSLATE_LINE` |
| `src/content/translation-scheduler.ts` | 新 | `TranslationScheduler`：視窗/背景排程、序列化、去重、退避（純邏輯、注入 deps） |
| `tests/translation-scheduler.test.ts` | 新 | `TranslationScheduler` 單元測試 |
| `src/content/netflix-content.ts` | 改 | 以 scheduler 取代 `translateAndShow`；建立/啟停 scheduler |

> **注意**：`src/background/background.ts` 與 `src/content/netflix-content.ts` 工作樹中有先前除錯加的臨時 `console.log`（未 commit）。Task 3、Task 5 第一步先 `git checkout --` 還原成 HEAD 乾淨版再改。

---

## Task 1: 加 TRANSLATE_BATCH 訊息型別

**Files:**
- Modify: `src/types.ts:36-42`

- [ ] **Step 1: 在 Message union 末端加三個型別**

把 `src/types.ts` 的 `Message` union 改成（在既有 `TRANSLATE_LINE_ERROR` 後追加三行）：

```ts
// content <-> background 訊息
export type Message =
  | { type: 'TRANSLATE'; videoId: string; srcLang: string | null; targetLang: string; engine: EngineId; cues: Cue[] }
  | { type: 'TRANSLATE_RESULT'; videoId: string; cues: Cue[] }
  | { type: 'TRANSLATE_ERROR'; videoId: string; error: string }
  | { type: 'TRANSLATE_LINE'; text: string; srcLang: string | null; targetLang: string; engine: EngineId }
  | { type: 'TRANSLATE_LINE_RESULT'; text: string; translated: string }
  | { type: 'TRANSLATE_LINE_ERROR'; text: string; error: string }
  | { type: 'TRANSLATE_BATCH'; texts: string[]; srcLang: string | null; targetLang: string; engine: EngineId }
  | { type: 'TRANSLATE_BATCH_RESULT'; translated: string[] }
  | { type: 'TRANSLATE_BATCH_ERROR'; error: string }
```

- [ ] **Step 2: tsc 驗證型別正確**

Run: `npx tsc --noEmit`
Expected: PASS（無新錯誤）

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: types 加 TRANSLATE_BATCH 訊息型別"
```

---

## Task 2: translateBatchCached（逐句 cache-aware 批次）

**Files:**
- Create: `src/background/translate-batch.ts`
- Test: `tests/translate-batch.test.ts`

- [ ] **Step 1: 寫失敗測試**

建立 `tests/translate-batch.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { translateBatchCached } from '../src/background/translate-batch'
import { clearCache } from '../src/core/cache'

beforeEach(async () => { await clearCache() })

describe('translateBatchCached', () => {
  it('全 miss：把整批丟給 translateMisses 一次，輸出對齊輸入', async () => {
    const calls: string[][] = []
    const translateMisses = async (m: string[]) => { calls.push(m); return m.map((t) => '譯:' + t) }
    const out = await translateBatchCached(['a', 'b', 'c'], null, 'zh-TW', 'local', translateMisses)
    expect(out).toEqual(['譯:a', '譯:b', '譯:c'])
    expect(calls).toEqual([['a', 'b', 'c']]) // 只呼叫一次、含全部 miss
  })

  it('部分命中快取：只把 miss 丟 translateMisses，命中者用快取值', async () => {
    const translateMisses = async (m: string[]) => m.map((t) => '譯:' + t)
    // 先翻 'a' 入快取
    await translateBatchCached(['a'], null, 'zh-TW', 'local', translateMisses)
    const calls: string[][] = []
    const spy = async (m: string[]) => { calls.push(m); return m.map((t) => 'NEW:' + t) }
    const out = await translateBatchCached(['a', 'b'], null, 'zh-TW', 'local', spy)
    expect(out).toEqual(['譯:a', 'NEW:b']) // a 來自快取、b 新翻
    expect(calls).toEqual([['b']])         // 只有 b 是 miss
  })

  it('全命中快取：不呼叫 translateMisses', async () => {
    const translateMisses = async (m: string[]) => m.map((t) => '譯:' + t)
    await translateBatchCached(['a', 'b'], null, 'zh-TW', 'local', translateMisses)
    let called = false
    const out = await translateBatchCached(['a', 'b'], null, 'zh-TW', 'local', async (m) => { called = true; return m })
    expect(out).toEqual(['譯:a', '譯:b'])
    expect(called).toBe(false)
  })

  it('translateMisses 回傳長度不符時 throw', async () => {
    const bad = async (_m: string[]) => ['只有一個']
    await expect(translateBatchCached(['a', 'b'], null, 'zh-TW', 'local', bad)).rejects.toThrow(/length mismatch/)
  })

  it('不同 engine 各自快取', async () => {
    const calls: string[][] = []
    const t = async (m: string[]) => { calls.push(m); return m.map((x) => '譯:' + x) }
    await translateBatchCached(['a'], null, 'zh-TW', 'deepl', t)
    await translateBatchCached(['a'], null, 'zh-TW', 'local', t)
    expect(calls).toEqual([['a'], ['a']]) // deepl 與 local 各自 miss
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/translate-batch.test.ts`
Expected: FAIL（`translate-batch` 模組不存在）

- [ ] **Step 3: 實作 translateBatchCached**

建立 `src/background/translate-batch.ts`：

```ts
import type { EngineId } from '../types'
import { lineCacheKey } from '../core/cache-key'
import { getCached, putCached } from '../core/cache'

// 批次逐句快取：先查每句 cache，miss 集中交給 translateMisses 一次翻，回填後組回原序。
// translateMisses 注入，方便單元測試（不依賴真 adapter / fetch）。
export async function translateBatchCached(
  texts: string[],
  srcLang: string | null,
  targetLang: string,
  engine: EngineId,
  translateMisses: (misses: string[]) => Promise<string[]>,
): Promise<string[]> {
  const out: (string | null)[] = new Array(texts.length).fill(null)
  const missIdx: number[] = []
  for (let i = 0; i < texts.length; i++) {
    const hit = await getCached(lineCacheKey(texts[i], srcLang, targetLang, engine))
    if (hit && hit[0]?.translated != null) out[i] = hit[0].translated
    else missIdx.push(i)
  }
  if (missIdx.length > 0) {
    const misses = missIdx.map((i) => texts[i])
    const translated = await translateMisses(misses)
    if (translated.length !== misses.length) {
      throw new Error(`translateBatch length mismatch: got ${translated.length}, expected ${misses.length}`)
    }
    for (let k = 0; k < missIdx.length; k++) {
      const i = missIdx[k]
      out[i] = translated[k]
      await putCached(lineCacheKey(texts[i], srcLang, targetLang, engine), [
        { start: 0, dur: 0, text: texts[i], translated: translated[k] },
      ])
    }
  }
  return out.map((v) => v ?? '')
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/translate-batch.test.ts`
Expected: PASS（5 個 test 全過）

- [ ] **Step 5: Commit**

```bash
git add src/background/translate-batch.ts tests/translate-batch.test.ts
git commit -m "feat: translateBatchCached 逐句 cache-aware 批次翻譯 + 測試"
```

---

## Task 3: background 接 TRANSLATE_BATCH

**Files:**
- Modify: `src/background/background.ts`

- [ ] **Step 1: 先還原工作樹臨時 log**

```bash
git checkout -- src/background/background.ts
```
（清掉先前除錯加的 `[submersive][bg]` 臨時 log，回到 HEAD 乾淨版。）

- [ ] **Step 2: 加 import**

在 `src/background/background.ts` 頂部 import 區，於既有 `import { translateLineCached } from './translate-line'` 下方加一行：

```ts
import { translateBatchCached } from './translate-batch'
```

- [ ] **Step 3: 加 translateBatchMisses 函式**

在 `background.ts` 既有 `translateLine` 函式之後、`chrome.runtime.onMessage.addListener` 之前，加入：

```ts
// 批次 miss 的實際翻譯：primary adapter；非 local 失敗則 fallback 本機（對齊整軌 translateCues 行為）。
// 批次已由 scheduler 限制 ≤2000 字，落在 adapter maxCharsPerReq 內，毋須再 chunk。
async function translateBatchMisses(
  misses: string[], srcLang: string | null, targetLang: string, engine: EngineId,
): Promise<string[]> {
  const primary = await pickAdapter(engine)
  try {
    return await runWithRetry(() => primary.translateBatch(misses, srcLang, targetLang), { retries: 3, baseMs: 500 })
  } catch (e) {
    const { localUrl } = await chrome.storage.local.get('localUrl')
    if (engine !== 'local' && localUrl) {
      console.warn('[submersive] 批次翻譯失敗，fallback 本機', e)
      return await runWithRetry(() => new LocalAdapter(localUrl).translateBatch(misses, srcLang, targetLang), { retries: 3, baseMs: 500 })
    }
    throw e
  }
}
```

- [ ] **Step 4: 在 onMessage listener 內加 TRANSLATE_BATCH 分支**

在 `chrome.runtime.onMessage.addListener` 內，既有 `if (msg.type === 'TRANSLATE') { ... return true }` 之後，加入新分支（不要動既有 `TRANSLATE` / `TRANSLATE_LINE` 分支）：

```ts
  if (msg.type === 'TRANSLATE_BATCH') {
    translateBatchCached(msg.texts, msg.srcLang, msg.targetLang, msg.engine,
      (misses) => translateBatchMisses(misses, msg.srcLang, msg.targetLang, msg.engine))
      .then((translated) => sendResponse({ type: 'TRANSLATE_BATCH_RESULT', translated }))
      .catch((e) => sendResponse({ type: 'TRANSLATE_BATCH_ERROR', error: String(e) }))
    return true
  }
```

- [ ] **Step 5: tsc + build 驗證**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS（無型別錯誤、build 成功）

- [ ] **Step 6: Commit**

```bash
git add src/background/background.ts
git commit -m "feat: background 加 TRANSLATE_BATCH handler（cache-aware + local fallback）"
```

---

## Task 4: TranslationScheduler（核心排程器）

**Files:**
- Create: `src/content/translation-scheduler.ts`
- Test: `tests/translation-scheduler.test.ts`

- [ ] **Step 1: 寫失敗測試**

建立 `tests/translation-scheduler.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { TranslationScheduler, type SchedulerDeps } from '../src/content/translation-scheduler'
import type { Cue } from '../src/types'

const cue = (start: number, text: string): Cue => ({ start, dur: 2, text })
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

interface PendingCall { texts: string[]; resolve: (r: string[]) => void; reject: (e: unknown) => void }

function harness(cues: Cue[], time = 0) {
  let now = time
  let nextId = 1
  const timers = new Map<number, () => void>()
  const calls: PendingCall[] = []
  const notices: (string | null)[] = []
  const deps: SchedulerDeps = {
    getTime: () => now,
    translate: (texts) => new Promise((resolve, reject) => calls.push({ texts, resolve, reject })),
    notify: (m) => notices.push(m),
    setTimer: (fn, _ms) => { const id = nextId++; timers.set(id, fn); return id },
    clearTimer: (id) => { timers.delete(id) },
  }
  const sched = new TranslationScheduler(deps)
  sched.setCues(cues)
  return {
    sched, calls, notices,
    setTime: (t: number) => { now = t },
    fireTimers: () => { const fns = [...timers.values()]; timers.clear(); fns.forEach((f) => f()) },
  }
}

describe('TranslationScheduler', () => {
  it('視窗 cues 優先於背景 cues', () => {
    const cues = [cue(0, 'a'), cue(10, 'b'), cue(200, 'c'), cue(5, 'd')]
    const h = harness(cues, 0) // 視窗 [0,90] → a,b,d；c 在背景
    h.sched.start()
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].texts).toEqual(['a', 'b', 'd'])
  })

  it('視窗為空時才翻背景 cues', () => {
    const cues = [cue(200, 'a'), cue(300, 'b')]
    const h = harness(cues, 0) // 視窗 [0,90] 內無 cue
    h.sched.start()
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].texts).toEqual(['a', 'b'])
  })

  it('序列化：in-flight 時不送第二批；完成後立即排下一批', async () => {
    const cues = Array.from({ length: 16 }, (_, i) => cue(i, 't' + i)) // 全在視窗
    const h = harness(cues, 0)
    h.sched.start()
    expect(h.calls).toHaveLength(1)              // 第一批 8 句
    expect(h.calls[0].texts).toHaveLength(8)
    h.fireTimers()                               // tick：in-flight 中 → 不新增
    expect(h.calls).toHaveLength(1)
    h.calls[0].resolve(h.calls[0].texts.map((t) => 'Z' + t))
    await flush()
    expect(h.calls).toHaveLength(2)              // 完成後立即排第二批
    expect(h.calls[1].texts).toHaveLength(8)
  })

  it('批次上限 8 句', () => {
    const cues = Array.from({ length: 20 }, (_, i) => cue(i, 'x'))
    const h = harness(cues, 0)
    h.sched.start()
    expect(h.calls[0].texts).toHaveLength(8)
  })

  it('批次字元上限 2000', () => {
    const big = 'y'.repeat(700)
    const cues = [cue(0, big), cue(1, big), cue(2, big), cue(3, big)] // 每句 700，第 3 句會超 2000
    const h = harness(cues, 0)
    h.sched.start()
    expect(h.calls[0].texts).toHaveLength(2) // 700+700=1400 ok，再加變 2100 > 2000 → 停在 2
  })

  it('成功後就地填入 cue.translated', async () => {
    const cues = [cue(0, 'a'), cue(1, 'b')]
    const h = harness(cues, 0)
    h.sched.start()
    h.calls[0].resolve(['譯a', '譯b'])
    await flush()
    expect(cues[0].translated).toBe('譯a')
    expect(cues[1].translated).toBe('譯b')
  })

  it('seek 後新視窗 cues 搶在背景前', async () => {
    const cues = [cue(0, 'a'), cue(500, 'b'), cue(900, 'c')]
    const h = harness(cues, 0)
    h.sched.start()                 // 視窗 [0,90] → 只有 a
    expect(h.calls[0].texts).toEqual(['a'])
    h.calls[0].resolve(['譯a'])
    await flush()                   // a 完成；此時無其他視窗 cue → 排背景 b,c
    expect(h.calls[1].texts).toEqual(['b', 'c'])
    h.setTime(490)                  // seek 到 490：b(500) 進視窗 [490,580]
    h.calls[1].reject(new Error('丟棄這批模擬還沒回'))
    await flush()
    h.fireTimers()                  // 退避/tick 觸發重排 → 應優先 b（視窗），c 在背景外（900>580）
    expect(h.calls[h.calls.length - 1].texts).toEqual(['b'])
  })

  it('錯誤：notice 只跳一次、恢復時清除', async () => {
    const cues = [cue(0, 'a'), cue(1, 'b')]
    const h = harness(cues, 0)
    h.sched.start()
    h.calls[0].reject(new Error('boom'))
    await flush()
    expect(h.notices).toEqual(['Error: boom'])   // 首次失敗跳一次（String(err)）
    h.fireTimers()                               // 退避到期重排
    h.calls[1].reject(new Error('boom2'))
    await flush()
    expect(h.notices).toEqual(['Error: boom'])   // 連續失敗不重跳
    h.fireTimers()
    h.calls[2].resolve(['譯a', '譯b'])
    await flush()
    expect(h.notices).toEqual(['Error: boom', null]) // 成功後清除
  })

  it('stop 後不再排批', () => {
    const cues = [cue(0, 'a')]
    const h = harness(cues, 0)
    h.sched.start()
    h.calls[0].resolve(['譯a'])
    h.sched.stop()
    h.fireTimers()
    expect(h.calls).toHaveLength(1) // stop 後 tick 不再產生新批
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/translation-scheduler.test.ts`
Expected: FAIL（`translation-scheduler` 模組不存在）

- [ ] **Step 3: 實作 TranslationScheduler**

建立 `src/content/translation-scheduler.ts`：

```ts
import type { Cue } from '../types'

export interface SchedulerDeps {
  getTime: () => number                                // playhead 秒數（video.currentTime）
  translate: (texts: string[]) => Promise<string[]>    // 包 chrome.runtime.sendMessage(TRANSLATE_BATCH)
  notify: (msg: string | null) => void                 // 顯示 Notice；傳 null 清除
  setTimer: (fn: () => void, ms: number) => number      // 注入 setTimeout
  clearTimer: (id: number) => void                      // 注入 clearTimeout
}

const WINDOW_AHEAD_SEC = 90
const BATCH_MAX_CUES = 8
const BATCH_MAX_CHARS = 2000
const TICK_MS = 1500
const BACKOFF_BASE_MS = 500
const BACKOFF_CAP_MS = 30000

// 視窗化排程：視窗(playhead 前方 90s)優先、其餘背景補；序列化單一 in-flight 批次；就地填 cue.translated。
// cues 假設依 start 升序（imsc-parser 依 TTML 文件序產出）。
export class TranslationScheduler {
  private cues: Cue[] = []
  private done = new Set<number>()
  private inflight = false
  private running = false
  private failCount = 0
  private tickId?: number
  private retryId?: number

  constructor(private deps: SchedulerDeps) {}

  // 設定/更新 cue 陣列（就地 mutate 同一引用）。已帶 translated 的 cue 視為完成。
  setCues(cues: Cue[]): void {
    this.cues = cues
    this.done = new Set(cues.map((c, i) => (c.translated != null ? i : -1)).filter((i) => i >= 0))
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.failCount = 0
    this.schedule()
    this.tickId = this.deps.setTimer(this.onTick, TICK_MS)
  }

  stop(): void {
    this.running = false
    if (this.tickId != null) { this.deps.clearTimer(this.tickId); this.tickId = undefined }
    if (this.retryId != null) { this.deps.clearTimer(this.retryId); this.retryId = undefined }
  }

  private onTick = (): void => {
    if (!this.running) return
    this.schedule()
    this.tickId = this.deps.setTimer(this.onTick, TICK_MS)
  }

  private schedule(): void {
    if (!this.running || this.inflight) return
    const batch = this.pickBatch()
    if (batch.length === 0) return
    this.inflight = true
    const texts = batch.map((i) => this.cues[i].text)
    this.deps.translate(texts).then(
      (res) => this.onSuccess(batch, res),
      (err) => this.onFailure(err),
    )
  }

  // 視窗 cues 優先、否則背景 cues；累積到 ≤8 句且字元和 ≤2000。回傳 cue index 陣列。
  private pickBatch(): number[] {
    const t = this.deps.getTime()
    const windowEnd = t + WINDOW_AHEAD_SEC
    const win: number[] = []
    const bg: number[] = []
    for (let i = 0; i < this.cues.length; i++) {
      if (this.done.has(i)) continue
      const s = this.cues[i].start
      if (s >= t && s <= windowEnd) win.push(i)
      else bg.push(i)
    }
    const source = win.length > 0 ? win : bg
    const batch: number[] = []
    let chars = 0
    for (const i of source) {
      const len = this.cues[i].text.length
      if (batch.length > 0 && (batch.length >= BATCH_MAX_CUES || chars + len > BATCH_MAX_CHARS)) break
      batch.push(i)
      chars += len
      if (batch.length >= BATCH_MAX_CUES) break
    }
    return batch
  }

  private onSuccess(batch: number[], res: string[]): void {
    batch.forEach((i, k) => {
      if (res[k] != null) { this.cues[i].translated = res[k]; this.done.add(i) }
    })
    this.inflight = false
    if (this.failCount > 0) { this.failCount = 0; this.deps.notify(null) }
    if (this.running) this.schedule()
  }

  private onFailure(err: unknown): void {
    this.inflight = false
    if (this.failCount === 0) this.deps.notify(String(err))
    this.failCount++
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** this.failCount, BACKOFF_CAP_MS)
    if (this.running) this.retryId = this.deps.setTimer(() => { this.retryId = undefined; this.schedule() }, delay)
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/translation-scheduler.test.ts`
Expected: PASS（9 個 test 全過）

- [ ] **Step 5: Commit**

```bash
git add src/content/translation-scheduler.ts tests/translation-scheduler.test.ts
git commit -m "feat: TranslationScheduler 視窗化 on-demand 排程 + 測試"
```

---

## Task 5: netflix-content 接 scheduler

**Files:**
- Modify: `src/content/netflix-content.ts`

- [ ] **Step 1: 先還原工作樹臨時 log**

```bash
git checkout -- src/content/netflix-content.ts
```
（清掉先前除錯在 `translateAndShow` 加的 try/catch 與 log，回到 HEAD 乾淨版再改。）

- [ ] **Step 2: 改 import 區**

把 `src/content/netflix-content.ts` 頂部 `import { NetflixAdapter } from '../sites/netflix-adapter'` 下方加入 scheduler import：

```ts
import { TranslationScheduler } from './translation-scheduler'
```

- [ ] **Step 3: 建立 scheduler 取代 translateAndShow**

在 `const notice = new Notice(anchor)` 之後、`let gotCues = false` 之前，加入 scheduler 建立（`lastCtx` 已在下方宣告，這裡用閉包讀取，故把 scheduler 宣告放在 `lastCtx` 宣告之後）。

具體：把既有這段
```ts
  let lastCues: Cue[] | null = null
  let lastCtx: VideoContext | null = null
```
改為
```ts
  let lastCues: Cue[] | null = null
  let lastCtx: VideoContext | null = null

  const scheduler = new TranslationScheduler({
    getTime: () => site.getPlayerTime(),
    translate: async (texts) => {
      const res = (await chrome.runtime.sendMessage({
        type: 'TRANSLATE_BATCH', texts,
        srcLang: lastCtx?.srcLang ?? null,
        targetLang: settings.targetLang, engine: settings.engine,
      })) as { type: string; translated?: string[]; error?: string }
      if (res?.type === 'TRANSLATE_BATCH_RESULT' && res.translated) return res.translated
      throw new Error(res?.error ?? 'TRANSLATE_BATCH no response')
    },
    notify: (msg) => { if (msg == null) notice.hide(); else notice.show(friendlyTranslateError(msg)) },
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (id) => clearTimeout(id),
  })
```

- [ ] **Step 4: 刪除 translateAndShow 函式**

刪掉整個 `translateAndShow`（HEAD 版 line 48-63 的註解 + `const translateAndShow = async (cues, ctx) => { ... }`）。

- [ ] **Step 5: 改 applyMode 用 scheduler**

把 `applyMode` 改為：

```ts
  // 套用 mode 到目前畫面 + 控制原生 CC 顯示 + 啟停 scheduler。
  const applyMode = (m: ImmersiveMode) => {
    mode = m
    if (m === 'off') { scheduler.stop(); overlay.unmount(); showNativeCc(); return }
    hideNativeCc()
    overlay.setOriginalOnly(m === 'original')
    overlay.setBilingual(m === 'bilingual')
    if (lastCues) overlay.setCues(lastCues)
    overlay.mount()
    if (m === 'bilingual') scheduler.start()
    else scheduler.stop()
  }
```

> 註：原版 `applyMode` 在 bilingual 時 `overlay.setBilingual(false)` 再靠翻譯完成才設 true；新版直接 `setBilingual(m === 'bilingual')`，因為未翻的 cue overlay 本就只渲染原文（`hasTrans = bilingual && !!cue.translated`），翻好才補第二行。

- [ ] **Step 6: 改 onVideoMaybeChanged 停 scheduler**

在 `onVideoMaybeChanged` 內，既有 `overlay.setBilingual(false)` 那行改為先停 scheduler：

```ts
  const onVideoMaybeChanged = () => {
    const id = getVideoId()
    if (id === currentVideoId) return
    currentVideoId = id
    gotCues = false
    lastCues = null
    lastCtx = null
    clearTimer()
    clearPoll()
    notice.hide()
    scheduler.stop()
    overlay.setBilingual(false)
    if (id) startWatching()
  }
```

- [ ] **Step 7: 改 onSubtitleTrack 餵 scheduler**

把既有 `site.onSubtitleTrack(async (cues, ctx) => { ... })` 改為：

```ts
  site.onSubtitleTrack((cues, ctx) => {
    gotCues = true
    clearTimer()
    notice.hide()
    lastCues = cues
    lastCtx = ctx
    if (mode === 'off') return
    overlay.setCues(cues)
    overlay.setOriginalOnly(mode === 'original')
    overlay.setBilingual(mode === 'bilingual')
    scheduler.setCues(cues)
    overlay.mount()
    if (mode === 'bilingual') scheduler.start()
  })
```

- [ ] **Step 8: tsc + build 驗證**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS（無未使用 import 錯誤；若 `Cue` 型別在檔內已不再被其他處引用而報未使用，移除對應 import）

- [ ] **Step 9: Commit**

```bash
git add src/content/netflix-content.ts
git commit -m "feat: netflix-content 改用 TranslationScheduler 取代整軌 translateAndShow"
```

---

## Task 6: 全測試 + build + 真機驗證

**Files:** 無（驗證）

- [ ] **Step 1: 全測試**

Run: `npx vitest run`
Expected: PASS（既有 54 + translateBatchCached 5 + scheduler 9 ≈ 68 tests 全過）

- [ ] **Step 2: tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS

- [ ] **Step 3: 真機驗證（使用者操作，列清單）**

1. `edge://extensions` → Submersive reload。
2. Netflix `/watch/...` 開 bilingual，確認**原文先出、繁中第二行隨後漸進補上**（不再整片空白）。
3. SW console（服務程式）應見多筆短 `TRANSLATE_BATCH` 往返、無 channel-closed。
4. seek 到未翻處 → 數秒內該段補上譯文。
5. 同片重看 / 重複句 → 譯文近乎即時（cache hit）。
6. 切 original / off → 第二行消失、scheduler 停。

- [ ] **Step 4: 真機 OK 後收尾**

依專案規則委派 Sonnet subagent：renew docs（README / spec 對齊實作）+ 併入既有 9 情境驗收 → merge `feat/netflix-proactive-subtitle` → push。

---

## Self-Review 紀錄

- **Spec coverage**：scheduler（Task 4）涵蓋視窗優先/背景補/序列化/去重/seek/退避/就地填；TRANSLATE_BATCH + 逐句快取（Task 2/3）；netflix 接線（Task 5）；overlay/adapter/opencc/IDB schema 不改（spec 範圍一致）；參數表值落入 scheduler 常數。
- **Placeholder scan**：無 TBD/TODO；每個 code step 皆含完整程式碼。
- **Type consistency**：`SchedulerDeps`、`TranslationScheduler.{setCues,start,stop}`、`TRANSLATE_BATCH/_RESULT/_ERROR`、`translateBatchCached` 簽章在 Task 1/2/4/5 間一致。
- **已知取捨**：onSubtitleTrack 多次以新陣列引用 `setCues`，極少數 in-flight 結果寫到舊陣列被丟棄→該 cue 之後重排重翻（內容相同、成本極小），不另加去重（YAGNI）。
