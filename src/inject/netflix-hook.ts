// 注入到 Netflix 頁面 MAIN world，攔截字幕請求（Netflix 字幕從 *.nflxvideo.net 取）。
// 同時 patch fetch + XHR（Netflix 字幕走 XHR 機率較高）。

function maybeBroadcast(url: string, raw: string) {
  if (!raw) return
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith('<?xml') && !trimmed.startsWith('<tt')) return // 非字幕資源略過
  window.postMessage({ source: 'submersive-hook', kind: 'netflix-imsc', url, raw }, '*')
}

const origFetch = window.fetch
window.fetch = async function (...args: Parameters<typeof fetch>) {
  const res = await origFetch.apply(this, args)
  try {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url
    if (url && url.includes('nflxvideo')) {
      const clone = res.clone()
      clone.text().then((raw) => maybeBroadcast(url, raw)).catch(() => { /* 忽略讀取失敗 */ })
    }
  } catch { /* 不影響原請求 */ }
  return res
}

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
  if (url && url.includes('nflxvideo')) {
    this.addEventListener('load', () => {
      try { maybeBroadcast(url, this.responseText) } catch { /* 忽略 */ }
    })
  }
  // @ts-expect-error 透傳原生多載參數
  return origSend.apply(this, args)
}

console.log('[submersive] netflix hook installed (fetch + XHR)')

export {}
