// 播放器右上角的沉浸翻譯開關鈕（自有元件，不碰站台原生控制列）。
export class ToggleButton {
  private el: HTMLDivElement
  private on: boolean

  constructor(
    private getAnchor: () => HTMLElement | null,
    private onToggle: (on: boolean) => void,
    initialOn: boolean,
  ) {
    this.on = initialOn
    this.el = document.createElement('div')
    this.el.id = 'submersive-toggle'
    Object.assign(this.el.style, {
      position: 'absolute', top: '8px', right: '8px',
      padding: '4px 10px', borderRadius: '6px',
      background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: '13px',
      fontFamily: 'sans-serif', cursor: 'pointer', pointerEvents: 'auto',
      zIndex: '60', userSelect: 'none',
    } as Partial<CSSStyleDeclaration>)
    this.el.addEventListener('click', () => {
      this.on = !this.on
      this.render()
      this.onToggle(this.on)
    })
    this.render()
  }

  private render() {
    this.el.textContent = this.on ? '雙語 ✓' : '原文'
  }

  // anchor 可能晚出現，每次重取並掛上（idempotent）。
  mount() {
    const anchor = this.getAnchor()
    if (anchor && !anchor.contains(this.el)) anchor.appendChild(this.el)
  }

  // 外部（其他分頁）同步狀態，不觸發 onToggle。
  setState(on: boolean) {
    if (this.on === on) return
    this.on = on
    this.render()
  }
}
