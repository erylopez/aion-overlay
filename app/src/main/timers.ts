/**
 * The Timers tab's alerts: every 15 s, while the game runs, which enabled timers are inside their
 * alert window (from a few minutes before a start until 2 minutes after; shared/timers.ts). A new
 * one is announced once (the bubble chimes), and the bubble shakes while any are up. A click on the
 * bubble dismisses them until their next start.
 */
import { broadcast } from './broadcast.ts'
import { game } from './game.ts'
import { settings } from './settings.ts'
import { log, tracker } from './tracker.ts'
import { alertingStart, TIMERS, type TimerAlert } from '../shared/timers.ts'

const CHECK_MS = 15_000

let alerting: TimerAlert[] = []
/** Alerts dismissed, as `${id}@${start}`: each start alerts once. */
const done = new Set<string>()
const key = (a: TimerAlert): string => `${a.id}@${a.at}`

function check(): void {
  const now = Date.now()
  const cfg = settings.get('timers')
  // Only while the game runs (or a replay stands in for it): alerts are for playing.
  const live = game.running() || Boolean(process.env['A2T_REPLAY'])
  const next: TimerAlert[] = []
  if (live) {
    for (const def of TIMERS) {
      // Only the timers listed in the Timers tab alert: a hidden one would ring unseen.
      if (!cfg.enabled[def.id] || !cfg.shown[def.id]) continue
      const at = alertingStart(def, now, cfg.region, cfg.lead[def.id], tracker.fieldBosses())
      if (at !== null && !done.has(`${def.id}@${at}`)) next.push({ id: def.id, at })
    }
  }
  const was = new Set(alerting.map(key))
  for (const a of next) {
    if (was.has(key(a))) continue
    log(`timer: ${a.id} at ${new Date(a.at).toISOString().slice(11, 16)} UTC`)
    broadcast('timers:alert', a)
  }
  if (next.length !== alerting.length || next.some((a) => !was.has(key(a)))) {
    alerting = next
    broadcast('timers:alerting', alerting)
  }
  // Starts long gone need no remembering.
  for (const k of done) if (Number(k.split('@')[1]) < now - 86_400_000) done.delete(k)
}

export const timers = {
  alerting: (): TimerAlert[] => alerting,
  /** A click on the bubble: these alerts are seen. */
  dismiss(): void {
    if (!alerting.length) return
    for (const a of alerting) done.add(key(a))
    alerting = []
    broadcast('timers:alerting', alerting)
  },
}

export function startTimers(): void {
  check()
  setInterval(check, CHECK_MS).unref()
  settings.onChanged(() => check())
}
