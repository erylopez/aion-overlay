/**
 * Kina earned this session, and per hour. The tracker passes on the balance whenever it changes
 * (`1b 56`, the Kina stack); what was earned is worked out here from the changes:
 * - Gains add up; spending (repairs, shops) takes nothing off: it is what farming earned.
 * - The hour counts active time only: a gap between gains counts up to KINA_IDLE_MS, so a break
 *   in town does not drag the rate down, and the rate stops falling once you stop.
 * - The first balance after entering the world is only a starting point: a character switch would
 *   otherwise count the other character's whole purse.
 */

export interface KinaSession {
  /** The last balance seen; null until one arrives (and again after entering the world). */
  balance: number | null
  earned: number
  /** Active time between the gains so far (see KINA_IDLE_MS). */
  activeMs: number
  /** When the balance last changed: the active time runs on from here. */
  lastAt: number | null
  /** Each gain as [when, how much], the last KINA_HISTORY_MS of them: the timeline. */
  gains: [number, number][]
}

export const NO_KINA: KinaSession = { balance: null, earned: 0, activeMs: 0, lastAt: null, gains: [] }

/** How far back the timeline goes. */
export const KINA_HISTORY_MS = 30 * 60_000
/** Each point of the timeline is the rate over this long before it. */
export const KINA_WINDOW_MS = 5 * 60_000
const KINA_STEP_MS = 60_000

/** The most a gap between gains counts towards the hour. */
export const KINA_IDLE_MS = 5 * 60_000
/** No rate before this much active time: one kill's Kina is not an hourly rate. */
export const KINA_MIN_MS = 60_000

/** A new balance from the tracker, at `now`. */
export function kinaBalance(s: KinaSession, balance: number, now: number): KinaSession {
  if (s.balance === null) return { ...s, balance, lastAt: s.earned ? s.lastAt : now }
  const gain = balance - s.balance
  if (gain <= 0) return { ...s, balance }
  const gap = s.lastAt === null ? 0 : Math.min(Math.max(now - s.lastAt, 0), KINA_IDLE_MS)
  const gains = [...s.gains.filter(([at]) => at > now - KINA_HISTORY_MS - KINA_WINDOW_MS), [now, gain] as [number, number]]
  return { balance, earned: s.earned + gain, activeMs: s.activeMs + gap, lastAt: now, gains }
}

/** Entering the world (maybe as another character): the next balance is a new starting point. */
export const kinaRebase = (s: KinaSession): KinaSession => ({ ...s, balance: null })

/** Kina per hour at `now`, or null before there is enough to tell. */
export function kinaPerHour(s: KinaSession, now: number): number | null {
  if (!s.earned || s.lastAt === null) return null
  const ms = s.activeMs + Math.min(Math.max(now - s.lastAt, 0), KINA_IDLE_MS)
  return ms < KINA_MIN_MS ? null : (s.earned / ms) * 3_600_000
}

export interface KinaPoint {
  at: number
  /** Kina per hour over the KINA_WINDOW_MS before `at`. */
  perHour: number
}

/**
 * The timeline: a point a minute over the last KINA_HISTORY_MS (from the first gain, if later),
 * each the rate over the 5 minutes before it, so a lull shows as a dip and a break as zero. Empty
 * until there are two points.
 */
export function kinaSeries(s: KinaSession, now: number): KinaPoint[] {
  const first = s.gains[0]?.[0]
  if (first === undefined) return []
  const out: KinaPoint[] = []
  for (let at = now; at >= Math.max(now - KINA_HISTORY_MS, first); at -= KINA_STEP_MS) {
    const sum = s.gains.reduce((n, [t, g]) => (t > at - KINA_WINDOW_MS && t <= at ? n + g : n), 0)
    out.push({ at, perHour: (sum / KINA_WINDOW_MS) * 3_600_000 })
  }
  return out.length < 2 ? [] : out.reverse()
}

/** 950, 12.3k, 1.25M. */
export function formatKina(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 2 : n < 100_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`
}
