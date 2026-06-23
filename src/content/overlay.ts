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

  private bilingual = false
  setBilingual(v: boolean) { this.bilingual = v }

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

  private render(cue?: Cue) {
    if (!cue) { this.el.replaceChildren(); return }
    const frag = document.createDocumentFragment()
    const orig = document.createElement('div')
    orig.textContent = cue.text
    Object.assign(orig.style, { fontSize: '90%', opacity: '0.8' })
    const trans = document.createElement('div')
    trans.textContent = cue.translated ?? ''
    Object.assign(trans.style, { fontSize: '120%' })
    // 原文在上、譯文在下
    if (this.bilingual && cue.translated) { frag.append(orig, trans) }
    else { frag.append(orig) }
    this.el.replaceChildren(frag)
  }

  // M2/M5 用：套用設定樣式（M1 先留空實作）
  applySettings(_s: Settings) {}
}
