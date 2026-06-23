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
  private showOriginal = true
  private originalFirst = true
  private fontScale = 1
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
    const hasTrans = this.bilingual && !!cue.translated
    const orig = document.createElement('div')
    orig.textContent = cue.text
    Object.assign(orig.style, { fontSize: `${90 * this.fontScale}%`, opacity: '0.8' })
    const trans = document.createElement('div')
    trans.textContent = cue.translated ?? ''
    Object.assign(trans.style, { fontSize: `${120 * this.fontScale}%` })
    const lines: HTMLElement[] = []
    if (hasTrans) {
      if (this.showOriginal) lines.push(...(this.originalFirst ? [orig, trans] : [trans, orig]))
      else lines.push(trans)
    } else {
      lines.push(orig) // 還沒翻譯好，先顯示原文
    }
    this.el.replaceChildren(...lines)
  }

  applySettings(s: Settings) {
    this.showOriginal = s.showOriginal
    this.originalFirst = s.originalFirst
    this.fontScale = s.fontScale
    this.el.style.bottom = `${(1 - s.verticalPos) * 100}%`
    this.el.style.background = `rgba(0,0,0,${s.bgOpacity})`
  }
}
