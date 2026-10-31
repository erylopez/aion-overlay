/**
 * `<userData>/logs/gamemap.log`: everything about the markers on the game's map (main/gameMap.ts):
 * the screen capture starting or failing, the zone's detail being had, the map found or lost, and
 * what went wrong. Its lines also go to the app's log (tracker.log). Kept across launches, each
 * one headed by a line, and started afresh past LIMIT (the last one kept as gamemap.old.log).
 */
import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { log } from './tracker.ts'

const LIMIT = 2 * 1_048_576

export function gameMapLogPath(): string {
  return join(app.getPath('userData'), 'logs', 'gamemap.log')
}

let started = false
export function glog(line: string): void {
  log(`game map: ${line}`)
  const file = gameMapLogPath()
  try {
    if (!started) {
      mkdirSync(dirname(file), { recursive: true })
      if (existsSync(file) && statSync(file).size > LIMIT) renameSync(file, join(dirname(file), 'gamemap.old.log'))
      appendFileSync(file, `\n=== ${new Date().toISOString()} Lokthar ${app.getVersion()} (${app.isPackaged ? 'installed' : 'development'})\n`)
      started = true
    }
    appendFileSync(file, `${new Date().toISOString()} ${line}\n`)
  } catch {
    // A log that cannot be written must not stop the markers.
  }
}
