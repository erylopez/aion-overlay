/**
 * Whether the Black Cloud Merchant's screen is still up, told by looking at the screen: the game
 * says nothing when the shop is closed, and its keys (Escape) are hidden from the app (the game
 * runs as administrator). A small grey picture of the screen is kept right after a tab opens, and
 * kept up to date while the screen stays much the same (the cards filling in, a tooltip); once most
 * of the screen differs from it, twice in a row, the shop is gone (about half a second). The merchant window's own
 * spot is left out (it changes with the tabs). Only while the merchant window is open: it stops when
 * the window closes (its X, the setting off), and takes no pictures while the window is hidden or
 * the game is not in front (an alt-tab away and back takes the picture again).
 */
import { desktopCapturer, screen, type Rectangle } from 'electron'

/** The picture: small, and smoothed by the shrinking (an item's tooltip, a player walking by, barely count). */
const W = 64
const H = 36
const EVERY_MS = 250
/** The tab's packet comes as its screen shows: a moment for it to be drawn before its picture is taken. */
const SETTLE_MS = 300
/** The screen still the shop's: this share of it changed at most, and the picture is taken again. */
const SAME_SHARE = 0.15
/** A spot changed: its grey moved this much (0-255). */
const SPOT_DIFF = 28
/** The shop is gone: this share of the screen changed... */
const GONE_SHARE = 0.4
/** ...this many looks in a row. */
const GONE_LOOKS = 2

interface Watch {
  open: () => boolean
  /** The merchant window's place while it shows, else null (nothing to close: not looked at). */
  window: () => Rectangle | null
  gameInFront: () => boolean
  gone: (share: number) => void
}

let watch: Watch | null = null
let timer: NodeJS.Timeout | null = null
let reference: Int16Array | null = null
let since = 0
let looks = 0
let busy = false

/** A tab of the shop opened: look from now on, against a picture taken once it settles. */
export function watchShopScreen(w: Watch): void {
  watch = w
  reference = null
  since = Date.now()
  looks = 0
  timer ??= setInterval(() => void look(), EVERY_MS)
}

export function stopShopScreen(): void {
  if (timer) clearInterval(timer)
  timer = null
  watch = null
  reference = null
}

async function look(): Promise<void> {
  if (!watch || busy) return
  if (!watch.open()) return stopShopScreen()
  const window = watch.window()
  if (!window || !watch.gameInFront()) {
    reference = null
    since = Date.now()
    looks = 0
    return
  }
  if (Date.now() - since < SETTLE_MS) return
  busy = true
  try {
    const now = await picture(window)
    if (!now || !watch) return
    if (!reference || reference.length !== now.length) {
      reference = now
      return
    }
    let changed = 0
    let counted = 0
    for (let i = 0; i < now.length; i++) {
      if (now[i]! < 0 || reference[i]! < 0) continue
      counted++
      if (Math.abs(now[i]! - reference[i]!) > SPOT_DIFF) changed++
    }
    const share = counted ? changed / counted : 0
    looks = share >= GONE_SHARE ? looks + 1 : 0
    if (share <= SAME_SHARE) reference = now
    if (looks >= GONE_LOOKS) {
      const gone = watch.gone
      stopShopScreen()
      gone(share)
    }
  } catch {
    // No picture this time (the screen locked, a display going away): the next look tries again.
  } finally {
    busy = false
  }
}

/** The screen the merchant window is on, W × H grey, with the window's own spot as -1. */
async function picture(hole: Rectangle): Promise<Int16Array | null> {
  const display = screen.getDisplayMatching(hole)
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: W * 2, height: H * 2 } })
  const shot = (sources.find((s) => s.display_id === String(display.id)) ?? sources[0])?.thumbnail
  if (!shot || shot.isEmpty()) return null
  const bgra = shot.resize({ width: W, height: H, quality: 'good' }).toBitmap()
  if (bgra.length !== W * H * 4) return null
  const b = display.bounds
  // A spot's worth around it too: the spots the window's edge cuts through change with it.
  const padX = b.width / W
  const padY = b.height / H
  const out = new Int16Array(W * H)
  for (let y = 0; y < H; y++) {
    const sy = b.y + ((y + 0.5) * b.height) / H
    for (let x = 0; x < W; x++) {
      const sx = b.x + ((x + 0.5) * b.width) / W
      const inHole = sx >= hole.x - padX && sx < hole.x + hole.width + padX && sy >= hole.y - padY && sy < hole.y + hole.height + padY
      const i = (y * W + x) * 4
      out[y * W + x] = inHole ? -1 : Math.round(0.114 * bgra[i]! + 0.587 * bgra[i + 1]! + 0.299 * bgra[i + 2]!)
    }
  }
  return out
}
