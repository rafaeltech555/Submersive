import type { EngineId } from '../types'
import { lineCacheKey } from '../core/cache-key'
import { getCached, putCached } from '../core/cache'

// 逐行翻譯的 cache 包裝：先查 cache，miss 才呼叫 doTranslate 並寫入。
// doTranslate 注入，方便單元測試（不依賴真 adapter / fetch / chrome.storage）。
export async function translateLineCached(
  text: string,
  srcLang: string | null,
  targetLang: string,
  engine: EngineId,
  doTranslate: (text: string) => Promise<string>,
): Promise<string> {
  const key = lineCacheKey(text, srcLang, targetLang, engine)
  const hit = await getCached(key)
  if (hit && hit[0]?.translated != null) return hit[0].translated
  const translated = await doTranslate(text)
  await putCached(key, [{ start: 0, dur: 0, text, translated }])
  return translated
}
