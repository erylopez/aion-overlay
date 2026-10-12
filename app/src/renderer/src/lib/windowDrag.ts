/**
 * Drag a whole window by one of its elements, and tell a click from a drag.
 *
 * marnis-app drags overlay elements inside a window; here the bubble and the HUD *are* the window,
 * so the pointer's screen position moves the window itself (through main, which clamps it onto a
 * display). Under CLICK_SLOP pixels of travel it is a click, not a drag. The position is saved
 * once, on release, not on every move.
 */
import type { Bridge } from '@shared/ipc.ts'
import { bridge } from './bridge.ts'

const CLICK_SLOP = 4

export interface WindowDragOptions {
  move: 'bubble:moveTo' | 'hud:moveTo' | 'merchant:moveTo'
  end: 'bubble:dragEnd' | 'hud:dragEnd' | 'merchant:dragEnd'
  onClick?: () => void
}

export function windowDrag(opts: WindowDragOptions): {
  onPointerDown: (e: PointerEvent) => void
  onPointerUp: (e: PointerEvent) => void
} {
  const api: Bridge = bridge()
  /** A press this window saw, whose release it is waiting for. */
  let pressed = false

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return
    pressed = true
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    // Where in the window the pointer grabbed it: the window keeps that point under the pointer.
    const grabX = e.clientX
    const grabY = e.clientY
    const startX = e.screenX
    const startY = e.screenY
    let dragging = false
    let frame = 0
    let last: PointerEvent | null = null

    const flush = (): void => {
      frame = 0
      if (last) void api.invoke(opts.move, { x: last.screenX - grabX, y: last.screenY - grabY })
    }
    const onMove = (ev: PointerEvent): void => {
      if (!dragging && Math.hypot(ev.screenX - startX, ev.screenY - startY) < CLICK_SLOP) return
      dragging = true
      last = ev
      frame ||= requestAnimationFrame(flush)
    }
    const onUp = (ev: PointerEvent): void => {
      el.releasePointerCapture(ev.pointerId)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      // Cleared after this event has finished, so onPointerUp below can tell this release apart.
      setTimeout(() => (pressed = false), 0)
      if (frame) cancelAnimationFrame(frame)
      if (dragging) {
        last = ev
        flush()
        void api.invoke(opts.end)
      } else if (ev.type === 'pointerup') {
        opts.onClick?.()
      }
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }

  /**
   * A release with no press before it: Windows ate the press (it does on a window it will not
   * activate while another app is in front). A drag cannot end here without starting here, so
   * this can only be a click.
   */
  function onPointerUp(e: PointerEvent): void {
    if (e.button !== 0 || pressed) return
    opts.onClick?.()
  }

  return { onPointerDown, onPointerUp }
}
