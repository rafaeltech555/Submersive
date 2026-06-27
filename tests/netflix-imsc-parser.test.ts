// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { parseImsc } from '../src/sites/netflix/imsc-parser'

describe('parseImsc', () => {
  it('parses standard TTML with multiple cues', () => {
    const xml = `<?xml version="1.0"?>
<tt xmlns="http://www.w3.org/ns/ttml">
  <body><div>
    <p begin="00:00:01.000" end="00:00:03.000">Hello</p>
    <p begin="00:00:04.500" end="00:00:06.500">World</p>
  </div></body>
</tt>`
    const cues = parseImsc(xml)
    expect(cues).toEqual([
      { start: 1, dur: 2, text: 'Hello' },
      { start: 4.5, dur: 2, text: 'World' },
    ])
  })

  it('handles <br/> as line break', () => {
    const xml = `<?xml version="1.0"?>
<tt><body><div>
  <p begin="00:00:01.000" end="00:00:02.000">Line one<br/>Line two</p>
</div></body></tt>`
    const cues = parseImsc(xml)
    expect(cues).toHaveLength(1)
    expect(cues[0].text).toBe('Line one\nLine two')
  })

  it('skips cues with malformed time and warns', () => {
    const xml = `<?xml version="1.0"?>
<tt><body><div>
  <p begin="bogus" end="00:00:02.000">A</p>
  <p begin="00:00:03.000" end="00:00:05.000">B</p>
</div></body></tt>`
    expect(parseImsc(xml)).toEqual([{ start: 3, dur: 2, text: 'B' }])
  })

  it('returns [] for malformed XML', () => {
    expect(parseImsc('not <<xml>>')).toEqual([])
  })

  it('returns [] for TTML without <p>', () => {
    expect(parseImsc('<?xml version="1.0"?><tt><body><div></div></body></tt>')).toEqual([])
  })
})
