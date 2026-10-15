/**
 * Persisted settings: typed, with defaults, and normalised at the IPC boundary so a hand-edited
 * file or a renderer bug can never store something the app then trips over.
 */

import { defaultShown, leadChoices, REGIONS, TIMERS, type Region, type TimerId } from './timers.ts'

export interface Point {
  x: number
  y: number
}

export interface Settings {
  /** Where the floating icon sits, in screen DIPs; null = bottom right of the primary display. */
  bubble: Point | null
  /** Panel size; its position follows the bubble. */
  panel: { width: number; height: number }
  /** Keep the panel above the game while it is open. */
  panelOnTop: boolean

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
  }

  /** Where the Black Cloud Merchant window sits (top-left, screen DIPs); null = top centre. */
  merchantWindow: Point | null

  /** Hide every overlay window from screenshots, OBS and Discord (WDA_EXCLUDEFROMCAPTURE). */
  hideFromCapture: boolean

  /** Your side: its zones are listed first where a soul drops. */
  faction: 'elyos' | 'asmodians'
  /** Your level, to point out monsters close enough to it for souls to drop well; null = unset. */
  playerLevel: number | null

  /** The Timers tab: which events alert, and how (a chime; the bubble shaking). */
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
    /** Listed in the Timers tab; only these alert. */
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
   * Sync the field bosses to the Lokthar site's timers (main/lokthar.ts): off until turned on with
   * a token. The only network request the app makes, to `url` alone.
   */
  lokthar: {
    sync: boolean
    /** The site, e.g. https://lokthar.com: https only (http for localhost, to test against a dev server). */
    url: string
    /** From the site: bin/rails 'overlay:token[you]'. */
    token: string
  }

  tracker: {
    /** The Python interpreter; empty = the repo's .venv. */
    python: string
    /** The collection file; empty = <userData>/collection.json. */
    dataFile: string
  }
}

export type SettingKey = keyof Settings

export const SETTINGS_DEFAULTS: Settings = {
  bubble: null,
  panel: { width: 420, height: 560 },
  panelOnTop: true,
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
  },
  merchantWindow: null,
  hideFromCapture: false,
  faction: 'elyos',
  playerLevel: null,
  hideMaxed: true,
  timers: {
    region: 'na-east',
    enabled: Object.fromEntries(TIMERS.map((t) => [t.id, t.defaultOn])) as Record<TimerId, boolean>,
    lead: Object.fromEntries(TIMERS.map((t) => [t.id, t.lead])) as Record<TimerId, number>,
    sound: true,
    volume: 0.5,
    shake: true,
    shown: Object.fromEntries(TIMERS.map((t) => [t.id, defaultShown(t)])) as Record<TimerId, boolean>,
  },
  sleepWithoutGame: true,
  lokthar: { sync: false, url: 'https://lokthar.com', token: '' },
  tracker: { python: '', dataFile: '' },
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

/** Coerce one setting to a valid value, falling back to the default for anything malformed. */
export function normalise<K extends SettingKey>(key: K, value: unknown): Settings[K] {
  const d = SETTINGS_DEFAULTS
  switch (key) {
    case 'bubble':
    case 'merchantWindow':
      return point(value) as Settings[K]
    case 'panel': {
      const v = (value ?? {}) as Partial<Settings['panel']>
      return { width: num(v.width, 340, 1200, d.panel.width), height: num(v.height, 360, 1400, d.panel.height) } as Settings[K]
    }
    case 'panelOnTop':
    case 'hideFromCapture':
    case 'hideMaxed':
    case 'sleepWithoutGame':
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
        pinned: Array.isArray(v.pinned) ? [...new Set(v.pinned.filter((n) => Number.isInteger(n)))].slice(0, 12) : [],
        recentCount: Math.round(num(v.recentCount, 1, 8, d.hud.recentCount)),
        toasts: bool(v.toasts, d.hud.toasts),
        opacity: num(v.opacity, 0.3, 1, d.hud.opacity),
        scale: num(v.scale, 0.75, 1.75, d.hud.scale),
        hideWithoutGame: bool(v.hideWithoutGame, d.hud.hideWithoutGame),
        idleHideSeconds: Math.round(num(v.idleHideSeconds, 0, 600, d.hud.idleHideSeconds)),
        merchant: bool(v.merchant, d.hud.merchant),
        kina: bool(v.kina, d.hud.kina),
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
    case 'faction':
      return (value === 'asmodians' ? 'asmodians' : 'elyos') as Settings[K]
    case 'playerLevel':
      return (typeof value === 'number' && Number.isFinite(value) ? Math.round(num(value, 1, 99, 1)) : null) as Settings[K]
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
        python: typeof v.python === 'string' ? v.python.trim() : '',
        dataFile: typeof v.dataFile === 'string' ? v.dataFile.trim() : '',
      } as Settings[K]
    }
  }
  return d[key]
}
