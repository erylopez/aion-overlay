/**
 * App updates, the way marnis-app does them: electron-updater against a static feed on the same
 * host (`https://nyerk.app/updates/`, set in electron-builder.yml and baked into the build
 * as app-update.yml).
 *
 * Prompted, never silent: no automatic download and no install on quit. A check runs 30 s after
 * start and every 6 hours while Settings allows it; the panel offers Download, then Restart to
 * install. A development run has no feed and says so.
 */
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { broadcast } from './broadcast.ts'
import { settings } from './settings.ts'
import { machineHash } from './machine.ts'
import { log } from './tracker.ts'
import { markQuitting } from './windows.ts'
import { initialUpdateStatus, type UpdateStatus } from '../shared/update.ts'

const INITIAL_DELAY_MS = 30_000
const INTERVAL_MS = 6 * 60 * 60 * 1000

let status: UpdateStatus = initialUpdateStatus(app.getVersion())
let wired = false
let timer: NodeJS.Timeout | null = null

function set(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch }
  broadcast('update:status', status)
}

function wire(): void {
  if (wired) return
  wired = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  // The server's gate (aion2-api) keys its ban list on this: see machine.ts.
  autoUpdater.requestHeaders = { 'X-A2-Machine': machineHash() }
  // Without a logger the library writes to a console nobody sees in an installed build.
  autoUpdater.logger = {
    info: (m: unknown) => log(`update: ${String(m)}`),
    warn: (m: unknown) => log(`update warning: ${String(m)}`),
    error: (m: unknown) => log(`update error: ${String(m)}`),
    debug: () => undefined,
  }
  autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: null }))
  autoUpdater.on('update-available', (info) => set({ state: 'available', version: info.version, checkedAt: Date.now() }))
  autoUpdater.on('update-not-available', () => set({ state: 'none', version: null, checkedAt: Date.now() }))
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version, percent: 100 }))
  autoUpdater.on('error', (err) => set({ state: 'error', error: err?.message ?? String(err), checkedAt: Date.now() }))
}

export const updates = {
  status: (): UpdateStatus => status,

  async check(): Promise<void> {
    if (!app.isPackaged) {
      set({ state: 'unsupported' })
      return
    }
    // Never check over a download in progress or one waiting to be installed.
    if (status.state === 'downloading' || status.state === 'ready' || status.state === 'checking') return
    wire()
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      set({ state: 'error', error: (err as Error).message, checkedAt: Date.now() })
    }
  },

  async download(): Promise<void> {
    if (status.state !== 'available') return
    set({ state: 'downloading', percent: 0 })
    try {
      await autoUpdater.downloadUpdate()
    } catch (err) {
      set({ state: 'error', error: (err as Error).message })
    }
  },

  install(): void {
    if (status.state !== 'ready') return
    log(`update: restarting to install ${status.version}`)
    // As in marnis-app: mark the quit as meant, or the tray app's close handling cancels it and
    // the new version bounces off the single-instance lock back to the old one. Silent install,
    // relaunched afterwards: the click on Restart was the consent.
    markQuitting()
    autoUpdater.quitAndInstall(true, true)
  },
}

/** Start the periodic checks (installed builds only, while the setting allows). */
export function startUpdateChecks(): void {
  if (!app.isPackaged) {
    set({ state: 'unsupported' })
    return
  }
  const tick = (): void => {
    if (settings.get('autoUpdateCheck')) void updates.check()
  }
  setTimeout(tick, INITIAL_DELAY_MS).unref()
  timer = setInterval(tick, INTERVAL_MS)
  timer.unref()
}
