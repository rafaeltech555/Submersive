import { openDB, type IDBPDatabase } from 'idb'
import type { Cue } from '../types'

let dbp: Promise<IDBPDatabase> | null = null
function db() {
  if (!dbp) dbp = openDB('submersive', 1, { upgrade(d) { d.createObjectStore('cues') } })
  return dbp
}

export async function getCached(key: string): Promise<Cue[] | null> {
  const v = await (await db()).get('cues', key)
  return (v as Cue[]) ?? null
}

export async function putCached(key: string, cues: Cue[]): Promise<void> {
  await (await db()).put('cues', cues, key)
}

export async function clearCache(): Promise<void> {
  await (await db()).clear('cues')
}
