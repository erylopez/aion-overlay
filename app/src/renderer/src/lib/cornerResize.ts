/**
 * Resize an overlay by dragging its corner, like an app window: the pointer's screen position gives
 * the new size (the window itself grows through main, from the size the page reports). The size is
 * the caller's to apply while dragging and to save once, on release.
 */

export interface Size {
  width: number
  height: number
}

export interface CornerResizeOptions {
  /** The size when the drag starts. */
  start: () => Size
  /** Each move: the size now, and whether the pointer has gone up or down yet (past a few pixels). */
  move: (size: Size, vertical: boolean) => void
  /** Released. */
  end: () => void
}

/** Past this many pixels up or down, a drag sizes the height too. */
const VERTICAL_SLOP = 4

export function cornerResize(opts: CornerResizeOptions): (e: PointerEvent) => void {
  return (e: PointerEvent): void => {
    if (e.button !== 0) return
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const start = opts.start()
    const x = e.screenX
    const y = e.screenY
    let vertical = false
    const onMove = (ev: PointerEvent): void => {
      vertical ||= Math.abs(ev.screenY - y) > VERTICAL_SLOP
      opts.move({ width: start.width + ev.screenX - x, height: start.height + ev.screenY - y }, vertical)
    }
    const onUp = (ev: PointerEvent): void => {
      el.releasePointerCapture(ev.pointerId)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      opts.end()
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }
}

export const clampTo = (v: number, [lo, hi]: readonly [number, number]): number => Math.round(Math.min(hi, Math.max(lo, v)))
