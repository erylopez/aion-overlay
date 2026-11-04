/**
 * The field bosses (the Gartua timer): what the game's map said.
 *
 * The tracker passes on the field boss list whenever it changes while the map is open, and the
 * Abyss's as you enter it. It goes nowhere else, unless the Lokthar sync is turned on in Settings
 * (main/lokthar.ts listens here). The Abyss's bosses go too: the site follows the ones it has a
 * reportable timer for (Argo, 12 h after a kill) and skips the rest.
 *
 * Kept across restarts in `<userData>/fieldbosses.json`, by game server (a respawn 12 h away
 * outlives the app, and each server has its own bosses).
 */
import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { broadcast } from './broadcast.ts'
import { log } from './tracker.ts'
import { bossOfNpc } from '../shared/bossRuns.ts'
import type { FieldBosses, FieldBossState } from '../shared/timers.ts'

export interface MapBoss {
  id: number
  up: boolean
  at: number
}

let server: number | null = null
/** The zone of the last list of those read from the map (the sync names it). */
let world: number | null = null
let bosses: FieldBosses = {}
const mapListeners = new Set<(server: number | null, world: number, list: MapBoss[]) => void>()

const file = (): string => join(app.getPath('userData'), 'fieldbosses.json')

function load(): void {
  try {
    const saved = JSON.parse(readFileSync(file(), 'utf8')) as { server?: number | null; world?: number | null; bosses?: FieldBosses }
    server = saved.server ?? null
    world = saved.world ?? null
    bosses = saved.bosses ?? {}
  } catch {
    bosses = {}
  }
}

function save(): void {
  try {
    writeFileSync(file(), JSON.stringify({ server, world, bosses }))
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
  /** The last zone the map listed bosses in, and every boss as the map last said (Sync now). */
  lastMap(): { server: number | null; world: number | null; list: MapBoss[] } {
    const list = Object.entries(bosses)
      .filter(([, b]) => b.source === 'map' && (b.up || b.at > 0))
      .map(([id, b]) => ({ id: Number(id), up: b.up, at: b.at }))
    return { server, world, list }
  },

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
  fromMap(zone: number, all: MapBoss[]): void {
    const seen = Date.now()
    // Dead with no time (the Abyss's list has one): nothing to tell of it.
    const list = all.filter((b) => b.up || b.at > 0)
    bosses = { ...bosses, ...Object.fromEntries(list.map((b) => [b.id, mapState(bosses[b.id], b, seen)])) }
    const g = bosses[101021]
    log(
      `field bosses: zone ${zone}, ${list.filter((b) => b.up).length}/${list.length} up` +
        (g ? `; Gartua ${g.up ? 'up' : `respawns ${new Date(g.at).toISOString().slice(0, 16).replace('T', ' ')} UTC`}` : ''),
    )
    changed()
    if (!list.length) return
    world = zone
    for (const fn of mapListeners) fn(server, zone, list)
  },
}

/**
 * A boss as the map lists it now. Listed dead with a respawn to come after it had spawned (up, or
 * its respawn passed): killed in between, told as of now unless a kill in view said already.
 */
function mapState(was: FieldBossState | undefined, b: MapBoss, seen: number): FieldBossState {
  const state: FieldBossState = { up: b.up, at: b.at, seen, source: 'map' }
  if (b.up) return state
  const spawned = !!was && (was.up || (was.at > 0 && was.at <= seen))
  const killedAt = spawned && b.at > seen ? seen : was?.killedAt
  return killedAt ? { ...state, killedAt } : state
}

/** A field boss died in view (the engine's `bossKilled`, by its monster code). */
export function bossKilled(npc: number): void {
  const id = bossOfNpc(npc)
  if (id === null) return
  const now = Date.now()
  // Its respawn is the map's to say: none until then.
  bosses = { ...bosses, [id]: { up: false, at: 0, seen: now, source: 'map', killedAt: now } }
  log(`field bosses: ${id} killed in view`)
  changed()
}

export function startFieldBosses(): void {
  load()
}
