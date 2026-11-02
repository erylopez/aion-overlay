/**
 * Where you last died, drawn on the maps: a white skull on a dark disc ringed red. In a 16 × 16
 * box centred on (8, 8), for SVG (WorldMap, the kill feed's map) and the canvas (Map V2) alike.
 */
export const SKULL = {
  /** The disc behind it: centre and radius. */
  disc: [8, 8, 8] as const,
  head: 'M8 2.6C5.2 2.6 3.4 4.6 3.4 7c0 1.5.7 2.6 1.7 3.2v1.7c0 .4.3.7.7.7h4.4c.4 0 .7-.3.7-.7v-1.7c1-.6 1.7-1.7 1.7-3.2 0-2.4-1.8-4.4-4.6-4.4z',
  eyes: [
    [6.3, 7.3, 1.15],
    [9.7, 7.3, 1.15],
  ] as const,
  nose: 'M8 8.7l-.65 1.2h1.3z',
  teeth: 'M6.9 11.2v1.4M8 11.2v1.4M9.1 11.2v1.4',
  colors: { disc: 'rgba(24,24,27,0.85)', ring: '#ef4444', bone: '#f4f4f5', ink: '#18181b' },
}

/** The skull on a canvas, `size` pixels across, centred on (x, y). */
export function drawSkull(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.save()
  ctx.translate(x - size / 2, y - size / 2)
  ctx.scale(size / 16, size / 16)
  const [cx, cy, r] = SKULL.disc
  ctx.beginPath()
  ctx.arc(cx, cy, r - 0.6, 0, Math.PI * 2)
  ctx.fillStyle = SKULL.colors.disc
  ctx.fill()
  ctx.lineWidth = 1.2
  ctx.strokeStyle = SKULL.colors.ring
  ctx.stroke()
  ctx.fillStyle = SKULL.colors.bone
  ctx.fill(new Path2D(SKULL.head))
  ctx.fillStyle = SKULL.colors.ink
  for (const [ex, ey, er] of SKULL.eyes) {
    ctx.beginPath()
    ctx.arc(ex, ey, er, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fill(new Path2D(SKULL.nose))
  ctx.lineWidth = 0.5
  ctx.strokeStyle = SKULL.colors.ink
  ctx.stroke(new Path2D(SKULL.teeth))
  ctx.restore()
}
