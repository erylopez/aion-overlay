/**
 * Your characters (the Characters page): every one the character selection screen lists, their
 * class, level and gear score as it lists them, and each one's counters (Odyle energy, entry
 * counts) as the game sends them when it logs in. Combat power and portraits come from NCSoft's
 * site (the game sends neither for you), asked once a day per character.
 *
 * Kept across restarts in `<userData>/characters.json`.
 */
import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { broadcast } from './broadcast.ts'
import { log, tracker } from './tracker.ts'
import { characterId, ncsoftRegion, portraitUrl, type Characters, type TrackedCharacter } from '../shared/characters.ts'

/** How long NCSoft's combat power and portrait are kept before asking again. */
const FETCH_EVERY_MS = 24 * 3_600_000
/** A failed ask is tried again after this long. */
const RETRY_MS = 15 * 60_000
const SEARCH_URL = 'https://api-search.plaync.com/aion2global/search/v2/character'
const INFO_URL = 'https://aion2.plaync.com/api/character/info'

let characters: Characters = {}
/** Asked or failed recently, by id: not asked again before then. */
const asked = new Map<string, number>()
let fetching = false
/** Asked for while a fetch was going: another round after it. */
let again = false

const file = (): string => join(app.getPath('userData'), 'characters.json')

function load(): void {
  try {
    characters = (JSON.parse(readFileSync(file(), 'utf8')) as { characters?: Characters }).characters ?? {}
  } catch {
    characters = {}
  }
}

function changed(): void {
  try {
    writeFileSync(file(), JSON.stringify({ characters }))
  } catch (err) {
    log(`characters: not saved: ${String(err)}`)
  }
  broadcast('characters:changed', characters)
}

function entry(server: number, name: string): TrackedCharacter {
  const id = characterId(server, name)
  characters[id] ??= {
    name, server, key: null, className: null, level: null, gearScore: null, legion: null,
    combatPower: null, portrait: null, fetchedAt: null, order: Object.keys(characters).length, listedAt: null, counters: null,
  }
  return characters[id]
}

interface Listed {
  key: string
  name: string
  server: number
  className: string | null
  level: number
  gearScore: number
  legion: string | null
}

async function getJson(url: string, params: Record<string, string | number>): Promise<Record<string, unknown>> {
  const query = new URLSearchParams(Object.entries(params).map(([k, v]): [string, string] => [k, String(v)]))
  const res = await fetch(`${url}?${query}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as Record<string, unknown>
}

/** NCSoft's combat power for `c` (their search finds the character id, their info has it). */
async function fetchCombatPower(c: TrackedCharacter): Promise<number | null> {
  const region = ncsoftRegion(c.server)
  if (!region) return null
  const found = await getJson(SEARCH_URL, {
    keyword: c.name, race: c.server < 2000 ? 1 : 2, serverId: c.server, page: 1, size: 30, region, localeInfo: 'en-US',
  })
  const list = (found['list'] as { characterId: string; name: string; serverId: number; profileImageUrl?: string }[] | undefined) ?? []
  const plain = (s: string): string => s.replace(/<[^>]*>/g, '')
  const hit = list.find((e) => (c.key && e.profileImageUrl?.endsWith(`charKey=${c.key}`)) || (e.serverId === c.server && plain(e.name) === c.name))
  if (!hit) return null
  const info = await getJson(INFO_URL, { region, serverId: c.server, characterId: decodeURIComponent(hit.characterId), lang: 'en-US' })
  const power = (info['profile'] as { combatPower?: unknown } | undefined)?.combatPower
  return typeof power === 'number' ? power : null
}

async function fetchPortrait(c: TrackedCharacter): Promise<string | null> {
  if (!c.key) return null
  const res = await fetch(portraitUrl(c.server, c.key), { redirect: 'follow', signal: AbortSignal.timeout(15_000) })
  const type = res.headers.get('content-type') ?? ''
  if (!res.ok || !type.startsWith('image/')) {
    log(`characters: ${c.name}'s portrait: HTTP ${res.status} ${type}`)
    return null
  }
  return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`
}

/** Ask NCSoft about one character: its combat power and portrait, each kept when the other fails. */
async function fetchOne(c: TrackedCharacter): Promise<void> {
  const [power, portrait] = await Promise.allSettled([fetchCombatPower(c), fetchPortrait(c)])
  const got = <T>(r: PromiseSettledResult<T | null>): T | null => (r.status === 'fulfilled' ? r.value : null)
  c.combatPower = got(power) ?? c.combatPower
  c.portrait = got(portrait) ?? c.portrait
  // Done for the day only with both: a missing portrait is asked again after RETRY_MS.
  if (got(power) !== null && (got(portrait) !== null || !c.key)) c.fetchedAt = Date.now()
  const why = (r: PromiseSettledResult<unknown>): string => (r.status === 'rejected' ? ` (${(r.reason as Error).message})` : '')
  log(`characters: ${c.name} from NCSoft: combat power ${got(power) ?? '?'}${why(power)}, portrait ${got(portrait) ? 'yes' : 'no'}${why(portrait)}`)
  changed()
}

/** Ask NCSoft about each character not asked in a day, or still without a portrait, one at a time. */
async function fetchMissing(): Promise<void> {
  if (fetching) {
    again = true
    return
  }
  fetching = true
  try {
    do {
      again = false
      for (const [id, c] of Object.entries(characters)) {
        const now = Date.now()
        const due = !c.fetchedAt || now - c.fetchedAt >= FETCH_EVERY_MS || (!c.portrait && !!c.key)
        if (!due || (asked.get(id) ?? 0) > now) continue
        asked.set(id, now + RETRY_MS)
        await fetchOne(c)
      }
    } while (again)
  } finally {
    fetching = false
  }
}

export const characterStore = {
  all: (): Characters => characters,
  /** Ask NCSoft again now (the refresh button). */
  async refresh(id: string): Promise<void> {
    const c = characters[id]
    if (!c) return
    asked.set(id, Date.now() + RETRY_MS)
    await fetchOne(c)
  },
  /** Stop tracking a character (it was deleted in game, say). */
  forget(id: string): void {
    delete characters[id]
    changed()
  },
}

export function startCharacters(): void {
  load()
  // The character selection screen: every character of the server, in the game's order.
  tracker.onEvent('characterList', (ev) => {
    const list = ev['characters'] as Listed[]
    const at = (ev['ts'] as number | undefined) ?? Date.now()
    list.forEach((l, order) => {
      const c = entry(l.server, l.name)
      Object.assign(c, { key: l.key, className: l.className ?? c.className, level: l.level, gearScore: l.gearScore, legion: l.legion, order, listedAt: at })
    })
    log(`characters: listed ${list.map((l) => l.name).join(', ')}`)
    changed()
    void fetchMissing()
  })
  // You, entering the world: what you are now.
  tracker.onEvent('me', (ev) => {
    const c = entry(ev['server'] as number, ev['name'] as string)
    Object.assign(c, { className: (ev['className'] as string | null) ?? c.className, level: ev['level'], gearScore: ev['gearScore'] })
    changed()
    void fetchMissing()
  })
  // The login's counters.
  tracker.onEvent('counters', (ev) => {
    const server = ev['server'] as number | null
    if (server === null) return
    const c = entry(server, ev['name'] as string)
    c.counters = { at: (ev['ts'] as number | undefined) ?? Date.now(), values: ev['values'] as Record<string, number[]> }
    log(`characters: ${c.name}'s counters, energy ${JSON.stringify(c.counters.values['60000001'] ?? null)}`)
    changed()
  })
  void fetchMissing()
}
