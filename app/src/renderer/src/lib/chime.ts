/**
 * The timers' alert: a soft two-note chime (E5 then A5), made with Web Audio so there is no sound
 * file to ship. Each note rises in 20 ms and fades out over most of a second.
 */
let ctx: AudioContext | null = null

export function playChime(volume = 0.5): void {
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  const t0 = ctx.currentTime + 0.02
  ;[659.25, 880].forEach((freq, i) => {
    const osc = ctx!.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = freq
    const gain = ctx!.createGain()
    const start = t0 + i * 0.18
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(0.2 * Math.min(1, Math.max(0, volume)), start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.9)
    osc.connect(gain).connect(ctx!.destination)
    osc.start(start)
    osc.stop(start + 1)
  })
}
