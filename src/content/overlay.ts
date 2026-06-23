import type { Cue, Settings } from '../types'

export class Overlay {
  private el: HTMLDivElement
  private cues: Cue[] = []
  private raf = 0

  constructor(private getTime: () => number, private getAnchor: () => HTMLElement | null) {
    this.el = document.createElement('div')
    this.el.id = 'dualsub-overlay'
    Object.assign(this.el.style, {
      position: 'absolute', left: '0', right: '0', bottom: '8%',
      textAlign: 'center', color: '#fff', pointerEvents: 'none', zIndex: '60',
      textShadow: '0 0 4px #000',
    } as Partial<CSSStyleDeclaration>)
  }

  setCues(cues: Cue[]) { this.cues = cues }

  mount() {
    const anchor = this.getAnchor()
    if (anchor && !anchor.contains(this.el)) anchor.appendChild(this.el)
    if (this.raf) cancelAnimationFrame(this.raf)
    this.loop()
  }

  unmount() { cancelAnimationFrame(this.raf); this.el.remove() }

  private loop = () => {
    const t = this.getTime()
    const cur = this.cues.find((c) => t >= c.start && t < c.start + c.dur)
    this.render(cur)
    this.raf = requestAnimationFrame(this.loop)
  }

  // M1：只渲染原文；M2 會擴充雙語
  private render(cue?: Cue) {
    if (!cue) { this.el.textContent = ''; return }
    this.el.textContent = cue.text
  }

  // M2/M5 用：套用設定樣式（M1 先留空實作）
  applySettings(_s: Settings) {}
}
