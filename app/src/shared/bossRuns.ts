/**
 * Boss Runs: Verteron's field bosses about to spawn, soonest first, each with the teleport (the
 * Kibelisk) closest to it, as players call them in chat: "Neikel, TP 6", "Dartan, TP 33".
 *
 * The closest Kibelisk is worked out from questlog.gg's map (2026-11-03): its Kibelisks
 * (`teleport-artifact` markers) and the boss's own marker, as the crow flies. Its number is the
 * game's list of Kibelisks (the map's Kibelisk tab), which questlog does not have: the player's
 * own mapping (2026-11-03), as chat uses them. Eternal Gartua, on Eternal Isle, has none near: chat
 * sends it to Aullaeu Village Sky Island (35).
 *
 * The small ones: Neikel, Kutar and Kernon, never seen more than 24 minutes from respawning in the
 * owner's logs (2026-10-21 to 11-03), back every 30 minutes; every other one was seen 37 or more.
 *
 * `npc` is the boss's monster code (scripts/fetch-boss-icons.mjs, data/fieldBossNpcs.json), which
 * the engine names when one dies in view (FIELD_BOSS_NPCS in engine/src/tracker/mod.rs).
 */
import type { FieldBosses } from './timers.ts'

export interface BossRun {
  /** The boss's id in the map's list (shared/timers.ts FIELD_BOSSES). */
  boss: number
  /** As chat calls it. */
  short: string
  npc: number
  tp: number | null
  tpName: string | null
  /** A small one, back every 30 minutes, which runs often skip: it can be left out of the alive count. */
  small?: boolean
}

export const BOSS_RUNS: BossRun[] = [
  { boss: 101001, short: 'Neikel', npc: 2100003, tp: 6, tpName: 'Cantas Valley Mushroom Tree Peak', small: true },
  { boss: 101002, short: 'Kutar', npc: 2100040, tp: 9, tpName: 'Marsh Outpost', small: true },
  { boss: 101003, short: 'Kernon', npc: 2100050, tp: 4, tpName: 'Coastal Camp', small: true },
  { boss: 101004, short: 'Kusan', npc: 2100076, tp: 19, tpName: 'Collapsed Pillar' },
  { boss: 101005, short: 'Garshim', npc: 2100077, tp: 20, tpName: 'Illusion Oratory Entrance' },
  { boss: 101006, short: 'Teegant', npc: 2100079, tp: 21, tpName: 'Verteron Fortress Valley' },
  { boss: 101007, short: 'Korin', npc: 2100141, tp: 13, tpName: "Illusion Cavaliers' Campsite" },
  { boss: 101008, short: 'Saursus', npc: 2100177, tp: 27, tpName: 'Astin Mercenaries Base' },
  { boss: 101009, short: 'Pnyn', npc: 2100178, tp: 26, tpName: 'Southern Shugo Station' },
  { boss: 101010, short: 'Layla', npc: 2100582, tp: 23, tpName: 'Zumion Temple Pilgrimage Path' },
  { boss: 101011, short: 'Lawa', npc: 2100617, tp: 44, tpName: 'Ancient Zumion Temple Site' },
  { boss: 101012, short: 'Kasia', npc: 2100661, tp: 59, tpName: 'Garden of the Illusion God West Observatory' },
  { boss: 101013, short: 'Demiros', npc: 2100708, tp: 43, tpName: 'Altamia Highland Ruins' },
  { boss: 101014, short: 'Ansas', npc: 2100718, tp: 43, tpName: 'Altamia Highland Ruins' },
  { boss: 101015, short: 'Moshav', npc: 2100876, tp: 54, tpName: 'Drana Transport Hub' },
  { boss: 101016, short: "K'nash", npc: 2100877, tp: 54, tpName: 'Drana Transport Hub' },
  { boss: 101017, short: 'Aulla', npc: 2100988, tp: 32, tpName: 'Abandoned Wind Breeze Office' },
  { boss: 101018, short: 'Aullamu', npc: 2100989, tp: 33, tpName: 'Aullaeu Village Valley' },
  { boss: 101019, short: 'Taulo', npc: 2100991, tp: 32, tpName: 'Abandoned Wind Breeze Office' },
  { boss: 101020, short: 'Setram', npc: 2101016, tp: 57, tpName: 'Nahid Disposal Plant' },
  { boss: 101021, short: 'Gartua', npc: 2101074, tp: 35, tpName: 'Aullaeu Village Sky Island' },
  { boss: 101022, short: 'Dartan', npc: 2101120, tp: 33, tpName: 'Aullaeu Village Valley' },
  { boss: 101023, short: 'Kashapa', npc: 2101122, tp: 44, tpName: 'Ancient Zumion Temple Site' },
  { boss: 101024, short: 'Lagta', npc: 2101131, tp: 53, tpName: "Laborer's Rest Stop" },
]

/** The Abyss's, for the engine's kills only (not on the list: no Kibelisks there). */
const ABYSS_NPCS: Record<number, number> = { 2600068: 2001, 2600089: 2002, 2600084: 2003, 2600093: 2004, 2600094: 2005, 2600096: 2006, 2600097: 2007, 2600098: 2008 }

/** Altgard's (the Asmodians'), for the engine's kills only: its monsters in the order of the list, 111001 on. */
const ALTGARD_NPCS = [
  2400017, 2400074, 2400140, 2400141, 2400212, 2400223, 2400274, 2400335, 2400353, 2400358, 2400419, 2400424,
  2400425, 2400474, 2400504, 2400593, 2400607, 2400608, 2400659, 2400709, 2400800, 2400853, 2400854, 2400855,
]

/** A field boss's id in the map's list, from its monster code (a kill in view), or null. */
export function bossOfNpc(npc: number): number | null {
  const altgard = ALTGARD_NPCS.indexOf(npc)
  return BOSS_RUNS.find((r) => r.npc === npc)?.boss ?? ABYSS_NPCS[npc] ?? (altgard >= 0 ? 111001 + altgard : null)
}

/** A killed boss stays on the list, struck out, this long; then it fades out. */
export const KILLED_SHOWN_MS = 15_000
/** The list comes up by itself when more than 2 bosses spawn this close one after another. */
export const CLUSTER_GAP_MS = 10 * 60_000
export const CLUSTER_MIN = 3
/** A boss alive is listed while its spawn is within the look-ahead, or the map said so this recently. */
export const ALIVE_SEEN_MS = 30 * 60_000

export interface RunRow {
  run: BossRun
  /** When it spawns (or did); for a killed one, when it died. */
  at: number
  status: 'soon' | 'up' | 'killed'
}

/**
 * The list: each boss spawning within `windowMs`, or spawned within it (or read alive within
 * ALIVE_SEEN_MS) and not seen killed, or killed a moment ago: the alive ones first, then the
 * ones to spawn, each in spawn order.
 */
export function runRows(bosses: FieldBosses, now: number, windowMs: number): RunRow[] {
  const rows: RunRow[] = []
  for (const run of BOSS_RUNS) {
    const s = bosses[run.boss]
    if (!s) continue
    if (s.killedAt && now - s.killedAt < KILLED_SHOWN_MS) rows.push({ run, at: s.killedAt, status: 'killed' })
    else if (s.up) {
      if (now - (s.at || s.seen) <= windowMs || now - s.seen <= ALIVE_SEEN_MS) rows.push({ run, at: s.at || s.seen, status: 'up' })
    } else if (s.at > 0 && s.at - now <= windowMs && now - s.at <= windowMs) {
      rows.push({ run, at: s.at, status: s.at > now ? 'soon' : 'up' })
    }
  }
  // Alive (and just killed) first, then the ones still to spawn; each by when.
  const rank = (r: RunRow): number => (r.status === 'soon' ? 1 : 0)
  return rows.sort((a, b) => rank(a) - rank(b) || a.at - b.at)
}

/** How many on the list are alive (up, or due); the small ones left out if asked. */
export const aliveCount = (rows: RunRow[], ignoreSmall = false): number => rows.filter((r) => r.status === 'up' && !(ignoreSmall && r.run.small)).length

/** More than 2 of them spawning one after another, each within CLUSTER_GAP_MS of the one before. */
export function clustered(rows: RunRow[]): boolean {
  const ats = rows.filter((r) => r.status !== 'killed').map((r) => r.at)
  let run = 1
  for (let i = 1; i < ats.length; i++) {
    run = ats[i]! - ats[i - 1]! < CLUSTER_GAP_MS ? run + 1 : 1
    if (run >= CLUSTER_MIN) return true
  }
  return false
}
