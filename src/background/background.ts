import type { Message, Cue, EngineId } from '../types'
import { translateLineCached } from './translate-line'
import { chunkCues } from '../core/chunker'
import { DeepLAdapter } from '../translation/deepl-adapter'
import { LocalAdapter } from '../translation/local-adapter'
import { AzureAdapter } from '../translation/azure-adapter'
import type { TranslationAdapter } from '../translation/adapter'
import { runWithRetry } from '../translation/queue'
import { cacheKey } from '../core/cache-key'
import { getCached, putCached } from '../core/cache'

async function pickAdapter(engine: EngineId): Promise<TranslationAdapter> {
  const { deeplKey, localUrl, azureKey, azureRegion } = await chrome.storage.local.get(['deeplKey', 'localUrl', 'azureKey', 'azureRegion'])
  if (engine === 'local') return new LocalAdapter(localUrl ?? 'http://localhost:5000')
  if (engine === 'azure') return new AzureAdapter(azureKey ?? '', azureRegion ?? '')
  return new DeepLAdapter(deeplKey ?? '')
}

async function translateWith(
  adapter: TranslationAdapter, cues: Cue[], srcLang: string | null, targetLang: string,
): Promise<Cue[]> {
  const chunks = chunkCues(cues, adapter.capabilities().maxCharsPerReq)
  const out: Cue[] = cues.map((c) => ({ ...c }))
  for (const chunk of chunks) {
    const translated = await runWithRetry(
      () => adapter.translateBatch(chunk.texts, srcLang, targetLang),
      { retries: 3, baseMs: 500 },
    )
    if (translated.length !== chunk.texts.length) {
      throw new Error(`translation length mismatch: got ${translated.length}, expected ${chunk.texts.length}`)
    }
    chunk.indices.forEach((idx, i) => { out[idx].translated = translated[i] })
  }
  return out
}

async function translateCues(
  cues: Cue[], srcLang: string | null, targetLang: string, engine: EngineId,
): Promise<Cue[]> {
  const primary = await pickAdapter(engine)
  try {
    return await translateWith(primary, cues, srcLang, targetLang)
  } catch (e) {
    const { localUrl } = await chrome.storage.local.get('localUrl')
    if (engine !== 'local' && localUrl) {
      console.warn('[submersive] 翻譯失敗，fallback 本機', e)
      return await translateWith(new LocalAdapter(localUrl), cues, srcLang, targetLang)
    }
    throw e
  }
}

async function translateWithCache(
  videoId: string, cues: Cue[], srcLang: string | null, targetLang: string, engine: EngineId,
): Promise<Cue[]> {
  const key = cacheKey(videoId, srcLang, targetLang, engine)
  const hit = await getCached(key)
  if (hit) return hit
  const result = await translateCues(cues, srcLang, targetLang, engine)
  await putCached(key, result)
  return result
}

async function translateLine(
  text: string, srcLang: string | null, targetLang: string, engine: EngineId,
): Promise<string> {
  return translateLineCached(text, srcLang, targetLang, engine, async (t) => {
    const adapter = await pickAdapter(engine)
    const [translated] = await runWithRetry(
      () => adapter.translateBatch([t], srcLang, targetLang),
      { retries: 3, baseMs: 500 },
    )
    if (translated == null) throw new Error('translation empty')
    return translated
  })
}

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  if (msg.type === 'TRANSLATE') {
    translateWithCache(msg.videoId, msg.cues, msg.srcLang, msg.targetLang, msg.engine)
      .then((cues) => sendResponse({ type: 'TRANSLATE_RESULT', videoId: msg.videoId, cues }))
      .catch((e) => sendResponse({ type: 'TRANSLATE_ERROR', videoId: msg.videoId, error: String(e) }))
    return true
  }
  if (msg.type === 'TRANSLATE_LINE') {
    translateLine(msg.text, msg.srcLang, msg.targetLang, msg.engine)
      .then((translated) => sendResponse({ type: 'TRANSLATE_LINE_RESULT', text: msg.text, translated }))
      .catch((e) => sendResponse({ type: 'TRANSLATE_LINE_ERROR', text: msg.text, error: String(e) }))
    return true
  }
})

console.log('[submersive] background ready')
