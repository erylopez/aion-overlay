/**
 * Gatherable resources (ores, gemstones, logs, plants): where each one is, by zone, and its icon.
 * The data is a snapshot of Lokthar's site map (scripts/import-gatherables.mjs), in the game's
 * coordinates like the pets' spawns; only Verteron and Altgard have any so far.
 */
import { shallowRef } from 'vue'

export type GatherKind = 'ore' | 'gem' | 'log' | 'plant'
export const GATHER_KINDS: { id: GatherKind; label: string }[] = [
  { id: 'ore', label: 'Ores' },
  { id: 'gem', label: 'Gemstones' },
  { id: 'log', label: 'Logs' },
  { id: 'plant', label: 'Plants' },
]

export interface Gatherable {
  /** A slug of its name: "orichalcum-ore". */
  id: string
  name: string
  kind: GatherKind
  /** Relative to index.html: "gather/orichalcum-ore.webp". */
  icon: string
  /** By zone (questlog.gg world id): every place it grows or can be mined. */
  zones: Record<string, [number, number][]>
}

export interface GatherData {
  source: string
  imported: string
  types: Gatherable[]
}

let loading: Promise<GatherData> | null = null
const shared = shallowRef<GatherData | null>(null)

/** The gatherables as a ref, loaded on first use and shared by every component. */
export function useGatherables(): typeof shared {
  loading ??= fetch('maps/gatherables.json').then((r) => {
    if (!r.ok) throw new Error(`maps/gatherables.json: HTTP ${r.status}`)
    return r.json() as Promise<GatherData>
  })
  if (!shared.value) void loading.then((d) => (shared.value = d))
  return shared
}

/** A map layer of icons: one gatherable's places in one zone. */
export interface IconLayer {
  key: string
  icon: string
  name: string
  points: [number, number][]
}

/**
 * The icon layers to draw in `world`: the pinned gatherables, or every one when none is pinned.
 */
export function gatherLayers(data: GatherData | null, world: number | null, pinned: string[]): IconLayer[] {
  if (!data || world === null) return []
  const shown = pinned.length ? data.types.filter((g) => pinned.includes(g.id)) : data.types
  return shown.flatMap((g) => {
    const points = g.zones[world]
    return points ? [{ key: g.id, icon: g.icon, name: g.name, points }] : []
  })
}
