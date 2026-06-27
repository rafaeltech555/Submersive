import { describe, it, expect } from 'vitest'
import { TranslationScheduler, type SchedulerDeps } from '../src/content/translation-scheduler'
import type { Cue } from '../src/types'

const cue = (start: number, text: string): Cue => ({ start, dur: 2, text })
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

interface PendingCall { texts: string[]; resolve: (r: string[]) => void; reject: (e: unknown) => void }

function harness(cues: Cue[], time = 0) {
  let now = time
  let nextId = 1
  const timers = new Map<number, { fn: () => void; ms: number }>()
  const calls: PendingCall[] = []
  const notices: (string | null)[] = []
  const deps: SchedulerDeps = {
    getTime: () => now,
    translate: (texts) => new Promise((resolve, reject) => calls.push({ texts, resolve, reject })),
    notify: (m) => notices.push(m),
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id },
    clearTimer: (id) => { timers.delete(id) },
  }
  const sched = new TranslationScheduler(deps)
  sched.setCues(cues)
  return {
    sched, calls, notices,
    setTime: (t: number) => { now = t },
    fireTimers: () => { const items = [...timers.values()]; timers.clear(); items.forEach((t) => t.fn()) },
    fireByMs: (ms: number) => {
      const hit = [...timers.entries()].filter(([, t]) => t.ms === ms)
      hit.forEach(([id, t]) => { timers.delete(id); t.fn() })
    },
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

  it('setCues 換陣列後，舊批結果不寫入新陣列（換片丟棄）', async () => {
    const oldCues = [cue(0, 'a'), cue(1, 'b')]
    const h = harness(oldCues, 0)
    h.sched.start()                         // 派出 batch（引用 oldCues）
    const newCues = [cue(0, 'x'), cue(1, 'y')]
    h.sched.setCues(newCues)                // 換片：換成新陣列
    h.calls[0].resolve(['譯a', '譯b'])       // 舊批回來
    await flush()
    expect(newCues[0].translated).toBeUndefined() // 不可寫入新陣列
    expect(newCues[1].translated).toBeUndefined()
  })

  it('退避期間 tick 不重排，retry 到期才重排', async () => {
    const cues = [cue(0, 'a'), cue(1, 'b')]
    const h = harness(cues, 0)
    h.sched.start()
    h.calls[0].reject(new Error('x'))
    await flush()              // 進入 backoff，retry(1000ms) 排定
    h.fireByMs(1500)           // 只觸發 tick → 應被 backoff 擋
    expect(h.calls).toHaveLength(1)
    h.fireByMs(1000)           // 觸發 retry → 解除 backoff → 重排
    expect(h.calls).toHaveLength(2)
  })
})
