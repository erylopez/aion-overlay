/**
 * The app was renamed twice, and its data folder with it: "Aion 2 Drop Tracker" became "Aion2 Pet
 * Tracker" in 0.1.11, and that became "Nyerk" in 0.2.0. On the first start after a rename the old
 * folder is moved across whole (collection, settings, logs, the updater's id, the field bosses),
 * before anything reads or writes the new one. If it cannot be moved, the collection and settings
 * are copied instead and the old folder is left as it was. index.ts calls it right after
 * app.setName(), before the single-instance lock or anything else uses the folder. (No Electron
 * import here, so the tests can run it.)
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** The data folders of older names, newest first: an install that skipped versions has the oldest. */
export const OLD_NAMES = ['Aion2 Pet Tracker', 'Aion 2 Drop Tracker']

/**
 * Move the app's own files from `from` into `to`, drop the rest (Chromium's caches and state, which
 * it rebuilds), and remove `from` once it is empty. Returns what was done, for the log.
 *
 * By the time the app's code runs, Chromium has already made the new folder and is writing its own
 * files there (seen 2026-10-10), so the old folder cannot be renamed into place, and moving
 * Chromium's files across races it ("Local State" came out as "Local State.bad"). An app file the
 * new folder has already is never overwritten or deleted: the old one stays, and so does the old
 * folder.
 */
export function moveDataFolder(from: string, to: string): string {
  if (from === to || !existsSync(from)) return 'nothing to move'
  if (!existsSync(to)) {
    try {
      renameSync(from, to)
      return `moved ${from} to ${to}`
    } catch {
      // Something holds a file in it open: file by file, below.
    }
  }
  mkdirSync(to, { recursive: true })
  const moved: string[] = []
  const left: string[] = []
  for (const name of readdirSync(from)) {
    const src = join(from, name)
    try {
      if (!APP_FILES.includes(name)) rmSync(src, { recursive: true, force: true })
      else if (existsSync(join(to, name))) left.push(name)
      else {
        renameSync(src, join(to, name))
        moved.push(name)
      }
    } catch {
      left.push(name)
    }
  }
  if (!left.length) rmSync(from, { recursive: true, force: true })
  return `moved ${moved.join(', ') || 'nothing'} from ${from} to ${to}` + (left.length ? `; left there: ${left.join(', ')}` : '; removed the old folder')
}

/** The app's own files in its data folder; everything else there is Chromium's. */
const APP_FILES = ['collection.json', 'settings.json', 'logs', '.updaterId', 'fieldbosses.json', 'machine-id']
