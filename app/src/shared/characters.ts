/**
 * Your characters: every one the character selection screen listed, and what the game said about
 * each at its last login (its counters: Odyle energy, entry counts...). The overlay can only read a
 * character's counters while it logs in, so between logins they are worked out from the game's
 * recharge times.
 *
 * Counter ids are the game's (the `0B 61` message at login, engine/src/tracker/protocol.rs
 * `counters`), as matched against the owner's screens on 2026-10-31: energy 60 + 155, Nightmare
 * 11/14, Ascension Trial 3/3, Shugo keys 20/21. Nightmare and the Ascension Trial were the only
 * counters with their values, so they are likely but not proven yet.
 */

export interface CharacterCounters {
  /** When the game sent them (unix ms). */
  at: number
  /** By the game's id: its values (basic, then the recharged extra when there is any). */
  values: Record<string, number[]>
}

export interface TrackedCharacter {
  name: string
  server: number
  /** NCSoft's key for the character (its portrait), from the character list. */
  key: string | null
  className: string | null
  level: number | null
  gearScore: number | null
  legion: string | null
  /** From NCSoft's site (the game sends only other players' combat power). */
  combatPower: number | null
  /** The portrait, as a data URL (downloaded once a day: the window loads only its own images). */
  portrait: string | null
  /** When NCSoft's site was last asked about them (combat power and portrait). */
  fetchedAt: number | null
  /** Where the character list had them (the game's order), and when it last did. */
  order: number
  listedAt: number | null
  /** Their counters at the last login the overlay saw; null until then. */
  counters: CharacterCounters | null
}

/** By `<server>:<name>`. */
export type Characters = Record<string, TrackedCharacter>

export const characterId = (server: number, name: string): string => `${server}:${name}`

export const portraitUrl = (server: number, key: string): string =>
  `https://profileimg.plaync.com/game_profile_images/aion2global/images?gameServerKey=${server}&charKey=${key}`

const HOUR = 3_600_000
const DAY = 24 * HOUR

/**
 * A counter that refills on a schedule: `per` every `every` ms from `offset` past 1970-01-01 00:00
 * UTC, up to `max` (a counter above it, from a purchase or an event, is left as it is).
 */
export interface Refill {
  id: string
  label: string
  max: number
  per: number
  every: number
  offset: number
  /** What the refill is called in the tooltip ("every 3 h"). */
  when: string
}

/**
 * Odyle energy: +15 every 3 hours at 01:00, 04:00, 07:00... UTC (the owner's countdowns pointed at
 * 19:00 UTC; 840 is 56 refills, one week), up to 840. Its second value, the charged energy, does not
 * refill.
 */
export const ENERGY: Refill = { id: '60000001', label: 'Odyle Energy', max: 840, per: 15, every: 3 * HOUR, offset: 1 * HOUR, when: 'every 3 h' }
/** Nightmare: +2 at the daily reset (07:00 UTC), up to 14. */
export const NIGHTMARE: Refill = { id: '4', label: 'Nightmare', max: 14, per: 2, every: DAY, offset: 7 * HOUR, when: 'daily' }
/** The Ascension Trial: +3 at the weekly reset (Wednesday 07:00 UTC: 1970-01-07 was one), up to 3. */
export const ASCENSION: Refill = { id: '70000001', label: 'Ascension Trial', max: 3, per: 3, every: 7 * DAY, offset: 6 * DAY + 7 * HOUR, when: 'weekly' }

/** How many refills came between two times. */
export const refillsBetween = (r: Refill, from: number, to: number): number =>
  Math.max(0, Math.floor((to - r.offset) / r.every) - Math.floor((from - r.offset) / r.every))

/** When the next refill comes. */
export const nextRefill = (r: Refill, now: number): number => (Math.floor((now - r.offset) / r.every) + 1) * r.every + r.offset

export interface CounterNow {
  /** As the game said at the last login. */
  read: number
  /** Worked out for now. */
  now: number
  /** The extra (charged energy), which does not refill. */
  extra: number
  max: number
  /** When it is full (now, if it is), and the next refill. */
  fullAt: number
  nextAt: number
}

/** A counter of `c` now, from its last login's value; null when that login said nothing of it. */
export function counterNow(r: Refill, c: CharacterCounters | null, now: number): CounterNow | null {
  const values = c?.values[r.id]
  if (!c || !values) return null
  // A counter at 0 is left out of the game's list: present as [], or as [0, extra].
  const read = values[0] ?? 0
  const extra = values[1] ?? 0
  const value = read >= r.max ? read : Math.min(r.max, read + refillsBetween(r, c.at, now) * r.per)
  const missing = Math.max(0, r.max - value)
  const nextAt = nextRefill(r, now)
  const fullAt = missing === 0 ? now : nextAt + (Math.ceil(missing / r.per) - 1) * r.every
  return { read, now: value, extra, max: r.max, fullAt, nextAt }
}

/** NCSoft's region code for a server, by its hundreds digit (shared/servers.ts `serverRegion`). */
export function ncsoftRegion(server: number): string | null {
  return ({ 1: 'na', 2: 'na', 3: 'eu', 4: 'la' } as Record<number, string>)[Math.floor(server / 100) % 10] ?? null
}
