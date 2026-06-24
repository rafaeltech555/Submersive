// 在播放器上方顯示狀態訊息（與 Overlay 的底部字幕分離）。
export class Notice {
  private el: HTMLDivElement
  private pill: HTMLSpanElement
  private hideTimer: number | undefined

  constructor(private getAnchor: () => HTMLElement | null) {
    this.el = document.createElement('div')
    this.el.id = 'submersive-notice'
    Object.assign(this.el.style, {
      position: 'absolute', left: '0', right: '0', top: '8%',
      textAlign: 'center', pointerEvents: 'none', zIndex: '60', display: 'none',
    } as Partial<CSSStyleDeclaration>)

    this.pill = document.createElement('span')
    Object.assign(this.pill.style, {
      display: 'inline-block', padding: '6px 14px', borderRadius: '6px',
      background: 'rgba(0,0,0,0.75)', color: '#fff', fontSize: '14px',
      fontFamily: 'sans-serif', textShadow: '0 0 4px #000',
    } as Partial<CSSStyleDeclaration>)
    this.el.appendChild(this.pill)
  }

  show(msg: string, opts?: { autoHideMs?: number }) {
    const anchor = this.getAnchor()
    if (anchor && !anchor.contains(this.el)) anchor.appendChild(this.el)
    this.pill.textContent = msg
    this.el.style.display = 'block'
    if (this.hideTimer !== undefined) { clearTimeout(this.hideTimer); this.hideTimer = undefined }
    if (opts?.autoHideMs) {
      this.hideTimer = window.setTimeout(() => this.hide(), opts.autoHideMs)
    }
  }

  hide() {
    if (this.hideTimer !== undefined) { clearTimeout(this.hideTimer); this.hideTimer = undefined }
    this.el.style.display = 'none'
  }
}
