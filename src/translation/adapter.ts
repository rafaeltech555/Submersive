export interface TranslationCapabilities {
  maxCharsPerReq: number
}

export interface TranslationAdapter {
  // 輸入原文字串陣列，回傳等長譯文字串陣列
  translateBatch(texts: string[], srcLang: string | null, targetLang: string): Promise<string[]>
  capabilities(): TranslationCapabilities
}
