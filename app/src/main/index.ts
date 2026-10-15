/**
 * Lokthar (an Aion 2 overlay: pet collection, timers, the guild's field boss sync): a tray app with a floating bubble, a panel and an in-game HUD, fed by the
 * Python tracker running as a child process.
 */
import { app, session } from 'electron'
import { DISPLAY_NAME } from '../shared/app.ts'
import { broadcast } from './broadcast.ts'
import { startFieldBosses } from './fieldBosses.ts'
import { startHealthWatch } from './health.ts'
import { registerIpc } from './ipc.ts'
import { settings } from './settings.ts'
import { startIdleWatch } from './idle.ts'
import { startLokthar } from './lokthar.ts'
import { join } from 'node:path'
import { moveDataFolder, OLD_NAMES } from './migrate.ts'
import { startTimers } from './timers.ts'
import { killTrackerNow, log, stopTracker, tracker } from './tracker.ts'
import { createTray, setTrayTooltip } from './tray.ts'
import { applyWindowSettings, markQuitting, refreshHud, showMerchant, showPanel, startOnTopWatch } from './windows.ts'

// The name is also the data folder's (%APPDATA%\<name>): the old one is moved across once.
app.setName(DISPLAY_NAME)
const migrated = OLD_NAMES.map((name) => moveDataFolder(join(app.getPath('appData'), name), app.getPath('userData')))
  .filter((m) => m !== 'nothing to move')
  .join('; ')
// Kept from the first release: Windows ties the shortcut to this id.
app.setAppUserModelId('com.xcrov.aion2-drop-tracker')

// One instance: a second launch opens the first one's panel instead.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showPanel())

  void app.whenReady().then(() => {
    if (migrated) log(`data folder: ${migrated}`)
    blockNetwork()
    startHealthWatch()
    startFieldBosses()
    startLokthar()
    startOnTopWatch()
    registerIpc()
    createTray()

    settings.onChanged((all) => {
      broadcast('settings:changed', all)
      applyWindowSettings()
    })
    // A tab of the Black Cloud Merchant was opened: its pets worth buying, in their own window.
    tracker.onShop(() => showMerchant())
    tracker.onStatus((status) => {
      refreshHud()
      const what = {
        starting: 'starting…',
        listening: 'waiting for the game',
        locked: status.gameActive ? 'tracking' : 'connected, no game traffic',
        idle: 'asleep until Aion 2 starts',
        stopped: 'replay finished',
        error: 'error',
        exited: 'restarting',
      }[status.state]
      setTrayTooltip(`${DISPLAY_NAME}: ${what}`)
    })

    // The bubble, the HUD and the tracker, once it is known whether the game is running.
    void startIdleWatch()
    startTimers()
  })

  /**
   * No network: the windows only ever load the app's own files, so any http(s) or websocket
   * request from them (a stray URL, a library reaching out) is cancelled, on top of index.html's
   * CSP. A development run still reaches its local Vite server. Links the user clicks open in the
   * browser (windows.ts) and are not affected, nor is the Lokthar sync, which is off unless turned
   * on and goes from the main process to the one address in Settings (lokthar.ts).
   */
  function blockNetwork(): void {
    const filter = { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }
    session.defaultSession.webRequest.onBeforeRequest(filter, (details, done) => {
      const host = new URL(details.url).hostname
      const devServer = !app.isPackaged && (host === 'localhost' || host === '127.0.0.1')
      if (!devServer) log(`network: blocked ${details.url}`)
      done({ cancel: !devServer })
    })
  }

  // Tray app: closing every window is not quitting.
  app.on('window-all-closed', () => undefined)

  app.on('before-quit', () => {
    markQuitting()
    stopTracker()
  })
  // Windows children outlive their parent: make sure the tracker goes with us.
  process.on('exit', () => killTrackerNow())
}
