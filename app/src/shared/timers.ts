/**
 * The game's periodic events, as timers: when each happens next, and when to alert for it.
 *
 * Schedules are kept in UTC. Sources (2026-10-12), and what is confirmed:
 * - Black Cloud Merchant: restocks every hour on the hour. Confirmed: its stock record (`91 56`)
 *   carries the next restock time, 15:00:00 UTC when captured at 14:47.
 * - Spacetime Rift: every 3 hours, 00:00, 03:00 ... 21:00 UTC. Confirmed by the in-game countdown
 *   ("starts in 14m 53s" at about 14:45 UTC); aion2hub.com lists the same hours for the global
 *   servers (server time UTC+9, a multiple of 3 hours away, so the hours are the same in UTC).
 * - Shugo Festival: every hour on the hour, its lobby open 3 minutes before (metabot.gg).
 * - Dimensional Invasion: every hour at half past, a 3-minute entry window (The Games Wiki).
 * - Artifact Siege: Monday, Thursday and Saturday at 21:00 server time, with a 10-minute warning
 *   (metabot.gg). Server time is the region's own: New York for NA East (daylight saving
 *   included), Los Angeles for NA West, Berlin for Europe.
 * Checked 2026-10-13 against a community event timer set to NA East: Shugo and the rift at 03:00
 * UTC, the invasion at 02:30, the siege on Thursday at 21:00 New York time (01:00 UTC Friday). The
 * player confirmed the siege at 20:00 Central (21:00 New York). The NA West and Europe zones are
 * metabot.gg's, not checked.
 *
 * Added 2026-10-13, from the same timer (next starts as it counted them) and guides:
 * - Siege Bosses: 30 minutes into each siege (Thursday 21:30 New York).
 * - Guardian Lord Nahma: Friday and Sunday at 21:00 server time (allthings.how, metabot.gg; the
 *   timer showed Friday 21:00 New York).
 * - Watcher Kaira: every 4 hours from 01:00 server time, since the 2026-09-02 patch (The Games
 *   Wiki; older guides say every 3 hours). The timer showed 01:00 New York, which either fits.
 * - Daily reset at 03:00 New York (07:00 UTC), weekly reset on Wednesday at the same time. That
 *   they follow New York's daylight saving, as the siege does, is assumed.
 */

export type TimerId =
  | 'shugo'
  | 'merchant'
  | 'rift'
  | 'invasion'
  | 'kaira'
  | 'siege'
  | 'siegeBosses'
  | 'nahma'
  | 'dailyReset'
  | 'weeklyReset'
  | 'gartua'
  /** A field boss other than Gartua: `fb-<its id in the map's list>`. */
  | `fb-${number}`

export type Schedule =
  /** Every `every` minutes, at `offset` minutes past each period (periods counted from 00:00 UTC). */
  | { kind: 'every'; every: number; offset: number }
  /** On these weekdays (0 = Sunday), at these times (minutes after midnight), in the server
   *  region's time zone. */
  | { kind: 'zoned'; days: number[]; times: number[] }
  /** A field boss: when it respawns, from the map's field boss list (see FieldBossState). */
  | { kind: 'boss'; boss: number }

/** A field boss as the map's list last said: up since `at`, or dead until `at` (ms). */
export interface FieldBossState {
  up: boolean
  at: number
  /** When the list said so. */
  seen: number
  /** Your own map, or other players' (the shared timers, confirmed by several of them). */
  source?: 'map' | 'shared'
}
/** By the list's own boss id (101021 = Eternal Gartua). */
export type FieldBosses = Record<number, FieldBossState>

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]
const hm = (h: number, m = 0): number => h * 60 + m

/** The global servers' regions, and the time zone each one's "server time" is. */
export type Region = 'na-east' | 'na-west' | 'europe' | 'south-america'
export const REGIONS: { id: Region; label: string; zone: string; confirmed: boolean }[] = [
  { id: 'na-east', label: 'NA East', zone: 'America/New_York', confirmed: true },
  { id: 'na-west', label: 'NA West', zone: 'America/Los_Angeles', confirmed: false },
  { id: 'europe', label: 'Europe', zone: 'Europe/Berlin', confirmed: false },
  // São Paulo time (UTC-3, no daylight saving) is assumed for the South American servers.
  { id: 'south-america', label: 'South America', zone: 'America/Sao_Paulo', confirmed: false },
]
const zoneOf = (region: Region): string => REGIONS.find((r) => r.id === region)?.zone ?? 'America/New_York'

export interface TimerDef {
  id: TimerId
  name: string
  /** What it is, in a few words. */
  detail: string
  schedule: Schedule
  /** Minutes before the start to alert by default (0 = at the start); the player can change it. */
  lead: number
  /** False until the times are checked against the game. */
  confirmed: boolean
  /** Whether its alert is on until the player says otherwise: none are (every alert is opt-in). */
  defaultOn: boolean
}

/**
 * Listed in the Timers tab (and so able to alert) until the player chooses otherwise: the events
 * and Gartua; the other field bosses are picked in "Choose timers".
 */
export const defaultShown = (def: TimerDef): boolean => def.schedule.kind !== 'boss' || def.id === 'gartua'

/**
 * Verteron's field bosses by their id in the map's list (`01 91`): named 2026-10-13 from
 * fieldboss_list.pcap, the up ones by their position (each a questlog.gg marker) and the dead ones
 * by their times against the in-game list. Other zones' ids are not known yet.
 */
export const FIELD_BOSSES: { boss: number; name: string }[] = [
  { boss: 101001, name: 'Neikel of the East' },
  { boss: 101002, name: 'Rotten Kutar' },
  { boss: 101003, name: 'Kernon of the West' },
  { boss: 101004, name: 'Kusan the Mad Gladiator' },
  { boss: 101005, name: 'Ritualist Garshim' },
  { boss: 101006, name: 'Bodyguard Teegant' },
  { boss: 101007, name: 'Blooming Korin' },
  { boss: 101008, name: 'Furious Saursus' },
  { boss: 101009, name: 'Bloodfang Pnyn' },
  { boss: 101010, name: 'Heretic Layla' },
  { boss: 101011, name: 'Black Tentacle Lawa' },
  { boss: 101012, name: 'Phantasm Kasia' },
  { boss: 101013, name: 'Centurion Demiros' },
  { boss: 101014, name: 'Divine Ansas' },
  { boss: 101015, name: 'Harvest Manager Moshav' },
  { boss: 101016, name: "Sentinel K'nash" },
  { boss: 101017, name: 'Scholar Aulla' },
  { boss: 101018, name: 'Forest Warrior Aullamu' },
  { boss: 101019, name: 'Chaser Taulo' },
  { boss: 101020, name: 'Researcher Setram' },
  { boss: 101021, name: 'Eternal Gartua' },
  { boss: 101022, name: 'Silent Dartan' },
  { boss: 101023, name: 'Soul Ruler Kashapa' },
  { boss: 101024, name: 'High Commander Lagta' },
]

export const TIMERS: TimerDef[] = [
  {
    id: 'shugo',
    name: 'Shugo Festival',
    detail: 'Minigames in Verteron and Altgard; the lobby opens 3 minutes before',
    schedule: { kind: 'every', every: 60, offset: 0 },
    lead: 3,
    confirmed: true,
    defaultOn: false,
  },
  {
    id: 'merchant',
    name: 'Black Cloud Merchant',
    detail: 'New stock, every hour',
    schedule: { kind: 'every', every: 60, offset: 0 },
    lead: 0,
    confirmed: true,
    defaultOn: false,
  },
  {
    id: 'rift',
    name: 'Spacetime Rift',
    detail: 'Rifts to the other side open (level 45+)',
    schedule: { kind: 'every', every: 180, offset: 0 },
    lead: 5,
    confirmed: true,
    defaultOn: false,
  },
  {
    id: 'invasion',
    name: 'Dimensional Invasion',
    detail: 'A 3-minute entry window',
    schedule: { kind: 'every', every: 60, offset: 30 },
    lead: 3,
    confirmed: true,
    defaultOn: false,
  },
  {
    id: 'kaira',
    name: 'Watcher Kaira',
    detail: 'Abyss boss in Lower Reshanta, at a random spot',
    schedule: { kind: 'zoned', days: EVERY_DAY, times: [hm(1), hm(5), hm(9), hm(13), hm(17), hm(21)] },
    lead: 10,
    confirmed: false,
    defaultOn: false,
  },
  {
    id: 'siege',
    name: 'Artifact Siege',
    detail: 'Elyos and Asmodians fight over the artifacts in Lower Reshanta',
    schedule: { kind: 'zoned', days: [1, 4, 6], times: [hm(21)] },
    lead: 10,
    confirmed: true,
    defaultOn: false,
  },
  {
    id: 'siegeBosses',
    name: 'Siege Bosses',
    detail: 'The bosses, 30 minutes into the siege',
    schedule: { kind: 'zoned', days: [1, 4, 6], times: [hm(21, 30)] },
    lead: 5,
    confirmed: true,
    defaultOn: false,
  },
  {
    id: 'nahma',
    name: 'Guardian Lord Nahma',
    detail: 'Abyss field boss in Lower Reshanta',
    schedule: { kind: 'zoned', days: [0, 5], times: [hm(21)] },
    lead: 10,
    confirmed: true,
    defaultOn: false,
  },
  {
    id: 'gartua',
    name: 'Eternal Gartua',
    detail: 'Verteron field boss on Eternal Isle, 12 h after it dies: open the map to update',
    schedule: { kind: 'boss', boss: 101021 },
    lead: 10,
    confirmed: true,
    defaultOn: false,
  },
  {
    id: 'dailyReset',
    name: 'Daily Reset',
    detail: 'Daily quests and limits reset',
    schedule: { kind: 'zoned', days: EVERY_DAY, times: [hm(3)] },
    lead: 0,
    confirmed: true,
    defaultOn: false,
  },
  {
    id: 'weeklyReset',
    name: 'Weekly Reset',
    detail: 'Weekly quests and limits reset (Wednesday)',
    schedule: { kind: 'zoned', days: [3], times: [hm(3)] },
    lead: 0,
    confirmed: true,
    defaultOn: false,
  },
]
// Gartua above (its own id, kept from before); the others after the events.
for (const b of FIELD_BOSSES) {
  if (b.boss === 101021) continue
  TIMERS.push({
    id: `fb-${b.boss}`,
    name: b.name,
    detail: 'Verteron field boss: open the map to update',
    schedule: { kind: 'boss', boss: b.boss },
    lead: 5,
    confirmed: true,
    defaultOn: false,
  })
}


const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

/** How far `zone`'s wall clock is ahead of UTC at instant `t` (ms; daylight saving included). */
function zoneOffset(zone: string, t: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(t)
  const n = (type: string): number => Number(parts.find((p) => p.type === type)?.value)
  const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'))
  return wall - Math.floor(t / 1000) * 1000
}

/** The first start at or after `from` (ms since epoch). Zoned ones in `region`'s time zone. */
export function nextStart(s: Schedule, from: number, region: Region = 'na-east', bosses: FieldBosses = {}): number {
  if (s.kind === 'boss') {
    // Its respawn, if the map said it is dead; up, or never seen, there is no next start to give.
    const b = bosses[s.boss]
    return b && !b.up && b.at >= from ? b.at : Number.POSITIVE_INFINITY
  }
  if (s.kind === 'every') {
    const period = s.every * MINUTE
    return Math.ceil((from - s.offset * MINUTE) / period) * period + s.offset * MINUTE
  }
  // Zoned: the next 8 days of the zone's calendar, each start at its own UTC offset.
  const zone = zoneOf(region)
  const today = from + zoneOffset(zone, from)
  const midnight = Math.floor(today / DAY) * DAY
  const times = [...s.times].sort((a, b) => a - b)
  for (let d = 0; d <= 7; d++) {
    const day = midnight + d * DAY
    if (!s.days.includes(new Date(day).getUTCDay())) continue
    for (const t of times) {
      const wall = day + t * MINUTE
      // The offset that applies at the start itself (it can differ from today's across a change).
      const start = wall - zoneOffset(zone, wall - zoneOffset(zone, wall))
      if (start >= from) return start
    }
  }
  return Number.POSITIVE_INFINITY
}

/** The alert leads the player can pick, in minutes. */
export const LEAD_CHOICES = [0, 1, 2, 3, 5, 10, 15, 20, 30, 45, 60]

/**
 * The leads that make sense for a timer: shorter than the gap between its starts, so an alert never
 * begins before the previous start's is over (an hourly event cannot alert an hour early).
 */
export function leadChoices(def: TimerDef): number[] {
  const s = def.schedule
  const gap =
    s.kind === 'boss'
      ? Number.POSITIVE_INFINITY
      : s.kind === 'every'
      ? s.every
      : s.days.length === 7 && s.times.length > 1
        ? Math.min(...s.times.slice(1).map((t, i) => t - s.times[i]!))
        : Number.POSITIVE_INFINITY
  return LEAD_CHOICES.filter((m) => m < gap)
}

/** How long an alert stays up after the start, unless dismissed. */
export const ALERT_AFTER_MS = 2 * MINUTE

/**
 * The start an alert is up for at `now`, or null: from `lead` minutes before a start (the timer's
 * default unless given) until ALERT_AFTER_MS after it.
 */
export function alertingStart(
  def: TimerDef,
  now: number,
  region: Region = 'na-east',
  lead = def.lead,
  bosses: FieldBosses = {},
): number | null {
  const next = nextStart(def.schedule, now - ALERT_AFTER_MS, region, bosses)
  return now >= next - lead * MINUTE && now < next + ALERT_AFTER_MS ? next : null
}

/** A timer alerting now: which, and for the start at `at`. */
export interface TimerAlert {
  id: TimerId
  at: number
}
