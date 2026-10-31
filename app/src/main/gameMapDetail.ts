/**
 * The game's map at full detail, for finding it on the screen (main/gameMap.ts): the zone map the
 * app ships is 3072 px, the game draws it finer when zoomed in, and matching against the game's own
 * tiles finds about three times as many points that agree. The tiles (questlog.gg's copy of the
 * game's, `<key>/Res/<key>_<column>_<row>.webp`, 2048 px each, 64 for a zone) are downloaded once
 * per zone, the first time you are there with the markers on, and kept in
 * `<userData>/maptiles/<key>/`. What the vision worker makes of them (its keypoints) is kept beside
 * them, so later sessions skip the few seconds that takes.
 */
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { log } from './tracker.ts'

const TILE_CDN = 'https://cdn.questlog.gg/aion-2/assets/Game/UI/Map/WorldMap'
/** Downloads at once. */
const PARALLEL = 4
/** The worker's keypoints file; the number changes when what is in it does. */
const FEATURES = 'features-v1.bin'

export type MapDetail = { kind: 'features'; data: ArrayBuffer } | { kind: 'tiles'; cols: number; rows: number; tiles: ArrayBuffer[] } | null

const dir = (key: string): string => join(app.getPath('userData'), 'maptiles', key)
const tileName = (c: number, r: number): string => `${String(c).padStart(2, '0')}_${String(r).padStart(2, '0')}.webp`
/** Zones being downloaded: one download each, however many ask. */
const pending = new Map<string, Promise<MapDetail>>()

const isKey = (key: string): boolean => /^[A-Za-z0-9_]{1,40}$/.test(key)
const asBuffer = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

async function download(key: string, cols: number, rows: number): Promise<void> {
  const folder = dir(key)
  await mkdir(folder, { recursive: true })
  const todo: [number, number][] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (!existsSync(join(folder, tileName(c, r)))) todo.push([c, r])
  if (!todo.length) return
  log(`game map: downloading ${key}'s detail, ${todo.length} tiles`)
  const started = Date.now()
  let bytes = 0
  const next = async (): Promise<void> => {
    for (let job = todo.shift(); job; job = todo.shift()) {
      const [c, r] = job
      const url = `${TILE_CDN}/${key}/Res/${key}_${tileName(c, r)}`
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
      const data = Buffer.from(await res.arrayBuffer())
      bytes += data.length
      // Written whole or not at all: a half tile would be kept as done.
      const file = join(folder, tileName(c, r))
      await writeFile(`${file}.part`, data)
      await rename(`${file}.part`, file)
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, next))
  log(`game map: ${key}'s detail downloaded, ${(bytes / 1_048_576).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(1)} s`)
}

async function load(key: string, cols: number, rows: number): Promise<MapDetail> {
  const folder = dir(key)
  const features = join(folder, FEATURES)
  if (existsSync(features)) return { kind: 'features', data: asBuffer(await readFile(features)) }
  await download(key, cols, rows)
  const tiles: ArrayBuffer[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) tiles.push(asBuffer(await readFile(join(folder, tileName(c, r)))))
  return { kind: 'tiles', cols, rows, tiles }
}

export const mapDetail = {
  /**
   * A zone's detail: the worker's keypoints when kept, else the tiles (downloaded first if they
   * are not here yet). Null when they cannot be had: the zone map the app ships is used meanwhile.
   */
  get(key: string, cols: number, rows: number): Promise<MapDetail> {
    if (!isKey(key) || !(cols >= 1 && cols <= 16 && rows >= 1 && rows <= 16)) return Promise.resolve(null)
    let job = pending.get(key)
    if (!job) {
      job = load(key, Math.round(cols), Math.round(rows))
        .catch((err: unknown) => {
          log(`game map: no detail for ${key}: ${String(err)}`)
          return null
        })
        .finally(() => pending.delete(key))
      pending.set(key, job)
    }
    return job
  },

  /** What the worker made of the tiles, to load next time instead. */
  async saveFeatures(key: string, data: ArrayBuffer): Promise<void> {
    if (!isKey(key) || !(data instanceof ArrayBuffer) || data.byteLength < 16) return
    const file = join(dir(key), FEATURES)
    await mkdir(dir(key), { recursive: true })
    await writeFile(`${file}.part`, Buffer.from(data))
    await rename(`${file}.part`, file)
    log(`game map: ${key}'s detail kept (${(data.byteLength / 1_048_576).toFixed(1)} MB of keypoints)`)
  },
}
