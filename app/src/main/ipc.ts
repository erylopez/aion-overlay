/** Every invoke handler, typed against the contract in shared/ipc.ts. */
import { app, ipcMain, shell } from 'electron'
import { lokthar } from './lokthar.ts'
import { settings } from './settings.ts'
import { timers } from './timers.ts'
import { logPath, tracker } from './tracker.ts'
import {
  bubbleDragEnded,
  closeMerchant,
  hidePanel,
  hudDragEnded,
  markQuitting,
  merchantDragEnded,
  moveBubble,
  moveHud,
  moveMerchant,
  resizeHud,
  resizeMerchant,
  setHudEditing,
  setPanelExpanded,
  showPetInPanel,
  showTimersInPanel,
  togglePanel,
} from './windows.ts'
import type { InvokeArgs, InvokeChannel, InvokeResult } from '../shared/ipc.ts'
import type { SettingKey } from '../shared/settings.ts'
import { SETTINGS_DEFAULTS } from '../shared/settings.ts'

function handle<C extends InvokeChannel>(
  channel: C,
  fn: (...args: InvokeArgs<C>) => InvokeResult<C> | Promise<InvokeResult<C>>,
): void {
  ipcMain.handle(channel, (_event, ...args) => fn(...(args as InvokeArgs<C>)))
}

const isPoint = (p: unknown): p is { x: number; y: number } =>
  typeof p === 'object' && p !== null && Number.isFinite((p as { x: unknown }).x) && Number.isFinite((p as { y: unknown }).y)

export function registerIpc(): void {
  handle('app:info', () => ({ version: app.getVersion(), settingsFile: settings.path, logFile: logPath() }))
  handle('app:quit', () => {
    markQuitting()
    app.quit()
  })
  handle('app:openPath', (path) => {
    // Only the app's own files: the settings and the collection.
    const allowed = [settings.path, tracker.status().dataFile, logPath()].filter(Boolean)
    if (allowed.includes(path)) shell.showItemInFolder(path)
  })

  handle('settings:all', () => settings.all())
  handle('settings:set', (key, value) => {
    if (!(key in SETTINGS_DEFAULTS)) return
    settings.set(key as SettingKey, value)
  })

  handle('tracker:get', () => ({ status: tracker.status(), pets: tracker.pets(), nearby: tracker.nearby(), shop: tracker.shop(), kina: tracker.kina(), fieldBosses: tracker.fieldBosses() }))
  handle('tracker:setSouls', (pet, souls) => {
    if (Number.isInteger(pet) && Number.isInteger(souls) && souls >= 0 && souls < 100000) tracker.setSouls(pet, souls)
  })
  handle('tracker:setName', (pet, name) => {
    if (Number.isInteger(pet) && typeof name === 'string' && name.trim()) tracker.setName(pet, name.trim().slice(0, 60))
  })
  handle('tracker:restart', () => tracker.restart())
  handle('lokthar:test', () => lokthar.test())
  handle('lokthar:last', () => lokthar.last())
  handle('tracker:resetSession', () => tracker.resetSession())

  handle('bubble:moveTo', (to) => {
    if (isPoint(to)) moveBubble(to)
  })
  handle('bubble:dragEnd', () => bubbleDragEnded())
  handle('panel:toggle', () => togglePanel())
  handle('panel:hide', () => hidePanel())
  handle('panel:setExpanded', (expanded) => setPanelExpanded(Boolean(expanded)))

  handle('hud:setEditing', (editing) => setHudEditing(Boolean(editing)))
  handle('hud:moveTo', (to) => {
    if (isPoint(to)) moveHud(to)
  })
  handle('hud:dragEnd', () => hudDragEnded())
  handle('hud:resize', (size) => {
    if (isPoint({ x: size?.width, y: size?.height })) resizeHud(size)
  })

  handle('merchant:moveTo', (to) => {
    if (isPoint(to)) moveMerchant(to)
  })
  handle('merchant:dragEnd', () => merchantDragEnded())
  handle('merchant:resize', (size) => {
    if (isPoint({ x: size?.width, y: size?.height })) resizeMerchant(size)
  })
  handle('merchant:close', () => closeMerchant())
  handle('timers:get', () => timers.alerting())
  handle('timers:dismiss', () => timers.dismiss())
  handle('timers:open', () => {
    const ids = timers.alerting().map((a) => a.id)
    timers.dismiss()
    showTimersInPanel(ids)
  })
  handle('panel:showPet', (pet) => {
    if (Number.isInteger(pet)) showPetInPanel(pet)
  })
}
