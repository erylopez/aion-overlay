/**
 * Finding the zone's map on a picture of the screen (the game's own map, main/gameMap.ts), with
 * OpenCV (OpenCV.js, Apache-2.0): ORB keypoints on the picture are matched against the zone map's
 * own, and the matches that agree give where the map is and how far it is zoomed, as a matrix from
 * the zone map's pixels to the picture's. The game's map is never turned, so a match that turns or
 * skews it is not taken.
 *
 * Once the map is found only the part of the zone around where it was is searched (some thousand
 * keypoints rather than tens of thousands): tens of milliseconds a picture. Between two pictures the
 * map's own movement is followed too (optical flow over the picture), which says where to search
 * next when it moved far (flying fast scrolls the game's map a long way) and carries the markers
 * over stretches where too few keypoints match (plain red ground): up to FLOW_ONLY pictures.
 * Lost, the zone around you (where the game's map opens) is searched, and the whole zone every
 * few seconds (that takes about a second).
 *
 * The zone map the app ships (3072 px) is matched against first. The game's own tiles, finer,
 * replace it once they are here (main/gameMapDetail.ts downloads them once per zone): they are
 * what the map is followed on from then on, while the occasional whole-zone search stays on the
 * shipped map, which is lighter.
 *
 * Keypoints are not all, though: the game draws its map with roads, names and its own colours
 * over it, and a zoomed-out map has too few keypoints left that agree (half a dozen, against
 * tens of thousands to sort through, a second a picture). So the map is first looked for as a
 * picture: where you are is known (the game tells, the Map page draws you there) and the game's
 * map opens on you, so the shipped map around you is compared with the picture, shrunk to a few
 * sizes (normalised cross-correlation, which a fainter map, its opacity turned down, only makes
 * score lower). That finds it in a tenth of a second, and following it from one picture to the
 * next is the same comparison at its size, in a few milliseconds, then once more at full size for
 * a placement steady to a tenth of a pixel. The keypoints remain for when that does not match
 * (half the map covered) and for when where you are is not known.
 *
 * Messages in: { type: 'reference', key, url } to (re)load a zone's map; { type: 'detail', key,
 * features | tiles, cols, rows } its full detail; { type: 'frame', width,
 * height, rgba, player } a picture, with where you are on the zone map (its pixels) when known.
 * Out: { type: 'reference', key, width, height, detail } once loaded (or with
 * an error, or the detail in its place), { type: 'features', key, data } what to keep of the detail, and { type: 'result', matrix | null, inliers, ms, mode } per picture.
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
/** On each 1024 px of the detail (8192 px for most zones: 120,000 in all). */
const DETAIL_FEATURES_PER_TILE = 1_900
/** The detail is at most this big across (the game's tiles together are twice it). */
const DETAIL_PX = 8_192
/** The kept keypoints file's first four bytes, "LKM1". */
const FEATURES_MAGIC = 0x314d4b4c
/**
 * On a picture of the screen (at most PICTURE_PX across): following the map, and looking for it
 * (more, for plain ground: Scarlet Forest is found with 2,500, not with 1,200).
 */
const FRAME_FEATURES = { follow: 1_200, search: 2_500 }
/** The zone map is cut into cells this big, to pick its keypoints near the last place quickly. */
const CELL = 128
/**
 * How often the map is looked for while lost: around you at every size (every 0.3 s just lost, every
 * 3 s once gone a while: the game's map closed, as it mostly is, the search must not eat the
 * game's processor), and the whole zone by its keypoints (seldom when where you are is known, as it
 * is found around you; only for a map moved away from you, every 30 s once gone a while: it takes
 * half a second or more).
 */
const GLOBAL_EVERY_MS = { near: 300, nearIdle: 3_000, zone: 4_000, zoneKnown: 15_000, zoneIdle: 30_000 }
/** Lost this long: gone a while. */
const IDLE_AFTER_MS = 3_000
/** The picture's sizes against the shipped map's (picture pixels to one of its pixels) looked for around you. */
const SCALES = { min: 0.35, max: 6, step: 1.1 }
/** Across, in pixels, the picture is shrunk to: to look for it, to follow it, and to place it finely. */
const LOOK_PX = 96
const FOLLOW_PX = 240
const FINE_PX = 360
/** How well the picture must compare (normalised cross-correlation): to be found, and to be followed. */
const MIN_SCORE = { look: 0.5, follow: 0.35 }
/** The quick first look scoring below this: nothing like the map there, no finer look (the map closed). */
const ROUGH_SCORE = 0.35
/** Followed, the map may have moved this many picture pixels past where its own movement put it, and zoomed by this. */
const FOLLOW_REACH = 30
const FOLLOW_ZOOM = 1.04
/** The keypoints of the zone map near a place, at most: more takes long (a second for the whole detail). */
const MAX_SUBSET = 30_000
/** Pictures in a row carried by the map's movement alone, without a match (about 3 s). */
const FLOW_ONLY = 24
/** Points followed from one picture to the next. */
const FLOW_POINTS = 300
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
/** The zone map the app ships; and the one matched against, the detail once it is here. */
let coarse: Reference | null = null
let ref: Reference | null = null
/** The shipped map itself, grey, to compare pictures with. */
let coarseGray: Cv = null
/** The picture's size against the shipped map when it was last found: looked for first. */
let lastScale: number | null = null
/** The last match: zone map pixels → picture pixels, [a, b, c, d, e, f]. */
let last: number[] | null = null
let lastZone = 0
let lastNear = 0
/** When the map was last found (or the zone map came): lost long after it, the search slows. */
let foundAt = 0
/** No mask: one empty Mat for every detection (a new one each time was never freed). */
let noMask: Cv = null
/** The previous picture, and points on it to follow into the next one. */
let prevGray: Cv = null
let prevPts: Cv = null
/** Pictures in a row placed by the map's movement alone. */
let flowRun = 0

function orb(n: number): Cv {
  return new cv.ORB(n, 1.2, 8, 31, 0, 2, cv.ORB_HARRIS_SCORE, 31, 10)
}

/** A zone map's keypoints, indexed by cell for the searches near a place. */
function makeReference(key: string, width: number, height: number, pts: Float32Array, desc: Uint8Array): Reference {
  const n = pts.length / 2
  const cols = Math.ceil(width / CELL)
  const cells = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const cell = Math.floor(pts[i * 2 + 1]! / CELL) * cols + Math.floor(pts[i * 2]! / CELL)
    const list = cells.get(cell)
    if (list) list.push(i)
    else cells.set(cell, [i])
  }
  const descMat = new cv.Mat(n, 32, cv.CV_8U)
  ;(descMat.data as Uint8Array).set(desc)
  return { key, width, height, pts, desc, cells, cols, descMat }
}

/** ORB keypoints of a picture, as points and descriptors (offset by dx, dy). */
function detect(image: ImageData, n: number, dx = 0, dy = 0): { pts: number[]; desc: Uint8Array } {
  const rgba = cv.matFromImageData(image)
  const gray = new cv.Mat()
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY)
  rgba.delete()
  const kp = new cv.KeyPointVector()
  const desc = new cv.Mat()
  const detector = orb(n)
  detector.detectAndCompute(gray, noMask, kp, desc)
  detector.delete()
  gray.delete()
  const pts: number[] = []
  for (let i = 0; i < kp.size(); i++) {
    const p = kp.get(i).pt
    pts.push(p.x + dx, p.y + dy)
  }
  kp.delete()
  const out = new Uint8Array(desc.data)
  desc.delete()
  return { pts, desc: out }
}

async function loadReference(key: string, url: string): Promise<void> {
  const blob = await (await fetch(url)).blob()
  const bitmap = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0)
  const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  const { pts, desc } = detect(image, REF_FEATURES)
  const rgba = cv.matFromImageData(image)
  coarseGray?.delete()
  coarseGray = new cv.Mat()
  cv.cvtColor(rgba, coarseGray, cv.COLOR_RGBA2GRAY)
  rgba.delete()
  coarse?.descMat.delete()
  if (ref && ref !== coarse) ref.descMat.delete()
  coarse = ref = makeReference(key, bitmap.width, bitmap.height, new Float32Array(pts), desc)
  last = null
  lastScale = null
  prevGray?.delete()
  prevPts?.delete()
  prevGray = prevPts = null
  lastZone = 0
  lastNear = 0
  foundAt = performance.now()
  flowRun = 0
}

/** The detail from the game's tiles: each one shrunk to fit DETAIL_PX and searched for keypoints. */
async function detailFromTiles(key: string, cols: number, rows: number, tiles: ArrayBuffer[]): Promise<Reference> {
  const size = Math.min(2048, Math.floor(DETAIL_PX / Math.max(cols, rows)))
  const perTile = Math.round(DETAIL_FEATURES_PER_TILE * (size / 1024) ** 2)
  const canvas = new OffscreenCanvas(size, size)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const pts: number[] = []
  const descs: Uint8Array[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const bitmap = await createImageBitmap(new Blob([tiles[r * cols + c]!]), { resizeWidth: size, resizeHeight: size, resizeQuality: 'high' })
      ctx.clearRect(0, 0, size, size)
      ctx.drawImage(bitmap, 0, 0)
      bitmap.close()
      const found = detect(ctx.getImageData(0, 0, size, size), perTile, c * size, r * size)
      pts.push(...found.pts)
      descs.push(found.desc)
    }
  }
  const desc = new Uint8Array(descs.reduce((n, d) => n + d.length, 0))
  let at = 0
  for (const d of descs) {
    desc.set(d, at)
    at += d.length
  }
  return makeReference(key, cols * size, rows * size, new Float32Array(pts), desc)
}

/** Kept keypoints: "LKM1", width, height, count (u32 each), then the points (f32) and descriptors. */
function packFeatures(r: Reference): ArrayBuffer {
  const n = r.pts.length / 2
  const out = new ArrayBuffer(16 + n * 8 + n * 32)
  new Uint32Array(out, 0, 4).set([FEATURES_MAGIC, r.width, r.height, n])
  new Float32Array(out, 16, n * 2).set(r.pts)
  new Uint8Array(out, 16 + n * 8).set(r.desc)
  return out
}

function unpackFeatures(key: string, data: ArrayBuffer): Reference | null {
  if (data.byteLength < 16) return null
  const [magic, width, height, n] = new Uint32Array(data, 0, 4) as unknown as [number, number, number, number]
  if (magic !== FEATURES_MAGIC || data.byteLength !== 16 + n * 40) return null
  return makeReference(key, width, height, new Float32Array(data.slice(16, 16 + n * 8)), new Uint8Array(data.slice(16 + n * 8)))
}

/** Follow the map on `next` from now on, carrying where it was over to its pixels. */
function useReference(next: Reference): void {
  if (ref && last) {
    const s = next.width / ref.width
    last = [last[0]! / s, last[1]! / s, last[2]!, last[3]! / s, last[4]! / s, last[5]!]
  }
  if (ref && ref !== coarse) ref.descMat.delete()
  ref = next
}

/** The zone map's keypoints in cells x0..x1, y0..y1 (zone map pixels); null when too few, or too many to match quickly. */
function inBox(x0: number, y0: number, x1: number, y1: number): number[] | null {
  if (!ref) return null
  const out: number[] = []
  const cx0 = Math.max(0, Math.floor(x0 / CELL))
  const cx1 = Math.min(ref.cols - 1, Math.floor(x1 / CELL))
  const cy0 = Math.max(0, Math.floor(y0 / CELL))
  const cy1 = Math.min(Math.ceil(ref.height / CELL) - 1, Math.floor(y1 / CELL))
  for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) out.push(...(ref.cells.get(y * ref.cols + x) ?? []))
  return out.length >= 40 && out.length <= MAX_SUBSET ? out : null
}

/** The keypoints of the zone map around where `m` puts the picture (`pad` times its size again on each side). */
function nearMatrix(m: number[] | null, frameW: number, frameH: number, pad: number): number[] | null {
  if (!m || !ref) return null
  const [a, b, c, d, e, f] = m as [number, number, number, number, number, number]
  const det = a * e - b * d
  if (!det) return null
  // The picture's corners on the zone map, and as much again around them.
  const back = (x: number, y: number): [number, number] => [(e * (x - c) - b * (y - f)) / det, (-d * (x - c) + a * (y - f)) / det]
  const corners = [back(0, 0), back(frameW, 0), back(0, frameH), back(frameW, frameH)]
  const xs = corners.map((p) => p[0])
  const ys = corners.map((p) => p[1])
  const padX = (Math.max(...xs) - Math.min(...xs)) * pad
  const padY = (Math.max(...ys) - Math.min(...ys)) * pad
  return inBox(Math.min(...xs) - padX, Math.min(...ys) - padY, Math.max(...xs) + padX, Math.max(...ys) + padY)
}

/**
 * How the picture moved since the previous one (optical flow): [dx, dy] when most followed points
 * agree, as on the game's map scrolling under you; null when they do not (the map closed, the game's
 * 3D world behind it moving every which way).
 */
function flowShift(gray: Cv): [number, number] | null {
  if (!prevGray || !prevPts || prevPts.rows < 12) return null
  const next = new cv.Mat()
  const status = new cv.Mat()
  const err = new cv.Mat()
  cv.calcOpticalFlowPyrLK(prevGray, gray, prevPts, next, status, err, new cv.Size(21, 21), 4)
  const dx: number[] = []
  const dy: number[] = []
  for (let i = 0; i < status.rows; i++) {
    if (!status.data[i]) continue
    dx.push(next.data32F[i * 2]! - prevPts.data32F[i * 2]!)
    dy.push(next.data32F[i * 2 + 1]! - prevPts.data32F[i * 2 + 1]!)
  }
  next.delete()
  status.delete()
  err.delete()
  if (dx.length < 12) return null
  const median = (v: number[]): number => [...v].sort((p, q) => p - q)[v.length >> 1]!
  const mx = median(dx)
  const my = median(dy)
  const agree = dx.filter((x, i) => Math.hypot(x - mx, dy[i]! - my) < 3).length
  return agree >= dx.length * 0.6 ? [mx, my] : null
}

/** Keep this picture and points on it, to follow them into the next one. */
function keepForFlow(gray: Cv): void {
  prevGray?.delete()
  prevPts?.delete()
  prevGray = gray
  prevPts = new cv.Mat()
  cv.goodFeaturesToTrack(gray, prevPts, FLOW_POINTS, 0.01, 8)
}

/** zone map → picture, if enough matches agree on a map that is only moved and zoomed. */
function solve(frameDesc: Cv, framePts: Float32Array, subset: number[] | null, on: Reference | null = ref): { matrix: number[]; inliers: number } | null {
  if (!on) return null
  let train = on.descMat
  if (subset) {
    train = new cv.Mat(subset.length, 32, cv.CV_8U)
    const data = train.data as Uint8Array
    subset.forEach((idx, row) => data.set(on.desc.subarray(idx * 32, idx * 32 + 32), row * 32))
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
    from.push(on.pts[idx * 2]!, on.pts[idx * 2 + 1]!)
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

/** A match against the shipped map (its pixels → the picture's): `inliers` for keypoints, `score` for the picture compared whole. */
type Placed = { matrix: number[]; inliers: number; score?: number }

/** The shipped map's pixels ↔ the matched map's (the detail's, once here). */
function toCoarse(m: number[]): number[] {
  const k = ref!.width / coarse!.width
  return [m[0]! * k, m[1]! * k, m[2]!, m[3]! * k, m[4]! * k, m[5]!]
}
function fromCoarse(m: number[]): number[] {
  const k = ref!.width / coarse!.width
  return [m[0]! / k, m[1]! / k, m[2]!, m[3]! / k, m[4]! / k, m[5]!]
}
/** Where the picture's middle is on the map `m` places it on. */
function middleOf(m: number[], width: number, height: number): [number, number] {
  return [(width / 2 - m[2]!) / m[0]!, (height / 2 - m[5]!) / m[4]!]
}

/**
 * The picture compared with the shipped map at `scale` (picture pixels to one of its pixels), the
 * picture's middle within `reach` picture pixels of `at` (shipped map pixels): the best place, and
 * how well it compares there (normalised cross-correlation, -1 to 1). Both shrunk so the picture
 * is `px` across; the place is found to a fraction of a pixel (a parabola through the scores).
 */
function place(gray: Cv, scale: number, at: [number, number], reach: number, px: number): { matrix: number[]; score: number } | null {
  const k = Math.min(1, px / Math.max(gray.cols, gray.rows))
  const small = new cv.Mat()
  cv.resize(gray, small, new cv.Size(Math.max(8, Math.round(gray.cols * k)), Math.max(8, Math.round(gray.rows * k))), 0, 0, cv.INTER_AREA)
  const kx = small.cols / gray.cols
  const ky = small.rows / gray.rows
  const x0 = Math.max(0, Math.floor(at[0] - (gray.cols / 2 + reach) / scale))
  const y0 = Math.max(0, Math.floor(at[1] - (gray.rows / 2 + reach) / scale))
  const x1 = Math.min(coarseGray.cols, Math.ceil(at[0] + (gray.cols / 2 + reach) / scale))
  const y1 = Math.min(coarseGray.rows, Math.ceil(at[1] + (gray.rows / 2 + reach) / scale))
  const iw = Math.round((x1 - x0) * scale * kx)
  const ih = Math.round((y1 - y0) * scale * ky)
  // Off the map's edge.
  if (x1 <= x0 || y1 <= y0 || iw < small.cols + 2 || ih < small.rows + 2) {
    small.delete()
    return null
  }
  const part = coarseGray.roi(new cv.Rect(x0, y0, x1 - x0, y1 - y0))
  const sized = new cv.Mat()
  const scores = new cv.Mat()
  try {
    cv.resize(part, sized, new cv.Size(iw, ih), 0, 0, cv.INTER_AREA)
    cv.matchTemplate(sized, small, scores, cv.TM_CCOEFF_NORMED)
  } catch (err) {
    for (const mat of [part, small, sized, scores]) mat.delete()
    throw err
  }
  part.delete()
  const best = cv.minMaxLoc(scores)
  const at2 = (x: number, y: number): number => scores.floatAt(y, x)
  let { x: u, y: v } = best.maxLoc as { x: number; y: number }
  const [bu, bv] = [u, v]
  if (bu > 0 && bu < scores.cols - 1) {
    const [l, c, r] = [at2(bu - 1, bv), at2(bu, bv), at2(bu + 1, bv)]
    if (l - 2 * c + r < 0) u += (0.5 * (l - r)) / (l - 2 * c + r)
  }
  if (bv > 0 && bv < scores.rows - 1) {
    const [l, c, r] = [at2(bu, bv - 1), at2(bu, bv), at2(bu, bv + 1)]
    if (l - 2 * c + r < 0) v += (0.5 * (l - r)) / (l - 2 * c + r)
  }
  small.delete()
  sized.delete()
  scores.delete()
  // The shipped map's pixel x lands at (x - x0) * sx - u / kx on the picture.
  const sx = iw / (x1 - x0) / kx
  const sy = ih / (y1 - y0) / ky
  return { matrix: [sx, 0, -sx * x0 - u / kx, 0, sy, -sy * y0 - v / ky], score: best.maxVal as number }
}

/** Placed finely: compared once more at (nearly) the picture's own size, a few pixels around. */
function refine(gray: Cv, m: { matrix: number[]; score: number }): { matrix: number[]; score: number } {
  return place(gray, m.matrix[0]!, middleOf(m.matrix, gray.cols, gray.rows), 3, FINE_PX) ?? m
}

/**
 * Lost, and where you are known: the game's map opens on you, so the picture is compared with the
 * shipped map around you, at each size it could be (the last one first, alone, which is quick).
 */
function lookAround(gray: Cv, player: [number, number], full: boolean): Placed | null {
  const reach = Math.max(gray.cols, gray.rows) / 2
  let best: { matrix: number[]; score: number; scale: number } | null = null
  const sizes: number[] = []
  if (lastScale) sizes.push(lastScale / SCALES.step, lastScale, lastScale * SCALES.step)
  if (full) for (let s = SCALES.min; s <= SCALES.max; s *= SCALES.step) sizes.push(s)
  for (const scale of sizes) {
    const m = place(gray, scale, player, reach, LOOK_PX)
    if (m && (!best || m.score > best.score)) best = { ...m, scale }
  }
  if (!best || best.score < ROUGH_SCORE) return null
  // Between the sizes tried: a little smaller or bigger, finer.
  let fine: { matrix: number[]; score: number } | null = null
  for (const f of [1 / 1.06, 1 / 1.03, 1, 1.03, 1.06]) {
    const m = place(gray, best.scale * f, middleOf(best.matrix, gray.cols, gray.rows), 12, FOLLOW_PX)
    if (m && (!fine || m.score > fine.score)) fine = m
  }
  if (!fine || fine.score < MIN_SCORE.look) return null
  const done = refine(gray, fine)
  return { matrix: done.matrix, inliers: 0, score: done.score }
}

/**
 * Found, the map followed: compared where its movement puts it, at its size and a little smaller
 * and bigger (a zoom), the size taken between them. A size within 1.5% of the last is kept as it
 * was: the scores are never quite the same twice, and the markers would breathe with them.
 */
function follow(gray: Cv, moved: number[]): Placed | null {
  const m = toCoarse(moved)
  const scale = m[0]!
  const at = middleOf(m, gray.cols, gray.rows)
  const tried = [1 / FOLLOW_ZOOM, 1, FOLLOW_ZOOM].map((f) => place(gray, scale * f, at, FOLLOW_REACH, FOLLOW_PX))
  const [l, c, r] = tried.map((t) => t?.score ?? -1) as [number, number, number]
  if (Math.max(l, c, r) < MIN_SCORE.follow) return null
  let next = scale * (l > c && l > r ? 1 / FOLLOW_ZOOM : r > c && r > l ? FOLLOW_ZOOM : 1)
  if (c >= l && c >= r && l > -1 && r > -1 && l - 2 * c + r < 0) next = scale * FOLLOW_ZOOM ** Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / (l - 2 * c + r)))
  if (Math.abs(next / scale - 1) < 0.015) next = scale
  const placed = place(gray, next, at, FOLLOW_REACH, FOLLOW_PX)
  if (!placed || placed.score < MIN_SCORE.follow) return null
  const done = refine(gray, placed)
  return { matrix: fromCoarse(done.matrix), inliers: 0, score: done.score }
}

type Mode = 'follow' | 'local' | 'flow' | 'near' | 'zone' | 'wait'

/**
 * Each match lands a pixel or three off the last one even on a map that has not moved (the game's
 * picture is never quite the same twice), and the markers wobbled with it. So a match that close to
 * where the map already was (moved as the picture moved) while the picture is still is taken as
 * noise: the markers stay, only drifting a tenth of the way towards it. Moving, the match and the
 * map's own movement are averaged; far off (a jump, a zoom), the match is taken as is.
 */
const STILL_PX = 0.75
const NOISE_PX = 3.5
function steady(moved: number[] | null, m: number[], shift: [number, number] | null, width: number, height: number): number[] {
  if (!moved) return m
  const scale = Math.hypot(m[0]!, m[3]!)
  const scaleOff = Math.abs(scale - Math.hypot(moved[0]!, moved[3]!)) / scale
  // How far apart the two put the picture's middle (a zoom estimate a hair off moves the zone map's
  // far corner a lot, and what is on the screen not at all).
  const [a, b, c, d, e, f] = moved as [number, number, number, number, number, number]
  const det = a * e - b * d
  const [cx, cy] = [width / 2, height / 2]
  const zx = (e * (cx - c) - b * (cy - f)) / det
  const zy = (-d * (cx - c) + a * (cy - f)) / det
  const off = Math.hypot(m[0]! * zx + m[1]! * zy + m[2]! - cx, m[3]! * zx + m[4]! * zy + m[5]! - cy)
  if (scaleOff > 0.03 || off > 25) return m
  const still = !shift || Math.hypot(shift[0], shift[1]) < STILL_PX
  const keep = still && off < NOISE_PX && scaleOff < 0.01 ? 0.9 : 0.5
  return moved.map((v, i) => v * keep + m[i]! * (1 - keep))
}

function match(width: number, height: number, rgba: Uint8ClampedArray<ArrayBuffer>, player: [number, number] | null): { matrix: number[] | null; inliers: number; score?: number; mode: Mode } {
  const image = cv.matFromImageData(new ImageData(rgba, width, height))
  const gray = new cv.Mat()
  cv.cvtColor(image, gray, cv.COLOR_RGBA2GRAY)
  image.delete()
  // The picture's keypoints, only when they are needed (the picture compared whole did not match).
  let kps: { pts: Float32Array; desc: Cv } | null = null
  const keypoints = (): { pts: Float32Array; desc: Cv } => {
    if (kps) return kps
    const kp = new cv.KeyPointVector()
    const desc = new cv.Mat()
    // More while looking, or when the last picture was only carried by its movement (plain ground).
    const detector = orb(last && !flowRun ? FRAME_FEATURES.follow : FRAME_FEATURES.search)
    detector.detectAndCompute(gray, noMask, kp, desc)
    detector.delete()
    const pts = new Float32Array(kp.size() * 2)
    for (let i = 0; i < kp.size(); i++) {
      const p = kp.get(i).pt
      pts[i * 2] = p.x
      pts[i * 2 + 1] = p.y
    }
    kp.delete()
    return (kps = { pts, desc })
  }
  // Where the map went since the last picture: the last match, moved as the picture moved.
  const shift = last ? flowShift(gray) : null
  const moved = last && shift ? [last[0]!, last[1]!, last[2]! + shift[0], last[3]!, last[4]!, last[5]! + shift[1]] : last
  const found = (m: Placed, mode: Mode): { matrix: number[]; inliers: number; score?: number; mode: Mode } => {
    last = steady(moved, m.matrix, shift, width, height)
    foundAt = performance.now()
    lastScale = toCoarse(last)[0]!
    flowRun = 0
    return { matrix: last, inliers: m.inliers, score: m.score, mode }
  }
  try {
    if (moved && coarseGray) {
      const m = follow(gray, moved)
      if (m) return found(m, 'follow')
    }
    if (moved && keypoints().desc.rows >= MIN_INLIERS.local) {
      // Around where it should be now, then a wider look (a sharp pan, a zoom).
      for (const pad of [0.5, 1.5]) {
        const near = nearMatrix(moved, width, height, pad)
        const m = near && solve(keypoints().desc, keypoints().pts, near)
        if (m) return found(m, 'local')
      }
    }
    // Too little matched, but the picture moved as one: the map, scrolling. Carried a while.
    if (moved && shift && flowRun < FLOW_ONLY) {
      flowRun++
      last = moved
      return { matrix: moved, inliers: 0, mode: 'flow' }
    }
    last = null
    flowRun = 0
    const now = performance.now()
    // Lost: around you (the game's map opens on you), at the last size every picture, at every size now and then.
    if (player && coarseGray && coarse && ref) {
      const k = coarse.width / ref.width
      const full = now - lastNear >= (now - foundAt > IDLE_AFTER_MS ? GLOBAL_EVERY_MS.nearIdle : GLOBAL_EVERY_MS.near)
      if (full) lastNear = now
      if (full || lastScale) {
        const m = lookAround(gray, [player[0] * k, player[1] * k], full)
        if (m) return found({ ...m, matrix: fromCoarse(m.matrix) }, 'near')
      }
    }
    // The whole zone by its keypoints: seldom while where you are is known.
    const zoneEvery = now - foundAt > IDLE_AFTER_MS && player ? GLOBAL_EVERY_MS.zoneIdle : player ? GLOBAL_EVERY_MS.zoneKnown : GLOBAL_EVERY_MS.zone
    if (now - lastZone >= zoneEvery && keypoints().desc.rows >= MIN_INLIERS.local) {
      lastZone = now
      // On the shipped map (a third of the keypoints of the detail), then in the detail's pixels.
      const on = coarse ?? ref
      const m = solve(keypoints().desc, keypoints().pts, null, on)
      if (m && on && ref) {
        const k = on.width / ref.width
        const [a, b, c, d, e, f] = m.matrix as [number, number, number, number, number, number]
        return found({ matrix: [a * k, b * k, c, d * k, e * k, f], inliers: m.inliers }, 'zone')
      }
    }
    return { matrix: null, inliers: 0, mode: 'wait' }
  } finally {
    // Set inside keypoints(), which TypeScript does not follow here.
    ;(kps as { desc: Cv } | null)?.desc.delete()
    keepForFlow(gray)
  }
}

self.onmessage = async (e: MessageEvent): Promise<void> => {
  cv ??= await ready
  noMask ??= new cv.Mat()
  const msg = e.data as
    | { type: 'reference'; key: string; url: string }
    | { type: 'detail'; key: string; features?: ArrayBuffer; cols?: number; rows?: number; tiles?: ArrayBuffer[] }
    | { type: 'frame'; width: number; height: number; rgba: Uint8ClampedArray<ArrayBuffer>; player: [number, number] | null }
  if (msg.type === 'detail') {
    if (coarse?.key !== msg.key) return
    try {
      const fromTiles = !msg.features && msg.tiles && msg.cols && msg.rows
      const detail = msg.features ? unpackFeatures(msg.key, msg.features) : fromTiles ? await detailFromTiles(msg.key, msg.cols!, msg.rows!, msg.tiles!) : null
      // Still the zone it was asked for (a zone change while it was being made drops it).
      if (!detail || coarse?.key !== msg.key) return
      useReference(detail)
      self.postMessage({ type: 'reference', key: msg.key, width: detail.width, height: detail.height, detail: true })
      if (fromTiles) {
        const data = packFeatures(detail)
        self.postMessage({ type: 'features', key: msg.key, data }, { transfer: [data] })
      }
    } catch (err) {
      // The shipped map goes on being used.
      self.postMessage({ type: 'detailError', key: msg.key, error: String(err) })
    }
    return
  }
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
  // Always answered: the page sends the next picture only once this one is, and a picture OpenCV
  // threw on used to leave it waiting for good (the markers gone until the app restarted).
  try {
    const out = ref && msg.width >= 16 && msg.height >= 16 ? match(msg.width, msg.height, msg.rgba, msg.player ?? null) : { matrix: null, inliers: 0, mode: 'wait' as const }
    self.postMessage({ type: 'result', ...out, ms: Math.round(performance.now() - started) })
  } catch (err) {
    last = null
    flowRun = 0
    self.postMessage({ type: 'result', matrix: null, inliers: 0, mode: 'error', ms: Math.round(performance.now() - started), error: errorText(err) })
  }
}

/** OpenCV.js throws its C++ exceptions as numbers: their message. */
function errorText(err: unknown): string {
  if (typeof err === 'number' && cv?.exceptionFromPtr) {
    try {
      return `OpenCV: ${cv.exceptionFromPtr(err).msg}`
    } catch {
      return `OpenCV error ${err}`
    }
  }
  return String(err)
}
