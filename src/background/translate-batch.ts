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
