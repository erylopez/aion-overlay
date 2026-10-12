/**
 * Aion2 Pet Tracker: a tray app with a floating bubble, a panel and an in-game HUD, fed by the
 * Python tracker running as a child process.
 */
import { app } from 'electron'
import { DISPLAY_NAME } from '../shared/app.ts'
import { broadcast } from './broadcast.ts'
import { startHealthWatch } from './health.ts'
import { registerIpc } from './ipc.ts'
import { settings } from './settings.ts'
import { startIdleWatch } from './idle.ts'
import { join } from 'node:path'
import { moveDataFolder, OLD_NAME } from './migrate.ts'
import { killTrackerNow, log, stopTracker, tracker } from './tracker.ts'
import { createTray, setTrayTooltip } from './tray.ts'
import { startUpdateChecks } from './update.ts'
import { applyWindowSettings, markQuitting, refreshHud, showMerchant, showPanel } from './windows.ts'

// The name is also the data folder's (%APPDATA%\<name>): the old one is moved across once.
app.setName(DISPLAY_NAME)
const migrated = moveDataFolder(join(app.getPath('appData'), OLD_NAME), app.getPath('userData'))
// Kept from the first release: Windows ties the shortcut and the updater to this id.
app.setAppUserModelId('com.xcrov.aion2-drop-tracker')

// One instance: a second launch opens the first one's panel instead.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showPanel())

  void app.whenReady().then(() => {
    if (migrated !== 'nothing to move') log(`data folder: ${migrated}`)
    startHealthWatch()
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
    startUpdateChecks()
  })

  // Tray app: closing every window is not quitting.
  app.on('window-all-closed', () => undefined)

  app.on('before-quit', () => {
    markQuitting()
    stopTracker()
  })
  // Windows children outlive their parent: make sure the tracker goes with us.
  process.on('exit', () => killTrackerNow())
}
