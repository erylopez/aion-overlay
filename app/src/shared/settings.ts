/**
 * Persisted settings: typed, with defaults, and normalised at the IPC boundary so a hand-edited
 * file or a renderer bug can never store something the app then trips over.
 */

import { BOSS_RUNS, DEFAULT_LOW_PRIORITY } from './bossRuns.ts'
import type { Lang } from './i18n.ts'
import { DUMMY_DAMAGE_GOALS, DUMMY_LIMITS, type DummyGoal } from './dummy.ts'
import { isSound, type SoundId } from './sounds.ts'
import { TARGET_MODES, type MeterPlayers, type MeterStat, type TargetMode } from './meter.ts'
import { defaultShown, leadChoices, REGIONS, TIMERS, type Region, type TimerId } from './timers.ts'

export interface Point {
  x: number
  y: number
}

/** A part of the screen, in DIPs. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The most pets pinned at once: past it, a pin is refused (a bound for the saved list, not a
 * limit anyone farms into). */
export const MAX_PINNED = 250
/** The pinned pets the HUD lists: the rest are counted on a line below them. */
export const HUD_PINNED_ROWS = 15
/** The DPS meter's size limits, dragged by its corner: width and height, in DIPs. */
export const METER_WIDTH = [260, 900] as const
export const METER_HEIGHT = [120, 1200] as const
/** The map overlay's: its width, and its map's height. */
export const MINIMAP_WIDTH = [160, 900] as const
export const MINIMAP_HEIGHT = [120, 900] as const
/** The kill feed's size, dragged from its corner (never narrower than its title bar). */
export const KILLFEED_WIDTH = [240, 900] as const
export const KILLFEED_HEIGHT = [60, 900] as const
/** Boss Runs' size, as a scale of its 260 px: its corner drags it bigger, text and all. */
export const BOSSRUNS_SCALE = [0.75, 2.5] as const

export interface Settings {
  /** Where the floating icon sits, in screen DIPs; null = bottom right of the primary display. */
  bubble: Point | null
  /** The dashboard's size, and where it was left (null = the middle of the primary display). */
  panel: { width: number; height: number }
  panelPosition: Point | null
  /** Keep the panel above the game while it is open. */
  panelOnTop: boolean
  /** Minimise the panel when you click from it into the game, as a click outside closes a modal. */
  panelHideOnGame: boolean

  hud: {
    enabled: boolean
    /** Top-left in screen DIPs; null = top right of the primary display. */
    position: Point | null
    /** 'recent': pets that gained souls this session; 'pinned': the pets pinned in the panel. */
    mode: 'recent' | 'pinned'
    /** The Nearby section at the top: soul monsters around you, by the pet they drop. */
    nearby: boolean
    /** How many pets the Nearby section lists. */
    nearbyCount: number
    pinned: number[]
    /** How many recent pets 'recent' shows. */
    recentCount: number
    toasts: boolean
    opacity: number
    scale: number
    /** Hide the HUD when no game traffic has been seen for a while. */
    hideWithoutGame: boolean
    /**
     * Seconds without a kill, soul or crystal before the HUD clears itself and hides until the
     * next fight; 0 = never.
     */
    idleHideSeconds: number
    /** Pop up the Black Cloud Merchant's pets worth buying when one of its tabs is opened. */
    merchant: boolean
    /** This session's Kina per hour, at the top right. */
    kina: boolean
    /** Hidden Cubes in view at the top, with how far and which way. */
    cubes: boolean
    /** A sound when a Hidden Cube comes into view. */
    cubeSound: boolean
    /** Which one (shared/sounds.ts), and how loud (0-1). */
    cubeSoundId: SoundId
    cubeVolume: number
    /** The name of your own mp3, once one is chosen (the file is in the data folder). */
    cubeCustomName: string | null
  }

  /** The map overlay: your zone around you, your tracked pets' spawns and the Hidden Cubes. */
  /** `size` is its width; `height` the map's, dragged by the corner (null: square). */
  minimap: { enabled: boolean; position: Point | null; size: number; height: number | null; opacity: number; zoom: number; collapsed: boolean; gatherables: boolean }

  /** The Map page's switches, kept as they were left: what it shows besides the tracked pets. */
  mapPage: { needed: boolean; cubes: boolean; gatherables: boolean; hiddenPets: number[] }

  /**
   * Markers on the game's own map (Map page → "On the game's map"): the part of the screen where
   * you keep the game's map open, and what to draw on it once it is found there.
   */
  gameMap: {
    enabled: boolean
    /** In screen DIPs; null until picked. */
    region: Rect | null
    gatherables: boolean
    pets: boolean
    cubes: boolean
    enemies: boolean
    /** A border around the part of the screen watched, to see that it lies on the game's map. */
    showArea: boolean
  }

  /** Gatherables pinned on the Gatherables page: the maps show only these (all of them while none is). */
  gatherables: { pinned: string[] }

  /** Where the Black Cloud Merchant window sits (top-left, screen DIPs); null = top centre. */
  merchantWindow: Point | null
  /** Where the Details window (a fight's breakdown) sits; null = the middle of the screen. */
  detailsWindow: Point | null

  /** The timers' countdown bar over the game: on, where (null = top centre), how opaque. */
  timerBar: { enabled: boolean; position: Point | null; opacity: number }

  /**
   * Boss Runs (shared/bossRuns.ts): Verteron's field bosses about to spawn, with their Kibelisk,
   * up by itself when more than 2 spawn close together. How far ahead it looks (minutes), how
   * many it lists, minimized to its header, its size (a scale of its 260 px), how many alive at
   * once bring it up too (0: never), the bosses of low priority (list ids), and whether those are
   * left out of that count.
   */
  bossRuns: { enabled: boolean; position: Point | null; opacity: number; windowMinutes: number; rows: number; collapsed: boolean; scale: number; aliveMin: number; ignoreLow: boolean; lowPriority: number[] }

  /** The kill feed over the game: open (from the PvP page), and where (null = top right). */
  /**
   * The kill feed overlay; `opacity` is its background's (0: none, the text glows on the game); `target`: your target under it;
   * `width` and `height` as dragged from its corner (null: sized to what it shows).
   */
  killFeed: { open: boolean; position: Point | null; opacity: number; collapsed: boolean; target: boolean; width: number | null; height: number | null }
  /**
   * The Enemies overlay: players of the other faction in view, and a sound when one comes. Its
   * background's opacity (0: none), minimized, and its sound: on, which (shared/sounds.ts), how
   * loud (0-1), your own mp3's name.
   */
  enemies: {
    enabled: boolean
    position: Point | null
    opacity: number
    collapsed: boolean
    /** Their pins on the map overlay. */
    mapPins: boolean
    sound: boolean
    /** The sound only for enemies with their PvP on. */
    pvpOnly: boolean
    soundId: SoundId
    volume: number
    customName: string | null
  }

  /**
   * Your buffs and debuffs over the game: each one's icon, stacks and time left (A2Tools DPS
   * Meter's buff timeline). Icons `size` px, `perRow` to a row; debuffs on a row of their own.
   * `cc`: the CC / Debuffs panel, a banner mid-screen while you are stunned, rooted, knocked down...
   * (with the monsters' other debuffs on you under it, `ccDebuffs`); where it sits, `ccPosition`.
   */
  buffs: {
    enabled: boolean
    position: Point | null
    opacity: number
    size: number
    perRow: number
    debuffs: boolean
    passives: boolean
    /** Scrolls, food and drinks: long buffs from items, hidden unless wanted. */
    consumables: boolean
    cc: boolean
    ccPosition: Point | null
    ccDebuffs: boolean
  }

  /**
   * Training dummy runs: their goal (a time limit, or damage), whether a run starts by itself with
   * your first hit on a dummy (and its clock with it), and the Training overlay over the game.
   */
  dummy: { overlay: boolean; position: Point | null; autoStart: boolean; goal: DummyGoal; limitMs: number | null; damageGoal: number; collapsed: boolean }

  /** Your own skills on the meter's target, as a window of their own. */
  skills: { enabled: boolean; position: Point | null; rows: number; opacity: number }

  /** The DPS meter: its own window, fed by the engine (A2Tools DPS Meter's parser). */
  meter: {
    enabled: boolean
    /** Top-left in screen DIPs; null = left of the primary display. */
    position: Point | null
    /** Which target it follows. */
    targetMode: TargetMode
    /** Which players it lists, and what it ranks them by. */
    players: MeterPlayers
    stat: MeterStat
    /** How many players it lists. */
    rows: number
    opacity: number
    /** Shrunk to its title line (the minimize button). */
    collapsed: boolean
    /** Its size, dragged by its corner: the width, and the height (null: as tall as its rows). */
    width: number
    height: number | null
    /** Hidden while no damage (or healing, or damage taken) has come in for `idleSeconds`. */
    hideIdle: boolean
    idleSeconds: number
  }

  /** Hide every overlay window from screenshots, OBS and Discord (WDA_EXCLUDEFROMCAPTURE). */
  hideFromCapture: boolean

  /** The app's language (shared/i18n.ts): Spanish unless changed. */
  language: Lang

  /** Your side: its zones are listed first where a soul drops. */
  faction: 'elyos' | 'asmodians'
  /** Your level, to point out monsters close enough to it for souls to drop well; null = unset. */
  playerLevel: number | null

  /** Event Alerts and Field Bosses: which events alert, and how (a chime; the bubble shaking). */
  timers: {
    /** The server region: weekly events are at its own local time. */
    region: Region
    enabled: Record<TimerId, boolean>
    /** Minutes before each start to alert. */
    lead: Record<TimerId, number>
    sound: boolean
    /** 0..1 */
    volume: number
    shake: boolean
    /** Listed in the Event Alerts and Field Bosses pages; only these alert. */
    shown: Record<TimerId, boolean>
  }

  /** Leave pets at the cap (Lv3: no more souls) out of the collection, Nearby and the HUD. */
  hideMaxed: boolean

  /**
   * While Aion 2 is not running: no bubble, no HUD, no capture, only the tray icon. Everything
   * comes back when the game starts.
   */
  sleepWithoutGame: boolean

  /**
   * Hide every overlay while another program is in front (an alt-tab to Discord), and show them
   * again when the game is. The overlay's own panel, clicked into, counts as the game.
   */
  hideWhenGameAway: boolean

  /**
   * Sync the field bosses to the Lokthar site's timers (main/lokthar.ts): off until turned on with
   * a token. Besides the update check (Settings → Updates, by hand), NCSoft's character pages and
   * the guild events below, the only requests the app makes: to `url` alone.
   */
  lokthar: {
    sync: boolean
    /** The site, e.g. https://lokthar.com: https only (http for localhost, to test against a dev server). */
    url: string
    /** From the site: bin/rails 'overlay:token[you]'. */
    token: string
  }

  /**
   * Guild events from the Lokthar site (main/guildEvents.ts, at lokthar.url): the events that ask
   * who comes, answered here; on, it sends the site your characters' names and servers to know you
   * by. `popup`: an event to answer pops up over the game, bottom right.
   */
  guildEvents: { enabled: boolean; popup: boolean }

  tracker: {
    /** The collection file; empty = <userData>/collection.json. */
    dataFile: string
  }
}

export type SettingKey = keyof Settings

export const SETTINGS_DEFAULTS: Settings = {
  bubble: null,
  panel: { width: 1100, height: 720 },
  panelPosition: null,
  panelOnTop: true,
  panelHideOnGame: true,
  hud: {
    enabled: true,
    position: null,
    mode: 'recent',
    nearby: true,
    nearbyCount: 3,
    pinned: [],
    recentCount: 3,
    toasts: true,
    opacity: 0.92,
    scale: 1,
    hideWithoutGame: true,
    idleHideSeconds: 45,
    merchant: true,
    kina: true,
    cubes: true,
    cubeSound: true,
    cubeSoundId: 'chime',
    cubeVolume: 0.6,
    cubeCustomName: null,
  },
  minimap: { enabled: true, position: null, size: 260, height: null, opacity: 0.92, zoom: 6, collapsed: false, gatherables: false },
  mapPage: { needed: false, cubes: true, gatherables: false, hiddenPets: [] },
  gatherables: { pinned: [] },
  gameMap: { enabled: false, region: null, gatherables: true, pets: true, cubes: true, enemies: true, showArea: false },
  merchantWindow: null,
  detailsWindow: null,
  timerBar: { enabled: true, position: null, opacity: 0.92 },
  bossRuns: { enabled: true, position: null, opacity: 0.85, windowMinutes: 15, rows: 5, collapsed: false, scale: 1, aliveMin: 0, ignoreLow: true, lowPriority: DEFAULT_LOW_PRIORITY },
  killFeed: { open: false, position: null, opacity: 0.9, collapsed: false, target: true, width: null, height: null },
  enemies: { enabled: true, position: null, opacity: 0.75, collapsed: false, mapPins: true, sound: true, pvpOnly: true, soundId: 'enemy-spotted', volume: 0.7, customName: null },
  skills: { enabled: true, position: null, rows: 6, opacity: 0.92 },
  dummy: { overlay: true, position: null, autoStart: true, goal: 'time', limitMs: 60_000, damageGoal: 10e6, collapsed: false },
  buffs: { enabled: true, position: null, opacity: 0.92, size: 34, perRow: 10, debuffs: true, passives: false, consumables: false, cc: true, ccPosition: null, ccDebuffs: false },
  meter: { enabled: true, position: null, targetMode: 'bossTargets', players: 'party', stat: 'damage', rows: 8, opacity: 0.92, collapsed: false, width: 340, height: null, hideIdle: false, idleSeconds: 15 },
  hideFromCapture: false,
  language: 'es',
  faction: 'elyos',
  playerLevel: null,
  hideMaxed: true,
  timers: {
    region: 'south-america',
    enabled: Object.fromEntries(TIMERS.map((t) => [t.id, t.defaultOn])) as Record<TimerId, boolean>,
    lead: Object.fromEntries(TIMERS.map((t) => [t.id, t.lead])) as Record<TimerId, number>,
    sound: true,
    volume: 0.5,
    shake: true,
    shown: Object.fromEntries(TIMERS.map((t) => [t.id, defaultShown(t)])) as Record<TimerId, boolean>,
  },
  sleepWithoutGame: true,
  hideWhenGameAway: true,
  lokthar: { sync: false, url: 'https://lokthar.com', token: '' },
  guildEvents: { enabled: true, popup: true },
  tracker: { dataFile: '' },
}

const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)

const point = (v: unknown): Point | null => {
  const p = v as Partial<Point> | null
  return p && typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)
    ? { x: Math.round(p.x), y: Math.round(p.y) }
    : null
}

const rect = (v: unknown): Rect | null => {
  const r = v as Partial<Rect> | null
  const ok = r && [r.x, r.y, r.width, r.height].every((n) => typeof n === 'number' && Number.isFinite(n)) && r.width! >= 40 && r.height! >= 40
  return ok ? { x: Math.round(r.x!), y: Math.round(r.y!), width: Math.round(r.width!), height: Math.round(r.height!) } : null
}

/** Coerce one setting to a valid value, falling back to the default for anything malformed. */
export function normalise<K extends SettingKey>(key: K, value: unknown): Settings[K] {
  const d = SETTINGS_DEFAULTS
  switch (key) {
    case 'bubble':
    case 'merchantWindow':
    case 'detailsWindow':
    case 'panelPosition':
      return point(value) as Settings[K]
    case 'panel': {
      const v = (value ?? {}) as Partial<Settings['panel']>
      return { width: num(v.width, 900, 3840, d.panel.width), height: num(v.height, 600, 2160, d.panel.height) } as Settings[K]
    }
    case 'panelOnTop':
    case 'panelHideOnGame':
    case 'hideFromCapture':
    case 'hideMaxed':
    case 'sleepWithoutGame':
    case 'hideWhenGameAway':
      return bool(value, d[key] as boolean) as Settings[K]
    case 'hud': {
      const v = (value ?? {}) as Partial<Settings['hud']>
      return {
        enabled: bool(v.enabled, d.hud.enabled),
        position: point(v.position),
        // 'nearby' was a mode before it became its own section (0.1.3).
        mode: v.mode === 'pinned' ? 'pinned' : 'recent',
        nearby: bool(v.nearby, d.hud.nearby),
        nearbyCount: Math.round(num(v.nearbyCount, 1, 8, d.hud.nearbyCount)),
        pinned: Array.isArray(v.pinned) ? [...new Set(v.pinned.filter((n) => Number.isInteger(n)))].slice(0, MAX_PINNED) : [],
        recentCount: Math.round(num(v.recentCount, 1, 8, d.hud.recentCount)),
        toasts: bool(v.toasts, d.hud.toasts),
        opacity: num(v.opacity, 0.3, 1, d.hud.opacity),
        scale: num(v.scale, 0.75, 1.75, d.hud.scale),
        hideWithoutGame: bool(v.hideWithoutGame, d.hud.hideWithoutGame),
        idleHideSeconds: Math.round(num(v.idleHideSeconds, 0, 600, d.hud.idleHideSeconds)),
        merchant: bool(v.merchant, d.hud.merchant),
        kina: bool(v.kina, d.hud.kina),
        cubes: bool(v.cubes, d.hud.cubes),
        cubeSound: bool(v.cubeSound, d.hud.cubeSound),
        cubeSoundId: isSound(v.cubeSoundId) ? v.cubeSoundId : d.hud.cubeSoundId,
        cubeVolume: num(v.cubeVolume, 0, 1, d.hud.cubeVolume),
        cubeCustomName: typeof v.cubeCustomName === 'string' && v.cubeCustomName ? v.cubeCustomName.slice(0, 200) : null,
      } as Settings[K]
    }
    case 'timers': {
      const v = (value ?? {}) as Partial<Settings['timers']>
      const on = (v.enabled ?? {}) as Partial<Record<TimerId, unknown>>
      const lead = (v.lead ?? {}) as Partial<Record<TimerId, unknown>>
      return {
        region: REGIONS.some((r) => r.id === v.region) ? v.region : d.timers.region,
        enabled: Object.fromEntries(TIMERS.map((t) => [t.id, bool(on[t.id], t.defaultOn)])) as Record<TimerId, boolean>,
        // One of the leads offered for that timer; anything else falls back to its default.
        lead: Object.fromEntries(
          TIMERS.map((t) => [t.id, leadChoices(t).includes(lead[t.id] as number) ? (lead[t.id] as number) : t.lead]),
        ) as Record<TimerId, number>,
        sound: bool(v.sound, d.timers.sound),
        volume: num(v.volume, 0, 1, d.timers.volume),
        shake: bool(v.shake, d.timers.shake),
        shown: Object.fromEntries(
          TIMERS.map((t) => [t.id, bool((v.shown as Partial<Record<TimerId, unknown>> | undefined)?.[t.id], defaultShown(t))]),
        ) as Record<TimerId, boolean>,
      } as Settings[K]
    }
    case 'minimap': {
      const v = (value ?? {}) as Partial<Settings['minimap']>
      return {
        enabled: bool(v.enabled, d.minimap.enabled),
        position: point(v.position),
        size: Math.round(num(v.size, MINIMAP_WIDTH[0], MINIMAP_WIDTH[1], d.minimap.size)),
        height: v.height === null || v.height === undefined ? null : Math.round(num(v.height, MINIMAP_HEIGHT[0], MINIMAP_HEIGHT[1], d.minimap.size)),
        opacity: num(v.opacity, 0.3, 1, d.minimap.opacity),
        zoom: num(v.zoom, 1, 40, d.minimap.zoom),
        collapsed: bool(v.collapsed, false),
        gatherables: bool(v.gatherables, d.minimap.gatherables),
      } as Settings[K]
    }
    case 'mapPage': {
      const v = (value ?? {}) as Partial<Settings['mapPage']>
      return {
        needed: bool(v.needed, d.mapPage.needed),
        cubes: bool(v.cubes, d.mapPage.cubes),
        gatherables: bool(v.gatherables, d.mapPage.gatherables),
        hiddenPets: Array.isArray(v.hiddenPets) ? [...new Set(v.hiddenPets.filter((n) => Number.isInteger(n)))].slice(0, MAX_PINNED) : [],
      } as Settings[K]
    }
    case 'gameMap': {
      const v = (value ?? {}) as Partial<Settings['gameMap']>
      return {
        enabled: bool(v.enabled, d.gameMap.enabled),
        region: rect(v.region),
        gatherables: bool(v.gatherables, d.gameMap.gatherables),
        pets: bool(v.pets, d.gameMap.pets),
        cubes: bool(v.cubes, d.gameMap.cubes),
        enemies: bool(v.enemies, d.gameMap.enemies),
        showArea: bool(v.showArea, d.gameMap.showArea),
      } as Settings[K]
    }
    case 'gatherables': {
      const v = (value ?? {}) as Partial<Settings['gatherables']>
      return {
        pinned: Array.isArray(v.pinned) ? [...new Set(v.pinned.filter((id) => typeof id === 'string' && /^[a-z0-9-]{1,40}$/.test(id)))].slice(0, 100) : [],
      } as Settings[K]
    }
    case 'timerBar': {
      const v = (value ?? {}) as Partial<Settings['timerBar']>
      return {
        enabled: bool(v.enabled, d.timerBar.enabled),
        position: point(v.position),
        opacity: num(v.opacity, 0.3, 1, d.timerBar.opacity),
      } as Settings[K]
    }
    case 'bossRuns': {
      const v = (value ?? {}) as Partial<Settings['bossRuns']>
      return {
        enabled: bool(v.enabled, d.bossRuns.enabled),
        position: point(v.position),
        opacity: num(v.opacity, 0, 1, d.bossRuns.opacity),
        windowMinutes: Math.round(num(v.windowMinutes, 5, 60, d.bossRuns.windowMinutes)),
        rows: Math.round(num(v.rows, 1, 10, d.bossRuns.rows)),
        collapsed: bool(v.collapsed, false),
        scale: num(v.scale, BOSSRUNS_SCALE[0], BOSSRUNS_SCALE[1], d.bossRuns.scale),
        aliveMin: Math.round(num(v.aliveMin, 0, 10, d.bossRuns.aliveMin)),
        ignoreLow: bool(v.ignoreLow, d.bossRuns.ignoreLow),
        lowPriority: Array.isArray(v.lowPriority) ? [...new Set(v.lowPriority.filter((id) => BOSS_RUNS.some((r) => r.boss === id)))] : [...d.bossRuns.lowPriority],
      } as Settings[K]
    }
    case 'enemies': {
      const v = (value ?? {}) as Partial<Settings['enemies']>
      return {
        enabled: bool(v.enabled, d.enemies.enabled),
        position: point(v.position),
        opacity: num(v.opacity, 0, 1, d.enemies.opacity),
        collapsed: bool(v.collapsed, d.enemies.collapsed),
        mapPins: bool(v.mapPins, d.enemies.mapPins),
        sound: bool(v.sound, d.enemies.sound),
        pvpOnly: bool(v.pvpOnly, d.enemies.pvpOnly),
        soundId: isSound(v.soundId) ? v.soundId : d.enemies.soundId,
        volume: num(v.volume, 0, 1, d.enemies.volume),
        customName: typeof v.customName === 'string' && v.customName ? v.customName.slice(0, 200) : null,
      } as Settings[K]
    }
    case 'killFeed': {
      const v = (value ?? {}) as Partial<Settings['killFeed']>
      return {
        open: bool(v.open, d.killFeed.open),
        position: point(v.position),
        opacity: num(v.opacity, 0, 1, d.killFeed.opacity),
        collapsed: bool(v.collapsed, d.killFeed.collapsed),
        target: bool(v.target, d.killFeed.target),
        width: v.width === null || v.width === undefined ? null : Math.round(num(v.width, KILLFEED_WIDTH[0], KILLFEED_WIDTH[1], 300)),
        height: v.height === null || v.height === undefined ? null : Math.round(num(v.height, KILLFEED_HEIGHT[0], KILLFEED_HEIGHT[1], 200)),
      } as Settings[K]
    }
    case 'skills': {
      const v = (value ?? {}) as Partial<Settings['skills']>
      return {
        enabled: bool(v.enabled, d.skills.enabled),
        position: point(v.position),
        rows: Math.round(num(v.rows, 1, 20, d.skills.rows)),
        opacity: num(v.opacity, 0.3, 1, d.skills.opacity),
      } as Settings[K]
    }
    case 'buffs': {
      const v = (value ?? {}) as Partial<Settings['buffs']>
      return {
        enabled: bool(v.enabled, d.buffs.enabled),
        position: point(v.position),
        opacity: num(v.opacity, 0.3, 1, d.buffs.opacity),
        size: Math.round(num(v.size, 22, 56, d.buffs.size)),
        perRow: Math.round(num(v.perRow, 4, 20, d.buffs.perRow)),
        debuffs: bool(v.debuffs, d.buffs.debuffs),
        passives: bool(v.passives, d.buffs.passives),
        consumables: bool(v.consumables, d.buffs.consumables),
        cc: bool(v.cc, d.buffs.cc),
        ccPosition: point(v.ccPosition),
        ccDebuffs: bool(v.ccDebuffs, d.buffs.ccDebuffs),
      } as Settings[K]
    }
    case 'dummy': {
      const v = (value ?? {}) as Partial<Settings['dummy']>
      return {
        overlay: bool(v.overlay, d.dummy.overlay),
        position: point(v.position),
        autoStart: bool(v.autoStart, d.dummy.autoStart),
        goal: v.goal === 'damage' ? 'damage' : 'time',
        limitMs: v.limitMs === null || DUMMY_LIMITS.some((l) => l.id === v.limitMs) ? (v.limitMs ?? null) : d.dummy.limitMs,
        damageGoal: DUMMY_DAMAGE_GOALS.includes(v.damageGoal as number) ? (v.damageGoal as number) : d.dummy.damageGoal,
        collapsed: bool(v.collapsed, false),
      } as Settings[K]
    }
    case 'meter': {
      const v = (value ?? {}) as Partial<Settings['meter']>
      return {
        enabled: bool(v.enabled, d.meter.enabled),
        position: point(v.position),
        targetMode: (TARGET_MODES as readonly unknown[]).includes(v.targetMode) ? v.targetMode : d.meter.targetMode,
        players: v.players === 'me' || v.players === 'all' ? v.players : 'party',
        stat: v.stat === 'healing' || v.stat === 'taken' ? v.stat : 'damage',
        rows: Math.round(num(v.rows, 1, 24, d.meter.rows)),
        opacity: num(v.opacity, 0.3, 1, d.meter.opacity),
        collapsed: bool(v.collapsed, false),
        width: Math.round(num(v.width, METER_WIDTH[0], METER_WIDTH[1], d.meter.width)),
        height: v.height === null || v.height === undefined ? null : Math.round(num(v.height, METER_HEIGHT[0], METER_HEIGHT[1], METER_HEIGHT[0])),
        hideIdle: bool(v.hideIdle, d.meter.hideIdle),
        idleSeconds: Math.round(num(v.idleSeconds, 5, 300, d.meter.idleSeconds)),
      } as Settings[K]
    }
    case 'language':
      return (value === 'en' ? 'en' : 'es') as Settings[K]
    case 'faction':
      return (value === 'asmodians' ? 'asmodians' : 'elyos') as Settings[K]
    case 'playerLevel':
      return (typeof value === 'number' && Number.isFinite(value) ? Math.round(num(value, 1, 99, 1)) : null) as Settings[K]
    case 'guildEvents': {
      const v = (value ?? {}) as Partial<Settings['guildEvents']>
      return { enabled: bool(v.enabled, d.guildEvents.enabled), popup: bool(v.popup, d.guildEvents.popup) } as Settings[K]
    }
    case 'lokthar': {
      const v = (value ?? {}) as Partial<Settings['lokthar']>
      return {
        sync: bool(v.sync, d.lokthar.sync),
        url: typeof v.url === 'string' && v.url.trim() ? v.url.trim().replace(/\/+$/, '') : d.lokthar.url,
        token: typeof v.token === 'string' ? v.token.trim() : '',
      } as Settings[K]
    }
    case 'tracker': {
      const v = (value ?? {}) as Partial<Settings['tracker']>
      return {
        dataFile: typeof v.dataFile === 'string' ? v.dataFile.trim() : '',
      } as Settings[K]
    }
  }
  return d[key]
}
