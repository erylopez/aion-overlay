/** Every invoke handler, typed against the contract in shared/ipc.ts. */
import { app, ipcMain, shell } from 'electron'
import { mkdir } from 'node:fs/promises'
import { dummy } from './dummy.ts'
import { updater } from './updater.ts'
import { meterState } from './meter.ts'
import { characterStore } from './characters.ts'
import { gameMap, regionDisplay } from './gameMap.ts'
import { mapDetail } from './gameMapDetail.ts'
import { lokthar } from './lokthar.ts'
import { packets } from './packets.ts'
import { settings } from './settings.ts'
import { sounds } from './sounds.ts'
import { timers } from './timers.ts'
import { logPath, tracker } from './tracker.ts'
import {
  bubbleDragEnded,
  buffsDragEnded,
  ccDragEnded,
  enemiesDragEnded,
  moveTraining,
  resizeTraining,
  trainingDragEnded,
  moveCc,
  moveEnemies,
  resizeCc,
  resizePacketsHud,
  resizeEnemies,
  moveBuffs,
  resizeBuffs,
  closeDetails,
  detailsDragEnded,
  detailsSource,
  closeMerchant,
  hidePanel,
  hudDragEnded,
  killFeedDragEnded,
  markQuitting,
  merchantDragEnded,
  minimizePanel,
  toggleMaximizePanel,
  openDetails,
  meterDragEnded,
  moveBubble,
  moveDetails,
  moveHud,
  moveKillFeed,
  moveMerchant,
  moveMeter,
  moveMiniMap,
  miniMapDragEnded,
  moveSkills,
  moveTimerBar,
  resizeHud,
  resizeKillFeed,
  resizeMerchant,
  resizeMeter,
  resizeMiniMap,
  resizeSkills,
  resizeTimerBar,
  setHudEditing,
  setKillFeedOpen,
  skillsDragEnded,
  showPetInPanel,
  showTimersInPanel,
  timerBarDragEnded,
  togglePanel,
  toggleOverlays,
  overlaysHidden,
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

/** A saved fight's id: one file name, nothing that leaves the history folder. */
const isPlainId = (id: unknown): id is string => typeof id === 'string' && /^[\w.-]{1,128}$/.test(id) && !id.includes('..')

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

  handle('tracker:get', () => ({ status: tracker.status(), pets: tracker.pets(), nearby: tracker.nearby(), shop: tracker.shop(), kina: tracker.kina(), fieldBosses: tracker.fieldBosses(), pvp: tracker.pvp(), cubes: tracker.cubes(), enemies: tracker.enemies(), target: tracker.target() }))
  handle('tracker:clearPvp', () => tracker.clearPvp())
  handle('timerbar:moveTo', (to) => {
    if (isPoint(to)) moveTimerBar(to)
  })
  handle('timerbar:dragEnd', () => timerBarDragEnded())
  handle('timerbar:resize', (size) => {
    if (isPoint({ x: size?.width, y: size?.height })) resizeTimerBar(size)
  })
  handle('killfeed:open', () => setKillFeedOpen(true))
  handle('killfeed:close', () => setKillFeedOpen(false))
  handle('killfeed:moveTo', (to) => {
    if (isPoint(to)) moveKillFeed(to)
  })
  handle('killfeed:dragEnd', () => killFeedDragEnded())
  handle('killfeed:resize', (size) => {
    if (isPoint({ x: size?.width, y: size?.height })) resizeKillFeed(size)
  })
  handle('tracker:setSouls', (pet, souls) => {
    if (Number.isInteger(pet) && Number.isInteger(souls) && souls >= 0 && souls < 100000) tracker.setSouls(pet, souls)
  })
  handle('tracker:setName', (pet, name) => {
    if (Number.isInteger(pet) && typeof name === 'string' && name.trim()) tracker.setName(pet, name.trim().slice(0, 60))
  })
  handle('tracker:restart', () => tracker.restart())
  handle('gamemap:pick', () => gameMap.pick())
  handle('gamemap:setRegion', (box) => gameMap.setRegion(box && isPoint({ x: box.width, y: box.height }) && isPoint(box) ? box : null))
  handle('gamemap:report', (state) => {
    if (state && typeof state.status === 'string') gameMap.report(state)
  })
  handle('gamemap:get', () => gameMap.state())
  handle('gamemap:restart', () => gameMap.restart())
  handle('gamemap:display', () => regionDisplay())
  handle('gamemap:detail', (key, cols, rows) => mapDetail.get(String(key), Number(cols), Number(rows)))
  handle('gamemap:saveFeatures', (key, data) => mapDetail.saveFeatures(String(key), data))
  handle('characters:get', () => characterStore.all())
  handle('characters:refresh', (id) => characterStore.refresh(id))
  handle('characters:forget', (id) => characterStore.forget(id))
  handle('lokthar:test', () => lokthar.test())
  handle('lokthar:sync', () => lokthar.syncNow())
  handle('lokthar:last', () => lokthar.last())
  handle('tracker:resetSession', () => tracker.resetSession())

  handle('bubble:moveTo', (to) => {
    if (isPoint(to)) moveBubble(to)
  })
  handle('bubble:dragEnd', () => bubbleDragEnded())
  handle('panel:toggle', () => togglePanel())
  handle('panel:hide', () => hidePanel())
  handle('panel:minimize', () => minimizePanel())
  handle('panel:maximize', () => toggleMaximizePanel())

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

  handle('meter:get', () => meterState.meter())
  handle('meter:reset', () => meterState.reset())
  handle('minimap:moveTo', (to) => {
    if (isPoint(to)) moveMiniMap(to)
  })
  handle('minimap:dragEnd', () => miniMapDragEnded())
  handle('minimap:resize', (size) => {
    if (isPoint({ x: size?.width, y: size?.height })) resizeMiniMap(size)
  })
  handle('skills:get', () => meterState.personal())
  handle('skills:moveTo', (to) => {
    if (isPoint(to)) moveSkills(to)
  })
  handle('skills:dragEnd', () => skillsDragEnded())
  handle('skills:resize', (size) => {
    if (isPoint({ x: size?.width, y: size?.height })) resizeSkills(size)
  })
  handle('update:get', () => updater.get())
  handle('update:peek', () => updater.peek())
  handle('update:check', () => updater.check())
  handle('update:download', () => updater.download())
  handle('update:install', () => updater.install())
  handle('dummy:get', () => dummy.get())
  handle('dummy:start', (name) => dummy.start(typeof name === 'string' ? name : undefined))
  handle('dummy:stop', (save) => dummy.stop(save === true))
  handle('training:moveTo', (to) => {
    if (isPoint(to)) moveTraining(to)
  })
  handle('training:dragEnd', () => trainingDragEnded())
  handle('training:resize', (size) => {
    if (isPoint({ x: size?.width, y: size?.height })) resizeTraining(size)
  })
  handle('dummy:newGroup', () => dummy.newGroup())
  handle('dummy:delete', (id) => {
    if (typeof id === 'string') dummy.remove(id)
  })
  handle('recordings:get', () => meterState.recordings())
  handle('packets:get', () => packets.get())
  handle('packets:set', (on) => packets.set(on === true))
  handle('packets:mark', (text) => packets.mark(typeof text === 'string' ? text : ''))
  handle('packets:show', () => packets.show())
  handle('sounds:pickCustom', (slot) => sounds.pickCustom(slot))
  handle('sounds:custom', (slot) => sounds.custom(slot))
  handle('recordings:set', (on) => meterState.record(on === true))
  handle('recordings:open', async () => {
    const dir = meterState.recordingsDir()
    if (!dir) return
    await mkdir(dir, { recursive: true })
    await shell.openPath(dir)
  })
  handle('overlays:toggle', () => toggleOverlays())
  handle('overlays:hidden', () => overlaysHidden())
  handle('buffs:get', () => meterState.buffs())
  handle('cc:moveTo', (to) => {
    if (isPoint(to)) moveCc(to)
  })
  handle('cc:dragEnd', () => ccDragEnded())
  handle('enemies:moveTo', (to) => {
    if (isPoint(to)) moveEnemies(to)
  })
  handle('enemies:dragEnd', () => enemiesDragEnded())
  handle('enemies:resize', (size) => {
    if (isPoint({ x: size?.width, y: size?.height })) resizeEnemies(size)
  })
  handle('cc:resize', (size) => {
    if (isPoint({ x: size?.width, y: size?.height })) resizeCc(size)
  })
  handle('packets:resize', (size) => {
    if (isPoint({ x: size?.width, y: size?.height })) resizePacketsHud(size)
  })
  handle('buffs:moveTo', (to) => {
    if (isPoint(to)) moveBuffs(to)
  })
  handle('buffs:dragEnd', () => buffsDragEnded())
  handle('buffs:resize', (size) => {
    if (isPoint({ x: size?.width, y: size?.height })) resizeBuffs(size)
  })
  handle('details:open', (source) => {
    const ok = source?.kind === 'live' ? Number.isInteger(source.target) : (source?.kind === 'saved' || source?.kind === 'run' || source?.kind === 'pvp') && isPlainId(source.id)
    if (ok) openDetails(source)
  })
  handle('details:get', () => {
    const source = detailsSource()
    if (source?.kind === 'run') return dummy.details(source.id)
    return source ? meterState.details(source) : null
  })
  handle('details:close', () => closeDetails())
  handle('details:moveTo', (to) => {
    if (isPoint(to)) moveDetails(to)
  })
  handle('details:dragEnd', () => detailsDragEnded())
  handle('history:list', () => meterState.history())
  handle('history:delete', (id) => {
    if (isPlainId(id)) meterState.deleteFight(id)
  })
  handle('meter:moveTo', (to) => {
    if (isPoint(to)) moveMeter(to)
  })
  handle('meter:dragEnd', () => meterDragEnded())
  handle('meter:resize', (size) => {
    if (isPoint({ x: size?.width, y: size?.height })) resizeMeter(size)
  })
}
