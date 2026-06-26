import { describe, it, expect, beforeEach } from 'vitest'
import { loadMode, saveMode } from '../src/core/toggle-store'

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
  it('未設定過預設為 bilingual', async () => {
    expect(await loadMode()).toBe('bilingual')
  })

  it('saveMode 寫入後 loadMode 讀回', async () => {
    await saveMode('original')
    expect(await loadMode()).toBe('original')
    await saveMode('off')
    expect(await loadMode()).toBe('off')
  })

  it('非法值回退 bilingual', async () => {
    store['immersiveMode'] = 'garbage'
    expect(await loadMode()).toBe('bilingual')
  })

  it('saveMode 寫入 immersiveMode key', async () => {
    await saveMode('off')
    expect(store['immersiveMode']).toBe('off')
  })
})
