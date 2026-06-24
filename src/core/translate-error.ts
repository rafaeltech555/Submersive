// 將後端回傳的原始 error 字串映射成使用者可讀的繁中提示。
export function friendlyTranslateError(error: string | undefined): string {
  const raw = error ?? ''
  if (!raw.trim()) return '翻譯失敗：未知錯誤'
  const e = raw.toLowerCase()
  if (/(401|403|456|authorization|auth)/.test(e)) {
    return '翻譯失敗：API key 無效或額度用盡，請至設定檢查'
  }
  if (/(failed to fetch|localhost|127\.0\.0\.1|econnrefused|networkerror)/.test(e)) {
    return '翻譯失敗：本機翻譯 server 未啟動或無法連線'
  }
  if (e.includes('length mismatch')) {
    return '翻譯失敗：翻譯結果長度不符，請稍後重試'
  }
  return `翻譯失敗：${raw}`
}
