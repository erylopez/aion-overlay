<script setup lang="ts">
// Markers on the game's own map (main/gameMap.ts): this window lies over the part of the screen
// picked for it, click-through and out of screen captures. It takes pictures of that part of the
// screen, has the vision worker find your zone's map on them (workers/mapVision.ts), and draws the
// markers where they fall: gatherables, your tracked pets' spawns, Hidden Cubes, enemies and you.
// With the game's map closed (or another one open) nothing matches, and nothing is drawn.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { bridge } from '@/lib/bridge.ts'
import { gatherLayers, useGatherables } from '@/lib/gatherables.ts'
import { currentWorld, mapImage, nearbyPets, project, useSpawns } from '@/lib/spawns.ts'
import { useApp } from '@/stores/app.ts'
import MapVision from '@/workers/mapVision.ts?worker'
import type { GameMapState } from '@shared/gameMap.ts'

/** Pictures are taken at most this often, and one at a time. */
const FRAME_MS = 120
/** And made at most this big across (the match needs no more). */
const PICTURE_PX = 720
/** A match older than this: the map is gone (closed, or the game hidden). */
const STALE_MS = 900
const PALETTE = ['#f76b15', '#30a46c', '#0090ff', '#e54666', '#12a594', '#ab4aba', '#8e8c99', '#ffffff']

const store = useApp()
const api = bridge()
const spawns = useSpawns()
const gather = useGatherables()
const cfg = computed(() => store.settings.gameMap)
const canvas = ref<HTMLCanvasElement | null>(null)

// The zone: yours, else the last one known.
const lastWorld = ref<number | null>(null)
const worldId = computed(() => (spawns.value ? (currentWorld(store.nearby, spawns.value) ?? lastWorld.value) : null))
watch(worldId, (id) => id !== null && (lastWorld.value = id))
const world = computed(() => (spawns.value && worldId.value !== null ? (spawns.value.worlds[worldId.value] ?? null) : null))

// ---- vision ---------------------------------------------------------------------------------

const worker = new MapVision()
/** The zone map the worker has: its key and size, and whether it is the game's full detail. */
const reference = ref<{ key: string; width: number; height: number; detail: boolean } | null>(null)
/** The full detail of the zone, while it is being had (downloaded once, then kept). */
const detail = ref<'shipped' | 'loading' | 'ready'>('shipped')
/** The last match, zone map pixels → this window's CSS pixels, and when it was made. */
const placed = ref<{ m: number[]; at: number } | null>(null)
let busy = false
let lastInliers = 0
let lastMs = 0
/** Window CSS pixels per picture pixel, for the picture in flight. */
let cssPerPicture = 1

worker.onmessage = (e: MessageEvent): void => {
  const msg = e.data
  if (msg.type === 'reference') {
    reference.value = msg.error ? null : { key: msg.key, width: msg.width, height: msg.height, detail: !!msg.detail }
    if (msg.detail) detail.value = 'ready'
    else if (!msg.error) void loadDetail(msg.key)
    return
  }
  if (msg.type === 'features') return void api.invoke('gamemap:saveFeatures', msg.key, msg.data)
  if (msg.type === 'detailError') {
    detail.value = 'shipped'
    return
  }
  busy = false
  lastInliers = msg.inliers
  lastMs = msg.ms
  if (msg.matrix) {
    const k = cssPerPicture
    const [a, b, c, d, e2, f] = msg.matrix as number[]
    placed.value = { m: [a! * k, b! * k, c! * k, d! * k, e2! * k, f! * k], at: Date.now() }
  }
}
watch(
  world,
  (w) => {
    if (!w || reference.value?.key === w.key) return
    reference.value = null
    placed.value = null
    detail.value = 'shipped'
    worker.postMessage({ type: 'reference', key: w.key, url: new URL(mapImage(w), location.href).href })
  },
  { immediate: true },
)

/** The game's own map of the zone at full detail, for the worker to follow the map on instead. */
async function loadDetail(key: string): Promise<void> {
  const w = world.value
  if (!w || w.key !== key) return
  detail.value = 'loading'
  const [, , cols, rows] = w.sectors
  const got = await api.invoke('gamemap:detail', key, cols, rows)
  if (world.value?.key !== key) return
  if (!got) {
    detail.value = 'shipped'
    return
  }
  if (got.kind === 'features') worker.postMessage({ type: 'detail', key, features: got.data }, [got.data])
  else worker.postMessage({ type: 'detail', key, cols: got.cols, rows: got.rows, tiles: got.tiles }, got.tiles)
}

// ---- capture ----------------------------------------------------------------------------------

const video = document.createElement('video')
video.muted = true
let stream: MediaStream | null = null
let display: { bounds: { x: number; y: number; width: number; height: number }; scaleFactor: number } | null = null
const picture = new OffscreenCanvas(1, 1)
const pictureCtx = picture.getContext('2d', { willReadFrequently: true })!

async function startCapture(): Promise<void> {
  display = await api.invoke('gamemap:display')
  stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 10 }, audio: false })
  video.srcObject = stream
  await video.play()
}

/** This part of the screen, as a picture for the worker. */
function snap(): void {
  const region = cfg.value.region
  if (busy || !reference.value || !display || !region || !video.videoWidth) return
  const perDip = video.videoWidth / display.bounds.width
  const sx = (region.x - display.bounds.x) * perDip
  const sy = (region.y - display.bounds.y) * perDip
  const sw = region.width * perDip
  const sh = region.height * perDip
  const fit = Math.min(1, PICTURE_PX / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * fit))
  const h = Math.max(1, Math.round(sh * fit))
  if (picture.width !== w || picture.height !== h) {
    picture.width = w
    picture.height = h
  }
  pictureCtx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h)
  const data = pictureCtx.getImageData(0, 0, w, h).data
  cssPerPicture = region.width / w
  busy = true
  // Where you are on the zone map: a lost map is looked for around you first (it opens on you).
  const pos = store.nearby.position
  const ref = reference.value
  const player = pos && world.value && ref ? project(world.value, pos).map((v, i) => v * (i ? ref.height : ref.width)) : null
  worker.postMessage({ type: 'frame', width: w, height: h, rgba: data, player }, [data.buffer])
}

// ---- drawing ----------------------------------------------------------------------------------

const icons = new Map<string, HTMLImageElement>()
function icon(src: string): HTMLImageElement {
  let img = icons.get(src)
  if (!img) {
    img = new Image()
    img.src = src
    img.onload = draw
    icons.set(src, img)
  }
  return img
}

const now = ref(Date.now())
const found = computed(() => !!placed.value && now.value - placed.value.at < STALE_MS)

/** Tracked pets with spawns here: pinned, then those around you; each its colour. */
const pets = computed(() => {
  const data = spawns.value
  if (!data || !cfg.value.pets) return []
  const ids = [...new Set([...store.settings.hud.pinned, ...nearbyPets(store.nearby, data).map((n) => n.pet)])].filter((id) => !store.hiddenPet(id))
  return ids
    .map((id, i) => ({
      color: PALETTE[i % PALETTE.length]!,
      points: (data.pets[id] ?? []).flatMap((d) => d.worlds.filter((w) => w.world === worldId.value).flatMap((w) => w.points)),
    }))
    .filter((p) => p.points.length)
})
const gatherables = computed(() => (cfg.value.gatherables ? gatherLayers(gather.value, worldId.value, store.settings.gatherables.pinned) : []))

function draw(): void {
  const el = canvas.value
  if (!el) return
  const dpr = window.devicePixelRatio || 1
  const W = window.innerWidth
  const H = window.innerHeight
  if (el.width !== Math.round(W * dpr) || el.height !== Math.round(H * dpr)) {
    el.width = Math.round(W * dpr)
    el.height = Math.round(H * dpr)
  }
  const ctx = el.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)
  const w = world.value
  const r = reference.value
  if (!found.value || !w || !r || r.key !== w.key) return
  const [a, b, c, d, e, f] = placed.value!.m as [number, number, number, number, number, number]
  const scale = Math.hypot(a, d)
  const at = (p: [number, number]): [number, number] => {
    const [u, v] = project(w, p)
    const x = u * r.width
    const y = v * r.height
    return [a * x + b * y + c, d * x + e * y + f]
  }
  const inside = ([x, y]: [number, number], pad: number): boolean => x > -pad && y > -pad && x < W + pad && y < H + pad

  // Gatherables: their icons, a little bigger as the map zooms in.
  const size = Math.min(26, Math.max(12, 8 + scale * 4))
  for (const layer of gatherables.value) {
    const img = icon(layer.icon)
    if (!img.complete) continue
    for (const p of layer.points) {
      const [x, y] = at(p)
      if (inside([x, y], size)) ctx.drawImage(img, x - size / 2, y - size / 2, size, size)
    }
  }
  // Pets' spawns: dots in their colour.
  for (const pet of pets.value) {
    ctx.fillStyle = pet.color
    ctx.strokeStyle = '#09090b'
    ctx.lineWidth = 1.5
    for (const p of pet.points) {
      const [x, y] = at(p)
      if (!inside([x, y], 6)) continue
      ctx.beginPath()
      ctx.arc(x, y, 4.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  }
  // Hidden Cubes: golden diamonds.
  if (cfg.value.cubes) {
    for (const cube of store.cubes) {
      const [x, y] = at(cube.position)
      if (!inside([x, y], 10)) continue
      ctx.beginPath()
      ctx.moveTo(x, y - 9)
      ctx.lineTo(x + 8, y)
      ctx.lineTo(x, y + 9)
      ctx.lineTo(x - 8, y)
      ctx.closePath()
      ctx.fillStyle = '#fbbf24'
      ctx.strokeStyle = '#78350f'
      ctx.lineWidth = 2
      ctx.fill()
      ctx.stroke()
    }
  }
  // Enemies: red pins with their names.
  if (cfg.value.enemies) {
    ctx.font = '600 11px Inter Variable, Segoe UI, sans-serif'
    ctx.textAlign = 'center'
    for (const enemy of store.enemies) {
      if (!enemy.position) continue
      const [x, y] = at(enemy.position)
      if (!inside([x, y], 40)) continue
      ctx.beginPath()
      ctx.arc(x, y - 14, 6, Math.PI * 0.85, Math.PI * 2.15)
      ctx.lineTo(x, y)
      ctx.closePath()
      ctx.fillStyle = '#ef4444'
      ctx.strokeStyle = '#450a0a'
      ctx.lineWidth = 1.5
      ctx.fill()
      ctx.stroke()
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(0,0,0,0.85)'
      ctx.strokeText(enemy.name, x, y - 24)
      ctx.fillStyle = '#fecaca'
      ctx.fillText(enemy.name, x, y - 24)
    }
  }
}
watch([placed, found, gatherables, pets, () => store.cubes, () => store.enemies, cfg], draw, { deep: true })

// ---- the loop, and what the Map page shows ------------------------------------------------------

let reported = ''
function report(): void {
  const state: GameMapState = {
    status: !world.value ? 'nomap' : found.value ? 'found' : 'searching',
    world: worldId.value,
    inliers: found.value ? lastInliers : 0,
    ms: lastMs,
    detail: detail.value,
  }
  const key = JSON.stringify(state)
  if (key === reported) return
  reported = key
  void api.invoke('gamemap:report', state)
}

let snapTimer: ReturnType<typeof setInterval> | null = null
let tickTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  snapTimer = setInterval(snap, FRAME_MS)
  tickTimer = setInterval(() => {
    now.value = Date.now()
    report()
  }, 250)
  startCapture().catch((err: unknown) => void api.invoke('gamemap:report', { status: 'searching', world: null, inliers: 0, ms: 0, error: String(err) } as GameMapState))
})
onBeforeUnmount(() => {
  if (snapTimer) clearInterval(snapTimer)
  if (tickTimer) clearInterval(tickTimer)
  for (const track of stream?.getTracks() ?? []) track.stop()
  worker.terminate()
})
</script>

<template>
  <canvas ref="canvas" class="pointer-events-none fixed inset-0 size-full" />
</template>
