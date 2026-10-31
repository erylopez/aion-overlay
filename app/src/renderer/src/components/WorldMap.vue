<script setup lang="ts">
// A zone map with spawn points: the zone image and an SVG layer of dots in one 1000x1000 "map
// space", moved and scaled as one. Wheel zooms around the pointer, dragging pans, and the view
// fits whatever `focus` is (the selected monster's spawns) whenever it changes. With `follow` (a
// zoom), it keeps you in the middle instead, at that zoom, until you drag it; a double-click or 10 s
// later it follows again. Hidden Cubes draw as golden cubes, gatherables as their icons.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { IconLayer } from '@/lib/gatherables.ts'
import { mapImage, project, type World } from '@/lib/spawns.ts'
import { t } from '@/lib/i18n.ts'

export interface MapLayer {
  key: string | number
  points: [number, number][]
  color: string
  active: boolean
}

const props = defineProps<{
  world: World
  layers: MapLayer[]
  focus: [number, number][]
  you?: [number, number] | null
  cubes?: [number, number][]
  /** Gatherables: each place as its icon, the name on hover. */
  icons?: IconLayer[]
  /** Enemy players in view: red pins, the name on hover. */
  enemies?: { name: string; position: [number, number] }[]
  /** Keep you in the middle at this zoom (times the whole zone's): the map overlay. */
  follow?: number
  /** The help line at the bottom (off in the small map overlay). */
  hint?: boolean
}>()
const emit = defineEmits<{ zoom: [zoom: number] }>()

const SIZE = 1000
const box = ref<HTMLElement | null>(null)
const view = ref({ k: 1, x: 0, y: 0 })
const loaded = ref(false)

const youXY = computed(() => (props.you ? project(props.world, props.you).map((v) => v * SIZE) : null))
const enemyXY = computed(() =>
  (props.enemies ?? []).map((e) => ({ name: e.name, xy: project(props.world, e.position).map((v) => v * SIZE) as [number, number] })),
)
/** A map pin's outline, its point at (0, 0), `s` tall. */
const pinPath = (s: number): string =>
  `M0 0C${-0.12 * s} ${-0.35 * s} ${-0.38 * s} ${-0.5 * s} ${-0.38 * s} ${-0.72 * s}A${0.38 * s} ${0.38 * s} 0 1 1 ${0.38 * s} ${-0.72 * s}C${0.38 * s} ${-0.5 * s} ${0.12 * s} ${-0.35 * s} 0 0Z`
const iconXY = computed(() =>
  (props.icons ?? []).map((l) => ({ ...l, xy: l.points.map((p) => project(props.world, p).map((v) => v * SIZE) as [number, number]) })),
)
/**
 * A gatherable's icon, in screen pixels: small over the whole zone (hundreds of them), full size
 * zoomed in. 6 px at the zone's own size, 18 px from about 8 times it.
 */
const iconPx = computed(() => {
  const { w, h } = boxSize()
  const ratio = view.value.k / (Math.min(w, h) / SIZE)
  return Math.min(18, Math.max(6, 4.5 + ratio * 1.7))
})
const cubeXY = computed(() => (props.cubes ?? []).map((c) => project(props.world, c).map((v) => v * SIZE) as [number, number]))
/** A golden cube's three faces, centred on 0,0, at `r` map units across. */
function cubeFaces(r: number): { top: string; left: string; right: string } {
  const p = (x: number, y: number): string => `${x * r},${y * r}`
  return {
    top: [p(0, -1), p(0.9, -0.5), p(0, 0), p(-0.9, -0.5)].join(' '),
    left: [p(-0.9, -0.5), p(0, 0), p(0, 1), p(-0.9, 0.5)].join(' '),
    right: [p(0.9, -0.5), p(0, 0), p(0, 1), p(0.9, 0.5)].join(' '),
  }
}

/** When the map was last dragged by hand: following waits a while after. */
let draggedAt = 0
const FOLLOW_PAUSE_MS = 10_000
/** You in the middle, at the `follow` zoom. */
function centre(force = false): void {
  if (!zoom.value || !youXY.value) return
  if (!force && Date.now() - draggedAt < FOLLOW_PAUSE_MS) return
  const { w, h } = boxSize()
  const k = (Math.min(w, h) / SIZE) * zoom.value
  view.value = { k, x: w / 2 - youXY.value[0]! * k, y: h / 2 - youXY.value[1]! * k }
}
/** The follow zoom as shown: the wheel changes it at once, and it is saved (emitted) a moment later. */
const zoom = ref(props.follow)
watch(
  () => props.follow,
  (z) => {
    // A zoom still being saved is newer than this one.
    if (z && z !== zoom.value && !saveTimer) zoomTo(z)
  },
)
let saveTimer: ReturnType<typeof setTimeout> | null = null
/** Follow at zoom `z`: around you, or around the middle of the view while where you are is not known. */
function zoomTo(z: number): void {
  zoom.value = z
  if (youXY.value) return centre(true)
  const { w, h } = boxSize()
  const { k, x, y } = view.value
  const k2 = (Math.min(w, h) / SIZE) * z
  view.value = { k: k2, x: w / 2 - ((w / 2 - x) / k) * k2, y: h / 2 - ((h / 2 - y) / k) * k2 }
}
watch(youXY, () => centre())
const followTimer = setInterval(() => centre(), 2000)
const projected = computed(() =>
  props.layers.map((l) => ({ ...l, xy: l.points.map((p) => project(props.world, p).map((v) => v * SIZE) as [number, number]) })),
)

function boxSize(): { w: number; h: number } {
  const r = box.value?.getBoundingClientRect()
  return { w: r?.width || 400, h: r?.height || 300 }
}

/** Fit the focus points (or the whole zone) into the box, with a margin. */
function fit(): void {
  if (zoom.value && youXY.value) {
    draggedAt = 0
    return centre(true)
  }
  const { w, h } = boxSize()
  const pts = props.focus.map((p) => project(props.world, p).map((v) => v * SIZE))
  let [x0, y0, x1, y1] = [0, 0, SIZE, SIZE]
  if (pts.length) {
    x0 = Math.min(...pts.map((p) => p[0]!))
    x1 = Math.max(...pts.map((p) => p[0]!))
    y0 = Math.min(...pts.map((p) => p[1]!))
    y1 = Math.max(...pts.map((p) => p[1]!))
    // Never closer than a ninth of the zone, so a single spawn keeps some context around it.
    const minSpan = SIZE / 9
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    const span = Math.max(x1 - x0, y1 - y0, minSpan) * 1.35
    ;[x0, x1, y0, y1] = [cx - span / 2, cx + span / 2, cy - span / 2, cy + span / 2]
  }
  const k = Math.min(w / (x1 - x0), h / (y1 - y0))
  view.value = { k, x: w / 2 - ((x0 + x1) / 2) * k, y: h / 2 - ((y0 + y1) / 2) * k }
}

function onWheel(e: WheelEvent): void {
  e.preventDefault()
  const r = box.value!.getBoundingClientRect()
  const px = e.clientX - r.left
  const py = e.clientY - r.top
  const { k, x, y } = view.value
  const { w, h } = boxSize()
  const minK = Math.min(w, h) / SIZE / 1.5
  const next = Math.min(40, Math.max(minK, k * Math.exp(-e.deltaY * 0.0015)))
  if (zoom.value) {
    // Following: the zoom changes around you (around the middle while where you are is not known),
    // straight away, and is remembered once the wheel stops.
    const base = Math.min(w, h) / SIZE
    zoomTo(Math.min(40, Math.max(1, next / base)))
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      emit('zoom', zoom.value!)
    }, 300)
    return
  }
  // Keep the map point under the pointer where it is.
  view.value = { k: next, x: px - ((px - x) / k) * next, y: py - ((py - y) / k) * next }
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const start = { ...view.value, px: e.clientX, py: e.clientY }
  const move = (ev: PointerEvent): void => {
    draggedAt = Date.now()
    view.value = { k: start.k, x: start.x + ev.clientX - start.px, y: start.y + ev.clientY - start.py }
  }
  const up = (ev: PointerEvent): void => {
    el.releasePointerCapture(ev.pointerId)
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
}

// Following, only a new zone fits the view again (its redraws as you move must not undo a zoom).
watch(() => props.world.key, fit)
watch(() => props.focus, () => !zoom.value && fit())
let observer: ResizeObserver | null = null
onMounted(() => {
  fit()
  // The panel grows when a map opens: fit again once the box has its new size.
  // Following without knowing where you are, only the first size fits it (a window drag can nudge it).
  let sized = false
  observer = new ResizeObserver(() => {
    if (!zoom.value || youXY.value || !sized) fit()
    sized = true
  })
  if (box.value) observer.observe(box.value)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  clearInterval(followTimer)
  if (saveTimer) clearTimeout(saveTimer)
})

/** Back on you now, following again (after a drag that looked around). */
function recentre(): void {
  draggedAt = 0
  centre(true)
}

defineExpose({ fit, recentre })
</script>

<template>
  <div
    ref="box"
    class="relative h-full w-full cursor-grab touch-none overflow-hidden rounded-lg bg-[#c9bfa6] active:cursor-grabbing"
    @wheel="onWheel"
    @pointerdown="onPointerDown"
    @dblclick="fit"
  >
    <div
      class="absolute left-0 top-0 origin-top-left"
      :style="{ width: `${SIZE}px`, height: `${SIZE}px`, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }"
    >
      <img
        :src="mapImage(world)"
        alt=""
        draggable="false"
        class="absolute inset-0 size-full select-none"
        @load="loaded = true"
      />
      <svg :viewBox="`0 0 ${SIZE} ${SIZE}`" class="absolute inset-0 size-full overflow-visible">
        <!-- Inactive layers first, so the selected monster's dots draw on top. -->
        <template v-for="layer in [...projected].sort((a, b) => Number(a.active) - Number(b.active))" :key="layer.key">
          <circle
            v-for="(p, i) in layer.xy"
            :key="i"
            :cx="p[0]"
            :cy="p[1]"
            :r="(layer.active ? 5.5 : 3.5) / view.k"
            :fill="layer.color"
            :fill-opacity="layer.active ? 0.95 : 0.55"
            stroke="#09090b"
            :stroke-width="(layer.active ? 1.5 : 1) / view.k"
          />
        </template>
        <!-- Gatherables: their icons, under the cubes and pins. -->
        <g v-for="layer in iconXY" :key="`icon-${layer.key}`">
          <image
            v-for="(p, i) in layer.xy"
            :key="i"
            :href="layer.icon"
            :x="p[0] - iconPx / 2 / view.k"
            :y="p[1] - iconPx / 2 / view.k"
            :width="iconPx / view.k"
            :height="iconPx / view.k"
          ><title>{{ layer.name }}</title></image>
        </g>
        <!-- Hidden Cubes: golden cubes. -->
        <g v-for="(c, i) in cubeXY" :key="`cube-${i}`" :transform="`translate(${c[0]} ${c[1]})`">
          <polygon :points="cubeFaces(9 / view.k).top" fill="#fde68a" stroke="#78350f" :stroke-width="1 / view.k" />
          <polygon :points="cubeFaces(9 / view.k).left" fill="#f59e0b" stroke="#78350f" :stroke-width="1 / view.k" />
          <polygon :points="cubeFaces(9 / view.k).right" fill="#b45309" stroke="#78350f" :stroke-width="1 / view.k" />
        </g>
        <!-- Enemy players: red pins pointing at where they stand. -->
        <g v-for="(e, i) in enemyXY" :key="`enemy-${i}`" :transform="`translate(${e.xy[0]} ${e.xy[1]})`">
          <title>{{ e.name }}</title>
          <path :d="pinPath(22 / view.k)" fill="#ef4444" stroke="#450a0a" :stroke-width="1.2 / view.k" />
          <circle :cy="-15.8 / view.k" :r="3.2 / view.k" fill="#fff" />
        </g>
        <!-- You: a ring with a dot, drawn last so nothing covers it. -->
        <g v-if="youXY">
          <circle :cx="youXY[0]" :cy="youXY[1]" :r="11 / view.k" fill="none" stroke="#ffffff" :stroke-width="3 / view.k" />
          <circle :cx="youXY[0]" :cy="youXY[1]" :r="11 / view.k" fill="none" stroke="#3b82f6" :stroke-width="1.5 / view.k" />
          <circle :cx="youXY[0]" :cy="youXY[1]" :r="4 / view.k" fill="#ffffff" stroke="#3b82f6" :stroke-width="1.5 / view.k" />
        </g>
      </svg>
    </div>
    <div v-if="!loaded" class="absolute inset-0 flex items-center justify-center text-xs text-black/60">{{ t('Loading map…') }}</div>
    <div v-if="hint !== false" class="pointer-events-none absolute bottom-1.5 right-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white/80">
      {{ t('scroll to zoom · drag to pan · double-click to fit') }}
    </div>
  </div>
</template>
