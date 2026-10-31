/**
 * Finding the zone's map on a picture of the screen (the game's own map, main/gameMap.ts), with
 * OpenCV (OpenCV.js, Apache-2.0): ORB keypoints on the picture are matched against the zone map's
 * own, and the matches that agree give where the map is and how far it is zoomed, as a matrix from
 * the zone map's pixels to the picture's. The game's map is never turned, so a match that turns or
 * skews it is not taken.
 *
 * Once the map is found only the part of the zone around where it was is searched (some hundred
 * keypoints rather than tens of thousands): a few milliseconds a picture. Lost, the whole zone is
 * searched again, every 1.5 s at first and every 4 s once it has been gone a while (a whole search
 * takes about half a second).
 *
 * Messages in: { type: 'reference', key, url } to (re)load a zone's map; { type: 'frame', width,
 * height, rgba } a picture. Out: { type: 'reference', key, width, height } once loaded (or with an
 * error), and { type: 'result', matrix | null, inliers, ms, mode } per picture.
 */
import cvModule from '@techstark/opencv-js'

// OpenCV.js is typed loosely and its objects are freed by hand; its own types add nothing here.
type Cv = any
// Emscripten's module is a thenable that resolves to itself: awaiting it as is never ends.
const ready: Promise<Cv> = new Promise((resolve) =>
  (cvModule as unknown as { then: (f: (m: Cv) => void) => void }).then((m: Cv) => {
    delete m.then
    resolve(m)
  }),
)

/** Keypoints on the zone map (3072 px): enough that a small, zoomed-in part of it has some. */
const REF_FEATURES = 40_000
/** On a picture of the screen (at most PICTURE_PX across): following the map, and looking for it. */
const FRAME_FEATURES = { local: 1_200, global: 700 }
/** The zone map is cut into cells this big, to pick its keypoints near the last place quickly. */
const CELL = 128
/** How often the whole zone is searched while the map is lost: often at first, then less (the map is closed). */
const GLOBAL_EVERY_MS = { soon: 1_500, later: 4_000, after: 15_000 }
const RATIO = 0.8
const REPROJ_PX = 4
const MIN_INLIERS = { global: 14, local: 10 }

interface Reference {
  key: string
  width: number
  height: number
  /** x, y of each keypoint. */
  pts: Float32Array
  /** 32 bytes each (ORB). */
  desc: Uint8Array
  /** Cell index → its keypoints. */
  cells: Map<number, number[]>
  cols: number
  /** Every keypoint's descriptors as one Mat (the whole-zone search). */
  descMat: Cv
}

let cv: Cv = null
let ref: Reference | null = null
/** The last match: zone map pixels → picture pixels, [a, b, c, d, e, f]. */
let last: number[] | null = null
let lastGlobal = 0
/** When the map was last seen (or the zone loaded): how long it has been lost. */
let lastSeen = 0

function orb(n: number): Cv {
  return new cv.ORB(n, 1.2, 8, 31, 0, 2, cv.ORB_HARRIS_SCORE, 31, 10)
}

async function loadReference(key: string, url: string): Promise<void> {
  const blob = await (await fetch(url)).blob()
  const bitmap = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0)
  const rgba = cv.matFromImageData(ctx.getImageData(0, 0, bitmap.width, bitmap.height))
  const gray = new cv.Mat()
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY)
  rgba.delete()
  const kp = new cv.KeyPointVector()
  const desc = new cv.Mat()
  const detector = orb(REF_FEATURES)
  detector.detectAndCompute(gray, new cv.Mat(), kp, desc)
  detector.delete()
  gray.delete()
  const n = kp.size()
  const pts = new Float32Array(n * 2)
  const cols = Math.ceil(bitmap.width / CELL)
  const cells = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const p = kp.get(i).pt
    pts[i * 2] = p.x
    pts[i * 2 + 1] = p.y
    const cell = Math.floor(p.y / CELL) * cols + Math.floor(p.x / CELL)
    const list = cells.get(cell)
    if (list) list.push(i)
    else cells.set(cell, [i])
  }
  kp.delete()
  ref?.descMat.delete()
  ref = { key, width: bitmap.width, height: bitmap.height, pts, desc: new Uint8Array(desc.data), cells, cols, descMat: desc }
  last = null
  lastGlobal = 0
  lastSeen = performance.now()
}

/** The keypoints of the zone map around where the picture was last found; null to search it all. */
function nearLast(frameW: number, frameH: number): number[] | null {
  if (!last || !ref) return null
  const [a, b, c, d, e, f] = last as [number, number, number, number, number, number]
  const det = a * e - b * d
  if (!det) return null
  // The picture's corners on the zone map, and as much again around them.
  const back = (x: number, y: number): [number, number] => [(e * (x - c) - b * (y - f)) / det, (-d * (x - c) + a * (y - f)) / det]
  const corners = [back(0, 0), back(frameW, 0), back(0, frameH), back(frameW, frameH)]
  const xs = corners.map((p) => p[0])
  const ys = corners.map((p) => p[1])
  const padX = (Math.max(...xs) - Math.min(...xs)) / 2
  const padY = (Math.max(...ys) - Math.min(...ys)) / 2
  const x0 = Math.max(0, Math.floor((Math.min(...xs) - padX) / CELL))
  const x1 = Math.min(ref.cols - 1, Math.floor((Math.max(...xs) + padX) / CELL))
  const y0 = Math.max(0, Math.floor((Math.min(...ys) - padY) / CELL))
  const y1 = Math.min(Math.ceil(ref.height / CELL) - 1, Math.floor((Math.max(...ys) + padY) / CELL))
  const out: number[] = []
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(...(ref.cells.get(y * ref.cols + x) ?? []))
  return out.length >= 40 ? out : null
}

/** zone map → picture, if enough matches agree on a map that is only moved and zoomed. */
function solve(frameDesc: Cv, framePts: Float32Array, subset: number[] | null): { matrix: number[]; inliers: number } | null {
  if (!ref) return null
  let train = ref.descMat
  if (subset) {
    train = new cv.Mat(subset.length, 32, cv.CV_8U)
    const data = train.data as Uint8Array
    subset.forEach((idx, row) => data.set(ref!.desc.subarray(idx * 32, idx * 32 + 32), row * 32))
  }
  const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false)
  const knn = new cv.DMatchVectorVector()
  matcher.knnMatch(frameDesc, train, knn, 2)
  const from: number[] = []
  const to: number[] = []
  for (let i = 0; i < knn.size(); i++) {
    const pair = knn.get(i)
    if (pair.size() < 2) continue
    const best = pair.get(0)
    if (best.distance >= RATIO * pair.get(1).distance) continue
    const idx = subset ? subset[best.trainIdx]! : best.trainIdx
    from.push(ref.pts[idx * 2]!, ref.pts[idx * 2 + 1]!)
    to.push(framePts[best.queryIdx * 2]!, framePts[best.queryIdx * 2 + 1]!)
  }
  knn.delete()
  matcher.delete()
  if (subset) train.delete()
  const need = subset ? MIN_INLIERS.local : MIN_INLIERS.global
  if (from.length / 2 < need) return null
  const src = cv.matFromArray(from.length / 2, 1, cv.CV_32FC2, from)
  const dst = cv.matFromArray(to.length / 2, 1, cv.CV_32FC2, to)
  const mask = new cv.Mat()
  const fit = cv.estimateAffine2D(src, dst, mask, cv.RANSAC, REPROJ_PX)
  let inliers = 0
  for (let i = 0; i < mask.rows; i++) inliers += mask.data[i] ? 1 : 0
  const m: number[] = fit.empty() ? [] : Array.from(fit.data64F as Float64Array)
  src.delete()
  dst.delete()
  mask.delete()
  fit.delete()
  if (m.length !== 6 || inliers < need) return null
  // Moved and zoomed only: the game's map does not turn or skew.
  const [a, b, , d, e] = m as [number, number, number, number, number]
  const scale = Math.sqrt(Math.abs(a * e - b * d))
  if (!(scale > 0.1 && scale < 20) || Math.abs(b) / scale > 0.06 || Math.abs(d) / scale > 0.06 || Math.abs(a - e) / scale > 0.06) return null
  return { matrix: m, inliers }
}

function match(width: number, height: number, rgba: Uint8ClampedArray<ArrayBuffer>): { matrix: number[] | null; inliers: number; mode: 'local' | 'global' | 'wait' } {
  const image = cv.matFromImageData(new ImageData(rgba, width, height))
  const gray = new cv.Mat()
  cv.cvtColor(image, gray, cv.COLOR_RGBA2GRAY)
  image.delete()
  const kp = new cv.KeyPointVector()
  const desc = new cv.Mat()
  const detector = orb(last ? FRAME_FEATURES.local : FRAME_FEATURES.global)
  detector.detectAndCompute(gray, new cv.Mat(), kp, desc)
  detector.delete()
  gray.delete()
  const pts = new Float32Array(kp.size() * 2)
  for (let i = 0; i < kp.size(); i++) {
    const p = kp.get(i).pt
    pts[i * 2] = p.x
    pts[i * 2 + 1] = p.y
  }
  kp.delete()
  try {
    if (desc.rows < MIN_INLIERS.local) {
      last = null
      return { matrix: null, inliers: 0, mode: 'local' }
    }
    const near = nearLast(width, height)
    if (near) {
      const found = solve(desc, pts, near)
      if (found) {
        last = found.matrix
        lastSeen = performance.now()
        return { ...found, mode: 'local' }
      }
    }
    // Lost: the whole zone, now and then.
    const now = performance.now()
    const every = now - lastSeen < GLOBAL_EVERY_MS.after ? GLOBAL_EVERY_MS.soon : GLOBAL_EVERY_MS.later
    if (now - lastGlobal < every) {
      last = null
      return { matrix: null, inliers: 0, mode: 'wait' }
    }
    lastGlobal = now
    const found = solve(desc, pts, null)
    last = found?.matrix ?? null
    if (last) lastSeen = now
    return { matrix: last, inliers: found?.inliers ?? 0, mode: 'global' }
  } finally {
    desc.delete()
  }
}

self.onmessage = async (e: MessageEvent): Promise<void> => {
  cv ??= await ready
  const msg = e.data as { type: 'reference'; key: string; url: string } | { type: 'frame'; width: number; height: number; rgba: Uint8ClampedArray<ArrayBuffer> }
  if (msg.type === 'reference') {
    try {
      await loadReference(msg.key, msg.url)
      self.postMessage({ type: 'reference', key: msg.key, width: ref!.width, height: ref!.height })
    } catch (err) {
      ref = null
      self.postMessage({ type: 'reference', key: msg.key, error: String(err) })
    }
    return
  }
  const started = performance.now()
  const out = ref ? match(msg.width, msg.height, msg.rgba) : { matrix: null, inliers: 0, mode: 'wait' as const }
  self.postMessage({ type: 'result', ...out, ms: Math.round(performance.now() - started) })
}
