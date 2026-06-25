import { INJECTED_ID } from './dom'

// 在 Netflix 原生字幕容器內注入/更新一行譯文（位於原生字幕節點之後）。
// 不依賴注入節點長存：每次 setTranslation 都重新確保節點存在（React 重渲染會沖掉）。
export class Injector {
  constructor(private getContainer: () => Element | null) {}

  setTranslation(text: string) {
    const container = this.getContainer()
    if (!container) return
    let el = container.querySelector('#' + INJECTED_ID) as HTMLElement | null
    if (!el) {
      el = document.createElement('div')
      el.id = INJECTED_ID
      Object.assign(el.style, {
        textAlign: 'center', color: '#fff', fontSize: '110%',
        textShadow: '0 0 4px #000', marginTop: '2px', pointerEvents: 'none',
      } as Partial<CSSStyleDeclaration>)
      container.appendChild(el)
    }
    el.textContent = text
  }

  clear() {
    this.getContainer()?.querySelector('#' + INJECTED_ID)?.remove()
  }
}
