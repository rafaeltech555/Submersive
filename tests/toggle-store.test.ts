import { describe, it, expect, beforeEach } from 'vitest'
import { loadEnabled, saveEnabled } from '../src/core/toggle-store'

let store: Record<string, unknown>
beforeEach(() => {
  store = {}
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (keys: string[]) => {
          const o: Record<string, unknown> = {}
          for (const k of keys) if (k in store) o[k] = store[k]
          return o
        },
        set: async (obj: Record<string, unknown>) => { Object.assign(store, obj) },
      },
    },
  }
})

describe('toggle-store', () => {
  it('未設定過預設為 ON(true)', async () => {
    expect(await loadEnabled()).toBe(true)
  })

  it('saveEnabled 寫入後 loadEnabled 讀回', async () => {
    await saveEnabled(false)
    expect(await loadEnabled()).toBe(false)
    await saveEnabled(true)
    expect(await loadEnabled()).toBe(true)
  })
})
