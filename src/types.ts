export interface Cue {
  start: number   // 起始秒
  dur: number     // 持續秒
  text: string    // 原文
  translated?: string
}

export interface VideoContext {
  videoId: string
  srcLang: string | null  // 字幕原文語言（可能未知）
}

export type EngineId = 'deepl' | 'local' | 'azure' | 'ollama'

export interface Settings {
  targetLang: string      // 例 'zh-TW'
  showOriginal: boolean
  engine: EngineId
  fontScale: number       // 1.0 = 預設
  verticalPos: number     // 0..1，1 = 最底
  bgOpacity: number       // 0..1
  originalFirst: boolean  // true: 原文在上
}

export const DEFAULT_SETTINGS: Settings = {
  targetLang: 'zh-TW',
  showOriginal: true,
  engine: 'deepl',
  fontScale: 1.0,
  verticalPos: 0.9,
  bgOpacity: 0.5,
  originalFirst: true,
}

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
