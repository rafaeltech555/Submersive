import type { Message, Cue } from '../types'
import { chunkCues } from '../core/chunker'
import { DeepLAdapter } from '../translation/deepl-adapter'
import { runWithRetry } from '../translation/queue'
import { cacheKey } from '../core/cache-key'
import { getCached, putCached } from '../core/cache'
import type { EngineId } from '../types'

// M2：暫從 storage 取 DeepL key（Options 於 M3 提供）
async function getDeepLKey(): Promise<string> {
  const { deeplKey } = await chrome.storage.local.get('deeplKey')
  return deeplKey ?? ''
}

async function translateCues(cues: Cue[], srcLang: string | null, targetLang: string): Promise<Cue[]> {
  const key = await getDeepLKey()
  const adapter = new DeepLAdapter(key)
  const chunks = chunkCues(cues, adapter.capabilities().maxCharsPerReq)
  const out: Cue[] = cues.map((c) => ({ ...c }))
  for (const chunk of chunks) {
    const translated = await runWithRetry(
      () => adapter.translateBatch(chunk.texts, srcLang, targetLang),
      { retries: 3, baseMs: 500 },
    )
    chunk.indices.forEach((idx, i) => { out[idx].translated = translated[i] })
  }
  return out
}

async function translateWithCache(
  videoId: string, cues: Cue[], srcLang: string | null, targetLang: string, engine: EngineId,
): Promise<Cue[]> {
  const key = cacheKey(videoId, srcLang, targetLang, engine)
  const hit = await getCached(key)
  if (hit) return hit
  const result = await translateCues(cues, srcLang, targetLang)
  await putCached(key, result)
  return result
}

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  if (msg.type !== 'TRANSLATE') return
  translateWithCache(msg.videoId, msg.cues, msg.srcLang, msg.targetLang, msg.engine)
    .then((cues) => sendResponse({ type: 'TRANSLATE_RESULT', videoId: msg.videoId, cues }))
    .catch((e) => sendResponse({ type: 'TRANSLATE_ERROR', videoId: msg.videoId, error: String(e) }))
  return true // 非同步回應
})

console.log('[dualsub] background ready')
