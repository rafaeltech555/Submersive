import type { ImmersiveMode } from '../core/toggle-store'

const LABELS: Record<ImmersiveMode, string> = { bilingual: '雙語 ✓', original: '原文', off: '關閉' }
const NEXT: Record<ImmersiveMode, ImmersiveMode> = { bilingual: 'original', original: 'off', off: 'bilingual' }

// 播放器右上角的沉浸翻譯開關鈕（自有元件，不碰站台原生控制列）。點擊循環 bilingual→original→off。
export class ToggleButton {
  private el: HTMLDivElement
  private mode: ImmersiveMode

  constructor(
    private getAnchor: () => HTMLElement | null,
    private onCycle: (mode: ImmersiveMode) => void,
    initialMode: ImmersiveMode,
  ) {
    this.mode = initialMode
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
      this.mode = NEXT[this.mode]
      this.render()
      this.onCycle(this.mode)
    })
    this.render()
  }

  private render() {
    this.el.textContent = LABELS[this.mode]
  }

  // anchor 可能晚出現，每次重取並掛上（idempotent）。
  mount() {
    const anchor = this.getAnchor()
    if (anchor && !anchor.contains(this.el)) anchor.appendChild(this.el)
  }

  // 外部（其他分頁）同步狀態，不觸發 onCycle。
  setMode(mode: ImmersiveMode) {
    if (this.mode === mode) return
    this.mode = mode
    this.render()
  }
}
