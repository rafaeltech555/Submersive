// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { extractLineText } from '../src/sites/netflix/subtitle-observer'

function makeContainer(html: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'player-timedtext'
  el.innerHTML = html
  return el
}

describe('extractLineText', () => {
  it('抽出原生字幕容器的文字（多容器以換行接）', () => {
    const c = makeContainer(`
      <div class="player-timedtext-text-container"><span>Hello there</span></div>
      <div class="player-timedtext-text-container"><span>second line</span></div>
    `)
    expect(extractLineText(c)).toBe('Hello there\nsecond line')
  })

  it('合併多餘空白、忽略空容器', () => {
    const c = makeContainer(`
      <div class="player-timedtext-text-container"><span>  Hello   world </span></div>
      <div class="player-timedtext-text-container"></div>
    `)
    expect(extractLineText(c)).toBe('Hello world')
  })

  it('忽略我們自己注入的譯文節點（避免回授）', () => {
    const c = makeContainer(`
      <div class="player-timedtext-text-container"><span>Original</span></div>
      <div id="submersive-netflix-line">譯文不該被讀到</div>
    `)
    expect(extractLineText(c)).toBe('Original')
  })

  it('null 或無原生容器回空字串', () => {
    expect(extractLineText(null)).toBe('')
    expect(extractLineText(makeContainer('<div>無關</div>'))).toBe('')
  })
})
