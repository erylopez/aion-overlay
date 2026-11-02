/**
 * What the engine's tracker (engine/src/tracker) tells the app, and what the app keeps of it.
 * The wire format is documented in engine/src/sidecar.rs; these types mirror it.
 */

/** One pet of the collection, as the sidecar reports it. */
export interface Pet {
  id: number
  /** The monster it belongs to; null until learned from a kill or named by hand. */
  name: string | null
  souls: number
  level: number
  /** True when the level was worked out from the souls rather than sent by the server. */
  levelEstimated: boolean
  /** Genus crystals collected since the pet reached the cap (counted by the tracker this way). */
  crystals: number
  /** Souls gained since the tracker started. */
  session: number
}

export type TrackerState =
  | 'starting' // the sidecar is being launched
  | 'listening' // capturing, the game connection not found yet
  | 'locked' // reading the game connection
  | 'idle' // not capturing: the game is closed
  | 'stopped' // the capture ended (a replay finished)
  | 'error' // the sidecar reported an error, or could not be started
  | 'exited' // the sidecar process ended

export interface TrackerStatus {
  state: TrackerState
  detail: string | null
  /** Seconds since the last game packet, or null if none was ever seen. */
  lastPacketAgo: number | null
  /** Game traffic seen within GAME_ACTIVE_S. */
  gameActive: boolean
  /** The sidecar is replaying a capture rather than watching the game. */
  replay: boolean
  /** The last login sync: when, how many pets, how many souls. */
  synced: { at: number; pets: number; souls: number } | null
  /** Where the collection is saved. */
  dataFile: string | null
  /** The character playing; null until seen. */
  character: string | null
  /** That character's game server (Kaisinel 1104): the collection is that server's. Null until seen. */
  server: number | null
  /** That character's level, from the game's record of you; null until read. */
  level: number | null
  /** Npcap is not installed: nothing can be captured until it is (Home asks for it). */
  npcapMissing: boolean
}

/** What is loaded around you, from the tracker: monsters by code, your zone and position. */
export interface Nearby {
  /** The zone (questlog.gg world id), from the last zone load; null until one is seen. */
  world: number | null
  /** Where you are, in the map data's coordinates; from zone loads, teleports and your casts. */
  position: [number, number] | null
  /** When the position last changed (ms since epoch, stamped by main); null while unknown. */
  positionAt: number | null
  monsters: { npc: number; count: number }[]
}

export const NO_NEARBY: Nearby = { world: null, position: null, positionAt: null, monsters: [] }

/** Can attack you: PvP on, or anyone in the Abyss (where they stand, or the zone you are in), where everyone fights. */
export const canAttack = (e: Enemy, abyss = false): boolean => abyss || !!e.pvp || !!e.openPvp

/** A pet the collection has no record of yet (seen nearby, or opened from the map). */
export const blankPet = (id: number): Pet => ({ id, name: null, souls: 0, level: 0, levelEstimated: true, crystals: 0, session: 0 })

/** A player of the other faction in view (the engine's list: in when they load, out when gone). */
export interface Enemy {
  entity: number
  name: string
  server: number | null
  legion: string | null
  /** Their PvP is on: they can attack you, and you them (absent from an engine before 0.3.6). */
  pvp?: boolean
  /** Where they stand everyone can fight, PvP on or off (the Abyss): every one of them is a threat. */
  openPvp?: boolean
  /** From their player card (the game sends it now and then: a target, a fight), when one was read. */
  level?: number | null
  gearScore?: number | null
  combatPower?: number | null
  className?: string | null
  /** Where they were last seen, in the map data's (x, -y), as Nearby gives yours. */
  position?: [number, number] | null
}

/** The player you last targeted: their sheet as the game sends it (`50 36`). */
export interface TargetPlayer {
  name: string
  server: number
  level: number
  gearScore: number
  /** Null when no believable value was read (out of range, or an odd jump not yet confirmed). */
  combatPower: number | null
  className: string | null
  legion: string | null
  /** Of the other faction. */
  enemy: boolean
  /** When it was targeted (ms since epoch). */
  at: number
}

/** A Hidden Cube in view (the server sends one within about 100 m of you). */
export interface Cube {
  id: number
  template: number
  /** Where it is, in the map data's (x, -y), as Nearby gives yours. */
  position: [number, number]
  height: number
  /** When it spawned (ms since epoch), as its record says; null when it does not. */
  createdAt: number | null
  /** When the app first heard of it (ms since epoch). */
  seenAt: number
}

/** A player killed by a player around you, as the game credits it (the killing blow). */
export interface PvpKill {
  at: number
  /**
   * `className` when a player card or target info named it (shared/tracker.ts Enemy); `combatPower`
   * when their spawn, card or target info gave it.
   */
  killer: { name: string; server: number; guild: string | null; className?: string | null; combatPower?: number | null }
  /** Null when the victim was never in view (no name to give). */
  victim: { name: string; server: number | null; guild?: string | null; className?: string | null; combatPower?: number | null } | null
  /** You were the killer. */
  mine: boolean
  /** You were the victim. */
  died: boolean
  /** Your legion was the killer's or the victim's (you included). */
  legion: boolean
  /**
   * A kill you took part in (yours, your death, or one of a player you were fighting): the fight's
   * id, to open in Details. Null when no hits between you were seen.
   */
  fight?: string | null
  /** Your death: where you were (your zone, and your last known place in it), when known. */
  place?: { world: number; position: [number, number] } | null
}

/** Your last death whose place is known (the kill feed's skull, and the maps'). */
export function lastDeath(kills: PvpKill[]): (PvpKill & { place: NonNullable<PvpKill['place']> }) | null {
  for (let i = kills.length - 1; i >= 0; i--) {
    const k = kills[i]!
    if (k.died) return k.place ? (k as PvpKill & { place: NonNullable<PvpKill['place']> }) : null
  }
  return null
}

/** A soul as the HUD toasts it. */
export interface SoulToast {
  pet: Pet
  amount: number
  at: number
  /** This soul took the pet to its next level. */
  levelUp: boolean
  /** The pet is capped: this was a genus crystal (its own message, `11 90`), not a soul. */
  crystal: boolean
}

/** Without game packets for this long, the game is taken to be closed (or at character select). */
export const GAME_ACTIVE_S = 15

/** Pet Insight caps at level 3 on the global version. */
export const MAX_LEVEL = 3

/**
 * Souls to go from Lv0 to 1, 1 to 2 and 2 to 3. The count restarts at 0 on each level-up, which
 * is the number the Pets menu shows; at MAX_LEVEL souls stop and genus crystals take over.
 */
export const LEVEL_NEED = [5, 25, 75] as const

/** Souls all the levels below this one took: 0, 5, 30. */
const LEVEL_BEFORE = [0, 5, 30] as const

/** The souls the current level needs, or null once capped. */
export function nextLevelSouls(pet: Pick<Pet, 'level' | 'souls'>): number | null {
  return pet.level >= MAX_LEVEL ? null : (LEVEL_NEED[pet.level] ?? null)
}

/** 0..1 of the way to the cap: the 105 souls of every level together. */
export function capProgress(pet: Pick<Pet, 'souls' | 'level'>): number {
  if (pet.level >= MAX_LEVEL) return 1
  const done = (LEVEL_BEFORE[pet.level] ?? 0) + pet.souls
  return Math.min(1, done / 105)
}

/** One item in the Black Cloud Merchant's stock, as the tab's `91 56` record gives it. */
export interface ShopItem {
  slot: number
  /** The game's item id (questlog.gg's): see renderer/src/data/petItems.json for the pet ones. */
  item: number
  quantity: number
  currency: number
  base: number
  price: number
}

/** One tab of the merchant's stock, from the last time it was opened. */
export interface ShopStock {
  tab: number
  /** When the stock changes next (ms since epoch); null if the record did not say. */
  nextAt: number | null
  /** When the tab was opened (ms since epoch, stamped by main). */
  at: number
  items: ShopItem[]
}
