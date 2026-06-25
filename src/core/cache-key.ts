import type { EngineId } from '../types'

export function cacheKey(
  videoId: string,
  srcLang: string | null,
  targetLang: string,
  engine: EngineId,
): string {
  return `${videoId}|${srcLang ?? 'auto'}>${targetLang}|${engine}`
}

export function lineCacheKey(
  text: string,
  srcLang: string | null,
  targetLang: string,
  engine: EngineId,
): string {
  return `line:${srcLang ?? 'auto'}>${targetLang}|${engine}|${text}`
}
