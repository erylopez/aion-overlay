/**
 * The field bosses (the Gartua timer): what the game's map said.
 *
 * The tracker passes on the field boss list whenever it changes while the map is open. It goes
 * nowhere else, unless the Lokthar sync is turned on in Settings (main/lokthar.ts listens here).
 *
 * Kept across restarts in `<userData>/fieldbosses.json`, by game server (a respawn 12 h away
 * outlives the app, and each server has its own bosses).
 */
import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { broadcast } from './broadcast.ts'
import { log } from './tracker.ts'
import type { FieldBosses } from '../shared/timers.ts'

export interface MapBoss {
  id: number
  up: boolean
  at: number
}

let server: number | null = null
let bosses: FieldBosses = {}
const mapListeners = new Set<(server: number | null, world: number, list: MapBoss[]) => void>()

const file = (): string => join(app.getPath('userData'), 'fieldbosses.json')

function load(): void {
  try {
    const saved = JSON.parse(readFileSync(file(), 'utf8')) as { server?: number | null; bosses?: FieldBosses }
    server = saved.server ?? null
    bosses = saved.bosses ?? {}
  } catch {
    bosses = {}
  }
}

function save(): void {
  try {
    writeFileSync(file(), JSON.stringify({ server, bosses }))
  } catch (err) {
    log(`field bosses: not saved: ${String(err)}`)
  }
}

function changed(): void {
  save()
  broadcast('tracker:fieldBosses', bosses)
}

export const fieldBosses = {
  all: (): FieldBosses => bosses,
  server: (): number | null => server,

  /** Every list read from the map, as read (main/lokthar.ts). */
  onMap(fn: (server: number | null, world: number, list: MapBoss[]) => void): void {
    mapListeners.add(fn)
  },

  /** The character's game server: field bosses are per server, so another one starts afresh. */
  setServer(next: number | null): void {
    if (next === null || next === server) return
    if (server !== null) log(`field bosses: server ${server} -> ${next}, starting afresh`)
    server = next
    bosses = {}
    changed()
  },

  /** A list read from the game's map. */
  fromMap(world: number, list: MapBoss[]): void {
    const seen = Date.now()
    bosses = { ...bosses, ...Object.fromEntries(list.map((b) => [b.id, { up: b.up, at: b.at, seen, source: 'map' as const }])) }
    const g = bosses[101021]
    log(
      `field bosses: zone ${world}, ${list.filter((b) => b.up).length}/${list.length} up` +
        (g ? `; Gartua ${g.up ? 'up' : `respawns ${new Date(g.at).toISOString().slice(0, 16).replace('T', ' ')} UTC`}` : ''),
    )
    changed()
    for (const fn of mapListeners) fn(server, world, list)
  },
}

export function startFieldBosses(): void {
  load()
}
