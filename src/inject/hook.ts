// 注入到 YouTube 頁面 MAIN world，攔截字幕請求
const origFetch = window.fetch
window.fetch = async function (...args: Parameters<typeof fetch>) {
  const res = await origFetch.apply(this, args)
  try {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url
    if (url && url.includes('timedtext')) {
      const clone = res.clone()
      clone.text().then((raw) => {
        window.postMessage({ source: 'dualsub-hook', kind: 'timedtext', url, raw }, '*')
      })
    }
  } catch {
    /* 不影響原請求 */
  }
  return res
}
console.log('[dualsub] timedtext hook installed')
