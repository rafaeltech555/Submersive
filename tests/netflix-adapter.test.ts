// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NetflixAdapter } from '../src/sites/netflix-adapter'

describe('NetflixAdapter', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/watch/12345' },
      writable: true,
    })
  })

  it('emits parsed cues + ctx to subscribers on hook message', async () => {
    const adapter = new NetflixAdapter()
    const cb = vi.fn()
    adapter.onSubtitleTrack(cb)

    const xml = `<?xml version="1.0"?>
<tt><body><div>
  <p begin="00:00:01.000" end="00:00:03.000">Test</p>
</div></body></tt>`

    window.postMessage(
      { source: 'submersive-hook', kind: 'netflix-imsc', url: 'x', raw: xml },
      '*',
    )
    await new Promise((r) => setTimeout(r, 0))

    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith(
      [{ start: 1, dur: 2, text: 'Test' }],
      { videoId: '12345', srcLang: null },
    )
  })

  it('ignores non-submersive messages', async () => {
    const adapter = new NetflixAdapter()
    const cb = vi.fn()
    adapter.onSubtitleTrack(cb)

    window.postMessage({ source: 'other', raw: '<tt/>' }, '*')
    await new Promise((r) => setTimeout(r, 0))

    expect(cb).not.toHaveBeenCalled()
  })

  it('does not emit when parser returns []', async () => {
    const adapter = new NetflixAdapter()
    const cb = vi.fn()
    adapter.onSubtitleTrack(cb)

    window.postMessage(
      { source: 'submersive-hook', kind: 'netflix-imsc', url: 'x', raw: 'garbage' },
      '*',
    )
    await new Promise((r) => setTimeout(r, 0))

    expect(cb).not.toHaveBeenCalled()
  })

  it('detectVideo returns videoId from /watch/<id>', () => {
    const adapter = new NetflixAdapter()
    expect(adapter.detectVideo()).toEqual({ videoId: '12345', srcLang: null })
  })
})
