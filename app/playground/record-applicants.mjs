// Records a short, widget-only video of the Join requests widget (no captions) for sharing:
//   node playground/record-applicants.mjs [out.mp4]      (npm run playground must be up)
// A few people apply one after another (each slides in), one is taken off the list with its X.
import { join } from 'node:path'
import { startRecording } from './recorder.mjs'

const OUT = process.argv[2] ?? join(process.env.HOME ?? '.', 'Videos', 'lokthar-applicants.mp4')
const W = 900
const H = 520
const r = await startRecording({
  out: OUT,
  width: W,
  height: H,
  url: (slow) => `http://localhost:5199/applicants.html?slow=${slow}&bare=1`,
  // The widget sits at the top left of the page (its own 6 px margin).
  clip: { x: 0, y: 0, width: 340, height: 252 },
  scaleTo: 680,
})
const { wait, glide, click, rectOf, evaluate } = r
const sim = (call) => evaluate(`window.promo.sim.${call}`)

await wait(0.8)
for (let i = 0; i < 4; i++) {
  await sim('apply()')
  await wait(1.5)
}
// Take the third off the list.
const row = await evaluate(`(() => { const r = [...document.querySelectorAll('li')][2]?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null })()`)
await glide(row.x, row.y, 0.8)
await wait(0.4)
const x = await rectOf('button[title="Remove from the list"]')
if (x) {
  const at = await evaluate(`(() => { const b = [...document.querySelectorAll('li')][2]?.querySelector('button'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  await glide(at.x, at.y, 0.5)
  await click()
}
await wait(1.2)
await glide(600, 460, 0.8)
await sim('apply()')
await wait(2.2)
await r.finish()
