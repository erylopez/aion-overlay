<script setup lang="ts">
// The map overlay: your zone around you, following you, with the spawns of your tracked pets (the
// ones pinned in the collection, and those whose soul monsters are around you), and the Hidden
// Cubes in view as golden cubes. Moved by its header; the wheel or the +/- buttons zoom (remembered); dragging the map
// looks around, and it follows you again a few seconds later (or at once, with the circle between them).
// Always shown while it is on: it keeps the last zone it knew (the zone a tracker started mid-session
// guesses from the monsters around you, gone when you fly up), and says so while it knows none.
// The minimize button shrinks it to its header (the zone and the cubes in view). Its bottom-right
// corner resizes it (a double-click there makes it the default square again); hovering the map shows
// a slider for its opacity.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CloseButton from '@/components/CloseButton.vue'
import CollapseButton from '@/components/CollapseButton.vue'
import ResizeGrip from '@/components/ResizeGrip.vue'
import PetIcon from '@/components/PetIcon.vue'
import WorldMap, { type MapLayer } from '@/components/WorldMap.vue'
import { bridge } from '@/lib/bridge.ts'
import { clampTo, cornerResize } from '@/lib/cornerResize.ts'
import { plural, t } from '@/lib/i18n.ts'
import { gatherLayers, useGatherables } from '@/lib/gatherables.ts'
import { displayName } from '@/lib/petDb.ts'
import { currentWorld, nearbyPets, useSpawns } from '@/lib/spawns.ts'
import { windowDrag } from '@/lib/windowDrag.ts'
import { useApp } from '@/stores/app.ts'
import { MINIMAP_HEIGHT, MINIMAP_WIDTH, SETTINGS_DEFAULTS, type Settings } from '@shared/settings.ts'
import { blankPet, canAttack, lastDeath } from '@shared/tracker.ts'

/** The map overlay follows you rather than fitting anything. */
const NO_FOCUS: [number, number][] = []
const PALETTE = ['#f76b15', '#30a46c', '#0090ff', '#e54666', '#12a594', '#ab4aba', '#8e8c99', '#ffffff']

const store = useApp()
const api = bridge()
const root = ref<HTMLElement | null>(null)
const map = ref<InstanceType<typeof WorldMap> | null>(null)
const cfg = computed(() => store.settings.minimap)
const spawns = useSpawns()

/** The zone you are in, else the last one known: a guess from the monsters around you comes and goes. */
const lastWorld = ref<number | null>(null)
const worldId = computed(() => (spawns.value ? (currentWorld(store.nearby, spawns.value) ?? lastWorld.value) : null))
watch(worldId, (id) => id !== null && (lastWorld.value = id))
const world = computed(() => (spawns.value && worldId.value !== null ? (spawns.value.worlds[worldId.value] ?? null) : null))

/**
 * Tracked pets with spawns in this zone: pinned ones (all of them), then those whose soul monsters
 * are around you; each its colour, the colours going round again past the palette.
 */
const tracked = computed(() => {
  const data = spawns.value
  if (!data) return []
  const here = (id: number): boolean => (data.pets[id] ?? []).some((d) => d.worlds.some((w) => w.world === worldId.value))
  const ids = [...store.settings.hud.pinned, ...nearbyPets(store.nearby, data).map((n) => n.pet)]
  return [...new Set(ids)]
    .filter((id) => !store.hiddenPet(id) && here(id))
    .map((id, i) => ({ id, color: PALETTE[i % PALETTE.length]! }))
})

const layers = computed<MapLayer[]>(() =>
  tracked.value.flatMap(({ id, color }) =>
    (spawns.value?.pets[id] ?? []).flatMap((d) => {
      const w = d.worlds.find((x) => x.world === worldId.value)
      return w ? [{ key: `${id}-${d.npc}`, points: w.points, color, active: false }] : []
    }),
  ),
)
/** The legend: the tracked pets (all with spawns in this zone). */
const legend = tracked
const cubes = computed(() => store.cubes.map((c) => c.position))
/** Gatherables around you (Map page → Gatherables): the pinned ones, or all. */
const gather = useGatherables()
const icons = computed(() => (cfg.value.gatherables ? gatherLayers(gather.value, worldId.value, store.settings.gatherables.pinned) : []))
/** Enemy players in view whose place is known: red pins, grey with their PvP off outside the Abyss (PvP page, Enemies nearby). */
const enemyPins = computed(() =>
  store.settings.enemies.mapPins
    ? store.enemies.flatMap((e) => (e.position ? [{ name: e.name, position: e.position, threat: canAttack(e, world.value?.group === 'abyss') }] : []))
    : [],
)
/** Where you last died, when it was in this zone. */
const death = computed(() => {
  const d = lastDeath(store.pvp)
  return d && d.place.world === worldId.value ? d.place.position : null
})
const pet = (id: number) => store.pets.find((p) => p.id === id) ?? blankPet(id)

const drag = windowDrag({ move: 'minimap:moveTo', end: 'minimap:dragEnd' })
const setZoom = (zoom: number): void =>
  void store.set('minimap', { ...cfg.value, zoom: Math.min(40, Math.max(1, zoom)) })
const set = (patch: Partial<Settings['minimap']>): void => void store.set('minimap', { ...cfg.value, ...patch })
const toggleCollapsed = (): void => set({ collapsed: !cfg.value.collapsed })

/** The size while its corner is being dragged; the saved one otherwise. */
const live = ref<{ size: number; height: number | null } | null>(null)
const width = computed(() => live.value?.size ?? cfg.value.size)
const mapHeight = computed(() => (live.value ? live.value.height : cfg.value.height) ?? width.value)
/** Drag the corner: the width, and the map's height once it moves up or down (not while minimized). */
const onGrip = cornerResize({
  start: () => ({ width: width.value, height: mapHeight.value }),
  move: (size, vertical) => {
    const tall = !cfg.value.collapsed && (vertical || cfg.value.height !== null)
    live.value = { size: clampTo(size.width, MINIMAP_WIDTH), height: tall ? clampTo(size.height, MINIMAP_HEIGHT) : null }
  },
  end: () => {
    if (live.value) set(cfg.value.collapsed ? { size: live.value.size } : live.value)
    live.value = null
  },
})
const resetSize = (): void => set({ size: SETTINGS_DEFAULTS.minimap.size, height: null })

/** The opacity slider, while it is dragged: applied live, saved on release. */
const liveOpacity = ref<number | null>(null)
const opacity = computed(() => liveOpacity.value ?? cfg.value.opacity)
function saveOpacity(): void {
  if (liveOpacity.value !== null) set({ opacity: liveOpacity.value })
  liveOpacity.value = null
}
/** The + and - buttons: a step of 1.5 times either way. */
const ZOOM_STEP = 1.5

/** Tell main how big the window is. */
let sent = ''
function report(): void {
  const el = root.value
  const r = el?.getBoundingClientRect() ?? { width: 0, height: 0 }
  const key = `${Math.ceil(r.width)}x${Math.ceil(r.height)}`
  if (key === sent) return
  sent = key
  void api.invoke('minimap:resize', { width: r.width, height: r.height })
}
watch([world, width, mapHeight, () => cfg.value.collapsed, () => legend.value.length], () => void nextTick(report))

let observer: ResizeObserver | null = null
onMounted(() => {
  observer = new ResizeObserver(report)
  if (root.value) observer.observe(root.value)
  report()
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div class="inline-block">
    <div ref="root" class="inline-block">
      <div
        class="group relative m-1.5 overflow-hidden rounded-lg border border-card bg-darker shadow-card"
        :style="{ width: `${width}px`, opacity }"
      >
        <header class="flex cursor-move items-center gap-1.5 px-2 py-1 text-[11px]" :title="t('Drag to move')" @pointerdown="drag.onPointerDown">
          <span class="truncate font-semibold text-dark">{{ world?.name ?? t('Map') }}</span>
          <span class="flex-1" />
          <span v-if="store.cubes.length" class="shrink-0 rounded-full bg-yellow/15 px-1.5 font-semibold text-yellow">
            {{ plural(store.cubes.length, '{n} cube', '{n} cubes') }}
          </span>
          <span v-if="!store.nearby.position && !cfg.collapsed" class="shrink-0 text-darkest">{{ t('where you are: unknown') }}</span>
          <CollapseButton :collapsed="cfg.collapsed" class="-my-0.5" @toggle="toggleCollapsed" />
          <CloseButton class="-my-0.5 -mr-1" @close="set({ enabled: false })" />
        </header>
        <p v-if="!world && !cfg.collapsed" class="px-2 pb-2 text-[11px] text-darker">
          {{ t("Your zone isn't known yet: change zone (or teleport) and the map shows it.") }}
        </p>
        <template v-else-if="!cfg.collapsed && world">
        <div class="relative" :style="{ height: `${mapHeight}px` }">
          <div class="absolute right-1.5 top-1.5 z-10 flex flex-col overflow-hidden rounded-md border border-black/40 bg-black/60 text-white shadow">
            <button
              type="button"
              class="flex size-6 items-center justify-center hover:bg-white/15 disabled:opacity-40"
              :title="t('Zoom in')"
              :disabled="cfg.zoom >= 40"
              @pointerdown.stop
              @dblclick.stop
              @click="setZoom(cfg.zoom * ZOOM_STEP)"
            >
              <svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                <path d="M8 3.5v9M3.5 8h9" />
              </svg>
            </button>
            <button
              type="button"
              class="flex size-6 items-center justify-center border-t border-white/15 hover:bg-white/15 disabled:opacity-40"
              :title="t('Centre on me')"
              :disabled="!store.nearby.position"
              @pointerdown.stop
              @dblclick.stop
              @click="map?.recentre()"
            >
              <svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.6">
                <circle cx="8" cy="8" r="4.5" />
                <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
              </svg>
            </button>
            <button
              type="button"
              class="flex size-6 items-center justify-center border-t border-white/15 hover:bg-white/15 disabled:opacity-40"
              :title="t('Zoom out')"
              :disabled="cfg.zoom <= 1"
              @pointerdown.stop
              @dblclick.stop
              @click="setZoom(cfg.zoom / ZOOM_STEP)"
            >
              <svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                <path d="M3.5 8h9" />
              </svg>
            </button>
          </div>
          <WorldMap
            ref="map"
            :world="world"
            :layers="layers"
            :focus="NO_FOCUS"
            :you="store.nearby.position"
            :cubes="cubes"
            :icons="icons"
            :enemies="enemyPins"
            :death="death"
            :follow="cfg.zoom"
            :hint="false"
            class="!rounded-none"
            @zoom="setZoom"
          />
          <!-- Its opacity, while the pointer is over the map. -->
          <label
            :class="[
              'absolute bottom-1.5 left-1.5 z-10 flex items-center gap-1.5 rounded-md border border-black/40 bg-black/60 px-1.5 py-1 text-white shadow transition-opacity',
              liveOpacity !== null ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            ]"
            :title="t('Opacity')"
            @pointerdown.stop
            @dblclick.stop
            @wheel.stop
          >
            <svg viewBox="0 0 16 16" class="size-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="8" cy="8" r="5.5" />
              <path d="M8 2.5v11a5.5 5.5 0 0 0 0-11z" fill="currentColor" stroke="none" />
            </svg>
            <input
              type="range"
              min="0.3"
              max="1"
              step="0.05"
              :value="opacity"
              class="h-1 w-20 cursor-pointer accent-[var(--accent)]"
              @input="liveOpacity = Number(($event.target as HTMLInputElement).value)"
              @change="saveOpacity"
            />
            <span class="w-7 text-right text-[10px] tabular-nums">{{ Math.round(opacity * 100) }}%</span>
          </label>
        </div>
        <div v-if="legend.length" class="flex flex-wrap gap-x-2 gap-y-1 px-2 py-1.5">
          <span v-for="lg in legend" :key="lg.id" class="flex min-w-0 items-center gap-1 text-[11px] text-dark" :title="displayName(pet(lg.id))">
            <span class="size-2 shrink-0 rounded-full" :style="{ background: lg.color }" />
            <PetIcon :id="lg.id" :size="14" />
            <span class="max-w-[88px] truncate">{{ displayName(pet(lg.id)) }}</span>
          </span>
        </div>
        </template>
        <ResizeGrip :active="!!live" @grab="onGrip" @reset="resetSize" />
      </div>
    </div>
  </div>
</template>
