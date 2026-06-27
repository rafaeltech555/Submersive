// 注入到 YouTube 頁面 MAIN world，攔截字幕請求
const origFetch = window.fetch
window.fetch = async function (...args: Parameters<typeof fetch>) {
  const res = await origFetch.apply(this, args)
  try {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url
    if (url && url.includes('timedtext')) {
      const clone = res.clone()
      clone.text().then((raw) => {
        window.postMessage({ source: 'submersive-hook', kind: 'timedtext', url, raw }, '*')
      }).catch(() => { /* 忽略讀取失敗，不影響原請求 */ })
    }
  } catch {
    /* 不影響原請求 */
  }
  return res
}
// YouTube 的字幕請求可能走 XHR 而非 fetch，一併攔截。
const xhrProto = XMLHttpRequest.prototype
const origOpen = xhrProto.open
xhrProto.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
  ;(this as XMLHttpRequest & { __submersiveUrl?: string }).__submersiveUrl =
    typeof url === 'string' ? url : String(url)
  // @ts-expect-error 透傳原生多載參數
  return origOpen.call(this, method, url, ...rest)
}
const origSend = xhrProto.send
xhrProto.send = function (this: XMLHttpRequest, ...args: unknown[]) {
  const url = (this as XMLHttpRequest & { __submersiveUrl?: string }).__submersiveUrl
  if (url && url.includes('timedtext')) {
    this.addEventListener('load', () => {
      try {
        const raw = this.responseText
        window.postMessage({ source: 'submersive-hook', kind: 'timedtext', url, raw }, '*')
      } catch { /* 忽略 */ }
    })
  }
  // @ts-expect-error 透傳原生多載參數
  return origSend.apply(this, args)
}

console.log('[submersive] timedtext hook installed (fetch + XHR)')

export {}
