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
  private backoff = false

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
    this.backoff = false
  }

  private onTick = (): void => {
    if (!this.running) return
    this.schedule()
    this.tickId = this.deps.setTimer(this.onTick, TICK_MS)
  }

  private schedule(): void {
    if (!this.running || this.inflight || this.backoff) return
    const batch = this.pickBatch()
    if (batch.length === 0) return
    this.inflight = true
    const ref = this.cues
    const texts = batch.map((i) => this.cues[i].text)
    this.deps.translate(texts).then(
      (res) => this.onSuccess(ref, batch, res),
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

  private onSuccess(ref: Cue[], batch: number[], res: string[]): void {
    if (this.cues !== ref) { this.inflight = false; return } // 換片：舊批結果丟棄
    batch.forEach((i, k) => {
      if (res[k] != null) { this.cues[i].translated = res[k]; this.done.add(i) }
    })
    this.inflight = false
    if (this.failCount > 0) { this.failCount = 0; this.deps.notify(null) }
    this.backoff = false
    if (this.running) this.schedule()
  }

  private onFailure(err: unknown): void {
    this.inflight = false
    if (this.failCount === 0) this.deps.notify(String(err))
    this.failCount++
    this.backoff = true
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** this.failCount, BACKOFF_CAP_MS)
    if (this.running) {
      this.retryId = this.deps.setTimer(() => { this.retryId = undefined; this.backoff = false; this.schedule() }, delay)
    }
  }
}
