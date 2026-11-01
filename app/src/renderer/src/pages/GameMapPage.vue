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
import type { InvokeResult } from '@shared/ipc.ts'

/** Pictures are taken at most this often, and one at a time. */
const FRAME_MS = 120
/** And made at most this big across (the match needs no more). */
const PICTURE_PX = 720
/** A picture the worker has not answered in this long is given up on (it never should). */
const WAIT_MS = 5_000
/** A match older than this (or than three pictures take, on a slow computer): the map is gone (closed, or the game hidden). */
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
/** When the picture in flight was sent: one not answered in WAIT_MS is given up on. */
let sentAt = 0
let lastInliers = 0
let lastScore: number | undefined
let lastMs = 0
let lastMode = ''
/** The last thing that went wrong, for Map V2 and the log. */
const lastError = ref<{ at: number; text: string } | null>(null)
function fail(text: string): void {
  lastError.value = { at: Date.now(), text }
  note(text)
}
/** A line for the map log (main/gameMapLog.ts). */
const note = (line: string): void => void api.invoke('gamemap:log', line)
/** The screen capture's state, and the pictures taken (Map V2 shows them). */
const capture = ref<'starting' | 'on' | 'slow' | 'failed'>('starting')
let pictures = 0
/** Window CSS pixels per picture pixel, for the picture in flight. */
let cssPerPicture = 1

worker.onmessage = (e: MessageEvent): void => {
  const msg = e.data
  if (msg.type === 'reference') {
    reference.value = msg.error ? null : { key: msg.key, width: msg.width, height: msg.height, detail: !!msg.detail }
    note(msg.error ? `zone map ${msg.key} not loaded: ${msg.error}` : `zone map ${msg.key} ${msg.detail ? 'detail' : 'basic'} ready, ${msg.width}x${msg.height}`)
    if (msg.detail) detail.value = 'ready'
    else if (!msg.error) void loadDetail(msg.key)
    return
  }
  if (msg.type === 'features') return void api.invoke('gamemap:saveFeatures', msg.key, msg.data)
  if (msg.type === 'detailError') {
    note(`zone map ${msg.key} detail not made: ${msg.error}`)
    detail.value = 'shipped'
    return
  }
  busy = false
  sentAt = 0
  lastInliers = msg.inliers
  lastScore = msg.score
  lastMs = msg.ms
  lastMode = msg.mode
  modes.set(msg.mode, (modes.get(msg.mode) ?? 0) + 1)
  if (msg.error) fail(msg.error)
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

/** A step that never ends (Windows not answering the capture request) is given up on. */
function within<T>(ms: number, what: string, job: Promise<T>): Promise<T> {
  return Promise.race([job, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what}: no answer in ${ms / 1000} s`)), ms))])
}

/** When the stream last gave a picture: one that stops giving them is started again. */
let frameAt = 0
function onFrame(): void {
  frameAt = Date.now()
  video.requestVideoFrameCallback(onFrame)
}
video.requestVideoFrameCallback(onFrame)
/** The stream gives no pictures: they are taken the slow way (main/gameMap.ts grab) meanwhile. */
let slow = false
/** Stream failures in a row: after two, the slow way. */
let failures = 0
/** A capture is being started: no new one until it is done. */
let starting = false

async function startCapture(): Promise<void> {
  if (!slow) capture.value = 'starting'
  for (const track of stream?.getTracks() ?? []) track.stop()
  stream = null
  video.srcObject = null
  display = await api.invoke('gamemap:display')
  const region = cfg.value.region
  note(
    `capture: asking for the screen; region ${region ? `${region.width}x${region.height} at ${region.x},${region.y}` : 'none'}, ` +
      `display ${display ? `${display.bounds.width}x${display.bounds.height} at ${display.bounds.x},${display.bounds.y}, ${display.scaleFactor * 100}%` : 'none'}, window ${window.innerWidth}x${window.innerHeight} at ${window.devicePixelRatio * 100}%`,
  )
  stream = await within(8_000, 'the screen capture request', navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 10 }, audio: false }))
  const track = stream.getVideoTracks()[0]
  const s = track?.getSettings()
  note(`capture: got the screen, ${s?.width ?? '?'}x${s?.height ?? '?'} at ${s?.frameRate ?? '?'} fps ("${track?.label ?? '?'}")`)
  // The screen capture can end under us (a display or resolution change): start it again.
  const mine = stream
  track?.addEventListener('ended', () => {
    if (stream !== mine) return
    fail('the screen capture ended: starting it again')
    setTimeout(() => void retryCapture(), 1000)
  })
  video.srcObject = stream
  await within(5_000, 'playing the screen capture', video.play())
  // Playing is not enough: a stuck capture plays a 2×2 nothing. A real picture of the screen, or it failed.
  const asked = Date.now()
  while (video.videoWidth < 16 || frameAt < asked) {
    if (Date.now() - asked > 3_000) throw new Error(`the screen capture gives no pictures (${video.videoWidth}x${video.videoHeight})`)
    await new Promise((r) => setTimeout(r, 100))
  }
  note(`capture: playing, video ${video.videoWidth}x${video.videoHeight}${slow ? ': back from the slow way' : ''}`)
  slow = false
  failures = 0
  capture.value = 'on'
}

/** Start the capture; failed, try again in a while (logged each time), the slow way meanwhile. */
async function retryCapture(): Promise<void> {
  if (starting) return
  starting = true
  try {
    await startCapture()
  } catch (err) {
    for (const track of stream?.getTracks() ?? []) track.stop()
    stream = null
    video.srcObject = null
    fail(`no screen capture: ${String(err)}`)
    if (++failures >= 2 && !slow) {
      slow = true
      note('capture: the stream gives no pictures, taking them the slow way meanwhile')
    }
    capture.value = slow ? 'slow' : 'failed'
    setTimeout(() => void retryCapture(), slow ? 60_000 : 10_000)
  } finally {
    starting = false
  }
}

/** A small JPEG of what the overlay sees, for Map V2 (now and then). */
const thumb = new OffscreenCanvas(1, 1)
let preview: string | null = null
async function makePreview(): Promise<void> {
  if (!picture.width || picture.width < 2) return
  const k = Math.min(1, 220 / Math.max(picture.width, picture.height))
  thumb.width = Math.round(picture.width * k)
  thumb.height = Math.round(picture.height * k)
  thumb.getContext('2d')!.drawImage(picture, 0, 0, thumb.width, thumb.height)
  const blob = await thumb.convertToBlob({ type: 'image/jpeg', quality: 0.7 })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  preview = `data:image/jpeg;base64,${btoa(bin)}`
}

/** This part of the screen, as a picture for the worker. */
function snap(): void {
  const region = cfg.value.region
  if (busy && Date.now() - sentAt > WAIT_MS) {
    fail('the worker did not answer: going on without it')
    busy = false
  }
  if (busy || !reference.value || !display || !region) return
  if (slow) return void grab(region)
  // A stream that stopped giving pictures (Windows does, after hours): started again.
  if (capture.value === 'on' && Date.now() - frameAt > 5_000 && !starting) {
    fail('the screen capture stopped giving pictures: starting it again')
    capture.value = 'failed'
    void retryCapture()
    return
  }
  if (capture.value !== 'on' || video.videoWidth < 16) return
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
  if (!pictures++) note(`first picture: ${w}x${h} from ${Math.round(sw)}x${Math.round(sh)} at ${Math.round(sx)},${Math.round(sy)} of the ${video.videoWidth}x${video.videoHeight} screen`)
  send(w, h, pictureCtx.getImageData(0, 0, w, h).data, region.width / w)
}

/** The region the slow way: a fresh picture of the screen from the app, cut down to the region. */
async function grab(region: { width: number; height: number }): Promise<void> {
  const fit = Math.min(1, PICTURE_PX / (Math.max(region.width, region.height) * (display?.scaleFactor ?? 1)))
  const w = Math.max(16, Math.round(region.width * (display?.scaleFactor ?? 1) * fit))
  const h = Math.max(16, Math.round(region.height * (display?.scaleFactor ?? 1) * fit))
  busy = true
  sentAt = Date.now()
  let got: InvokeResult<'gamemap:grab'> = null
  try {
    got = await api.invoke('gamemap:grab', w, h)
  } catch (err) {
    fail(`slow capture: ${String(err)}`)
  }
  busy = false
  if (!got || !slow) return
  const data = new Uint8ClampedArray(got.rgba.buffer, got.rgba.byteOffset, got.rgba.byteLength).slice()
  // Shown on Map V2 like a stream picture.
  if (picture.width !== got.width || picture.height !== got.height) {
    picture.width = got.width
    picture.height = got.height
  }
  pictureCtx.putImageData(new ImageData(data.slice(), got.width, got.height), 0, 0)
  if (!pictures++) note(`first picture (slow way): ${got.width}x${got.height}`)
  send(got.width, got.height, data, region.width / got.width)
}

/** A picture to the worker, with where you are. */
function send(w: number, h: number, data: Uint8ClampedArray<ArrayBuffer>, css: number): void {
  cssPerPicture = css
  busy = true
  sentAt = Date.now()
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
const found = computed(() => !!placed.value && now.value - placed.value.at < Math.max(slow ? 3 * STALE_MS : STALE_MS, 3 * lastMs))

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
  // The part of the screen watched (Map V2 → Show the watched area): to see it lies on the map.
  if (cfg.value.showArea) {
    ctx.setLineDash([8, 5])
    ctx.lineWidth = 2
    ctx.strokeStyle = found.value ? '#30a46c' : '#3b82f6'
    ctx.strokeRect(1, 1, W - 2, H - 2)
    ctx.setLineDash([])
    ctx.font = '600 11px Inter Variable, Segoe UI, sans-serif'
    ctx.textAlign = 'left'
    const label = `${W}×${H} · ${found.value ? 'map found' : capture.value === 'on' ? 'looking' : capture.value === 'slow' ? 'looking (slow capture)' : `capture ${capture.value}`}`
    ctx.fillStyle = 'rgba(0,0,0,0.7)'
    ctx.fillRect(4, 4, ctx.measureText(label).width + 10, 18)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(label, 9, 17)
  }
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
watch([placed, found, gatherables, pets, () => store.cubes, () => store.enemies, cfg, capture], draw, { deep: true })

// ---- the loop, and what the Map page shows ------------------------------------------------------

let reported = ''
function report(): void {
  const state: GameMapState = {
    status: !world.value ? 'nomap' : found.value ? 'found' : 'searching',
    world: worldId.value,
    inliers: found.value ? lastInliers : 0,
    score: found.value && lastScore !== undefined ? Math.round(lastScore * 100) : undefined,
    ms: lastMs,
    detail: detail.value,
    mode: lastMode,
    error: lastError.value,
    capture: capture.value,
    pictures,
  }
  const key = JSON.stringify(state)
  // The preview goes along once a second; the rest whenever it changes.
  const withPreview = Date.now() - previewAt >= 1000
  if (key === reported && !withPreview) return
  reported = key
  if (withPreview) previewAt = Date.now()
  void api.invoke('gamemap:report', withPreview ? { ...state, preview } : state)
}
let previewAt = 0

/** Once a minute in the map log: how it went. */
const modes = new Map<string, number>()
let statsTimer: ReturnType<typeof setInterval> | null = null
function logStats(): void {
  const list = [...modes.entries()].map(([m, n]) => `${m} ${n}`).join(', ')
  note(`last minute: ${list || 'no pictures'}; capture ${capture.value}, ${detail.value} map, zone ${worldId.value ?? '?'}`)
  modes.clear()
}

let snapTimer: ReturnType<typeof setInterval> | null = null
let tickTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  snapTimer = setInterval(snap, FRAME_MS)
  tickTimer = setInterval(() => {
    now.value = Date.now()
    if (Date.now() - previewAt >= 1000) void makePreview().catch(() => undefined)
    report()
  }, 250)
  note(`overlay opened (${window.innerWidth}x${window.innerHeight})`)
  // Once the settings are in: the region is the overlay's own, and the log should say which.
  const start = (): void => void retryCapture()
  if (store.ready) start()
  else {
    const stop = watch(
      () => store.ready,
      (ok) => {
        if (!ok) return
        stop()
        start()
      },
    )
  }
  statsTimer = setInterval(logStats, 60_000)
})
onBeforeUnmount(() => {
  if (snapTimer) clearInterval(snapTimer)
  if (statsTimer) clearInterval(statsTimer)
  if (tickTimer) clearInterval(tickTimer)
  for (const track of stream?.getTracks() ?? []) track.stop()
  worker.terminate()
})
</script>

<template>
  <canvas ref="canvas" class="pointer-events-none fixed inset-0 size-full" />
</template>
