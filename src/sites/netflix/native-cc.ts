const STYLE_ID = 'submersive-hide-native-cc'

// 注入 <style> 隱藏 Netflix 原生字幕容器；已存在則不重複加（idempotent）。
export function hideNativeCc(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = '.player-timedtext { display: none !important }'
  document.head.appendChild(style)
}

// 移除上面注入的 <style>，原生字幕回復；不存在則 no-op。
export function showNativeCc(): void {
  document.getElementById(STYLE_ID)?.remove()
}
