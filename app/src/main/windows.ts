/**
 * The app's three windows, all loading the same renderer on different routes:
 *
 *   bubble  #/bubble  a small floating icon: drag it anywhere, click it to open the panel
 *   panel   #/panel   the dashboard: the app itself, always in the taskbar; the bubble brings it up
 *   hud       #/hud       the in-game overlay: click-through, sized to its content
 *   merchant  #/merchant  the Black Cloud Merchant's pets worth buying: opened when a tab of the
 *                         shop is, always movable, closed with its X
 *   minimap   #/minimap   the map overlay: your zone around you, tracked pets' spawns, Hidden Cubes
 *   skills    #/skills    your own damage on the meter's target, skill by skill: with the meter
 *   buffs     #/buffs     your buffs and debuffs, with what is left of each
 *   training  #/training  the Training overlay: a training dummy run's clock and DPS, start and stop
 *   cc        #/cc        the CC / Debuffs banner: stunned, rooted... while it lasts; click-through
 *   details   #/details   a fight's breakdown by player and skill: opened from a meter row or a
 *                         saved fight in the History page, moved by its header, closed with its X
 *   timerbar  #/timerbar  the timers with an alert on, as a bar of countdowns: open while the game
 *                         is, sized to what it shows (hidden with nothing within 13 hours)
 *   killfeed  #/killfeed  player kills around you, as they happen: opened from the PvP page
 *   meter     #/meter     the DPS meter: open while the game is (and the meter is on), movable by
 *                         its header, sized to its rows
 *
 * Overlay rules carried over from marnis-app (docs/09 there): 'screen-saver' level so they sit
 * above a borderless game (exclusive fullscreen cannot be drawn over by anything), shown with
 * showInactive() so they never take focus from the game, and each window only as large as what it
 * shows. A big transparent window made the game drop frames on every alt-tab there.
 *
 * While the game is closed the bubble and the HUD do not exist at all (idle.ts): the panel can
 * still be opened from the tray, where the bubble would be. While another program is in front
 * (an alt-tab), every window hides, and comes back with the game (setForeground).
 */
import { app, BrowserWindow, screen, shell, type Rectangle } from 'electron'
import { join } from 'node:path'
import { broadcast, send } from './broadcast.ts'
import { DISPLAY_NAME } from '../shared/app.ts'
import { settings } from './settings.ts'
import { tracker } from './tracker.ts'
import type { EventChannels } from '../shared/ipc.ts'
import type { DetailsSource } from '../shared/meter.ts'
import type { Point } from '../shared/settings.ts'
import type { TimerId } from '../shared/timers.ts'

const BUBBLE_SIZE = 64
const EDGE = 24

let bubble: BrowserWindow | null = null
let panel: BrowserWindow | null = null
let hud: BrowserWindow | null = null
let merchant: BrowserWindow | null = null
let merchantSize = { width: 0, height: 0 }
let meter: BrowserWindow | null = null
let killFeed: BrowserWindow | null = null
let killFeedSize = { width: 0, height: 0 }
let timerBar: BrowserWindow | null = null
let details: BrowserWindow | null = null
let detailsShowing: DetailsSource | null = null
let timerBarSize = { width: 0, height: 0 }
let meterSize = { width: 0, height: 0 }
let hudEditing = false
let hudSize = { width: 0, height: 0 }
let quitting = false
const panelListeners = new Set<(visible: boolean) => void>()

/** Told when the panel is shown or hidden. */
export function onPanelVisible(fn: (visible: boolean) => void): () => void {
  panelListeners.add(fn)
  return () => panelListeners.delete(fn)
}

/** The dashboard is up on screen: shown and not minimised to the taskbar. */
export function panelVisible(): boolean {
  return alive(panel) && panel.isVisible() && !panel.isMinimized()
}

export function markQuitting(): void {
  quitting = true
}

const alive = (w: BrowserWindow | null): w is BrowserWindow => w !== null && !w.isDestroyed()

function overlayWindow(options: Electron.BrowserWindowConstructorOptions): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    icon: join(__dirname, '../renderer/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Overlays spend a lot of time hidden or behind the game; a throttled renderer stops
      // laying out and observing, and then never asks to be shown again.
      backgroundThrottling: false,
      // The timers' chime plays without a click first (Chromium's default wants one).
      autoplayPolicy: 'no-user-gesture-required',
      // Chromium's spellchecker can download dictionaries; nothing here needs it.
      spellcheck: false,
    },
    ...options,
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setContentProtection(settings.get('hideFromCapture'))
  // Links go to the browser; the windows themselves never navigate away from the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const dev = process.env['ELECTRON_RENDERER_URL']
    if (!(url.startsWith('file://') || (dev && url.startsWith(dev)))) event.preventDefault()
  })
  return win
}

export function load(win: BrowserWindow, route: string): void {
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && dev) void win.loadURL(`${dev}#/${route}`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: `/${route}` })
}

/**
 * The size a window's page measured itself at, for moving it: never the window's own size. On a
 * scaled display (125%, 150%) Windows can hand a window back a pixel larger than it was set to, so
 * a move that kept the window's size grew it a little each time; the window is transparent, so it
 * did not show, but the room left to drag it on the screen shrank with every drag. Before the page
 * has measured itself, the window's size.
 */
function measured(win: BrowserWindow, size: { width: number; height: number }): { width: number; height: number } {
  if (size.width > 0 && size.height > 0) return size
  const { width, height } = win.getBounds()
  return { width, height }
}

/** Keep a rectangle on a display: on the one it mostly overlaps, inside its work area. */
function clampToDisplay(rect: Rectangle): Rectangle {
  const area = screen.getDisplayMatching(rect).workArea
  return {
    ...rect,
    x: Math.round(Math.min(Math.max(rect.x, area.x), area.x + area.width - rect.width)),
    y: Math.round(Math.min(Math.max(rect.y, area.y), area.y + area.height - rect.height)),
  }
}

// ---- bubble ---------------------------------------------------------------------------------

function bubbleBounds(at: Point | null): Rectangle {
  const area = screen.getPrimaryDisplay().workArea
  const p = at ?? { x: area.x + area.width - BUBBLE_SIZE - EDGE, y: area.y + area.height - BUBBLE_SIZE - EDGE }
  return clampToDisplay({ x: p.x, y: p.y, width: BUBBLE_SIZE, height: BUBBLE_SIZE })
}

export function createBubble(): BrowserWindow {
  if (alive(bubble)) return bubble
  // Focusable, unlike the HUD: with the game in front, Windows ate the mouse-down on a window that
  // can never be activated and passed on only the release, so clicks never opened the panel
  // (traced 2026-10-10: pointerup and mouseup arrived, pointerdown never). It still appears with
  // showInactive(), so it takes focus only when clicked, which opens the panel anyway.
  const win = overlayWindow({ ...bubbleBounds(settings.get('bubble')) })
  bubble = win
  win.once('ready-to-show', () => reveal(win))
  win.on('closed', () => (bubble = null))
  load(win, 'bubble')
  return win
}

export function moveBubble(to: Point): void {
  if (!alive(bubble)) return
  bubble.setBounds(clampToDisplay({ x: to.x, y: to.y, width: BUBBLE_SIZE, height: BUBBLE_SIZE }))
}

export function bubbleDragEnded(): void {
  if (!alive(bubble)) return
  const { x, y } = bubble.getBounds()
  settings.set('bubble', { x, y })
}

// ---- dashboard (the panel) ------------------------------------------------------------------

/** The dashboard's smallest size: the sidebar and a page beside it. */
const DASHBOARD_MIN = { width: 900, height: 600 }

/** Where it was left, at the size it was left; the middle of the primary display the first time. */
function dashboardBounds(): Rectangle {
  const { width, height } = settings.get('panel')
  const at = settings.get('panelPosition')
  const area = screen.getPrimaryDisplay().workArea
  const w = Math.min(width, area.width)
  const h = Math.min(height, area.height)
  const p = at ?? { x: Math.round(area.x + (area.width - w) / 2), y: Math.round(area.y + (area.height - h) / 2) }
  return clampToDisplay({ x: p.x, y: p.y, width: w, height: h })
}

/**
 * The dashboard: the app itself, a window of its own (not an overlay): resizable, always in the
 * taskbar, with its own title bar (DashboardPage). Opened when the app starts; its X (and Alt+F4)
 * minimises it to the taskbar, as does clicking from it into the game (panelLeftForGame), and
 * only quitting (the tray) closes it. Not transparent, as Windows
 * will not resize a transparent window.
 */
export function createPanel(): BrowserWindow {
  if (alive(panel)) return panel
  const win = overlayWindow({
    ...dashboardBounds(),
    transparent: false,
    backgroundColor: '#09090b',
    resizable: true,
    minimizable: true,
    maximizable: true,
    skipTaskbar: false,
    hasShadow: true,
    minWidth: DASHBOARD_MIN.width,
    minHeight: DASHBOARD_MIN.height,
    title: DISPLAY_NAME,
    alwaysOnTop: settings.get('panelOnTop'),
  })
  if (!settings.get('panelOnTop')) win.setAlwaysOnTop(false)
  panel = win
  win.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    hidePanel()
  })
  // Minimised from the taskbar or its own button, and back.
  win.on('minimize', () => panelShown(false))
  win.on('restore', () => panelShown(true))
  win.on('closed', () => (panel = null))
  win.on('blur', () => (panelBlurredAt = Date.now()))
  // Its size and place are remembered as they change (not maximised or minimised ones).
  let saveTimer: NodeJS.Timeout | null = null
  const remember = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (win.isDestroyed() || win.isMaximized() || win.isMinimized()) return
      const { x, y, width, height } = win.getBounds()
      settings.set('panel', { width, height })
      settings.set('panelPosition', { x, y })
    }, 500)
  }
  win.on('resize', remember)
  win.on('move', remember)
  win.on('maximize', () => send(win, 'panel:maximized', true))
  win.on('unmaximize', () => send(win, 'panel:maximized', false))
  load(win, 'panel')
  return win
}

export function showPanel(): void {
  const win = createPanel()
  const reveal = (): void => {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    panelShown(true)
  }
  if (win.webContents.isLoading()) win.once('ready-to-show', reveal)
  else reveal()
}

export function minimizePanel(): void {
  if (alive(panel)) panel.minimize()
}

export function toggleMaximizePanel(): void {
  if (!alive(panel)) return
  if (panel.isMaximized()) panel.unmaximize()
  else panel.maximize()
}

/**
 * Open the panel on a pet's drop locations (a click in the merchant window). A panel that is still
 * loading is told once it has: its page listens from when it mounts.
 */
export function showPetInPanel(pet: number): void {
  sendToPanel('panel:showPet', pet)
}

/** The dashboard on these timers' page, them highlighted: a click on the bubble during an alert. */
export function showTimersInPanel(ids: TimerId[]): void {
  sendToPanel('panel:showTimers', ids)
}

/** Show the panel (open if hidden, never toggled shut) and tell it what to show, once loaded. */
function sendToPanel<C extends 'panel:showPet' | 'panel:showTimers'>(channel: C, payload: EventChannels[C]): void {
  showPanel()
  const win = panel
  if (!alive(win)) return
  const send = (): void => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
  else send()
}

/** The dashboard's X: down to the taskbar, where it stays. */
export function hidePanel(): void {
  if (alive(panel) && !panel.isMinimized()) panel.minimize()
}

/** When the dashboard last lost the keyboard: a click on the game right after hides it. */
let panelBlurredAt = 0
const CLICKED_AWAY_MS = 1_500

/**
 * The game came to the front: if that was you leaving the dashboard for it (a click on the game, an
 * alt-tab), down it goes, like a modal clicked outside. Not when the dashboard never had the focus
 * (Alt+E over the game can open it without), so it is never hidden as it opens.
 */
function panelLeftForGame(): void {
  if (!settings.get('panelHideOnGame') || !panelVisible()) return
  if (panel?.isFocused() || Date.now() - panelBlurredAt > CLICKED_AWAY_MS) return
  hidePanel()
}

/** The dashboard came up on screen, or went down to the taskbar. */
let panelUp = false
function panelShown(up: boolean): void {
  if (up === panelUp) return
  panelUp = up
  broadcast('panel:visible', up)
  for (const fn of panelListeners) fn(up)
  // While the panel is up the HUD can be moved: it shows (even when empty) and takes the mouse.
  // Down, back to click-through, so the HUD never catches a click meant for the game.
  setHudEditing(up, false)
  for (const m of MEASURED) m.panelUp(up)
}

/**
 * Alt+E and the tray: the dashboard down when it is up where you can see it (in front, or kept on
 * top of the game), else up. One left behind the game (not on top) comes forward instead.
 */
export function togglePanel(): void {
  if (panelVisible() && (panel?.isFocused() || panel?.isAlwaysOnTop())) hidePanel()
  else showPanel()
}

// ---- hud ------------------------------------------------------------------------------------

function hudPosition(): Point {
  const saved = settings.get('hud').position
  if (saved) return saved
  const area = screen.getPrimaryDisplay().workArea
  return { x: area.x + area.width - Math.max(hudSize.width, 260) - EDGE, y: area.y + 120 }
}

export function createHud(): BrowserWindow {
  if (alive(hud)) return hud
  const p = hudPosition()
  const win = overlayWindow({ x: p.x, y: p.y, width: 280, height: 120, focusable: false })
  win.setIgnoreMouseEvents(true)
  hud = win
  win.on('closed', () => (hud = null))
  win.webContents.once('did-finish-load', () => {
    // Made while the panel is open (the game started meanwhile): in move mode, like the panel's.
    if (panelVisible()) setHudEditing(true, false)
    refreshHud()
  })
  load(win, 'hud')
  return win
}

/** Show or hide the HUD, apply mouse mode and size. Cheap when nothing changed. */
export function refreshHud(): void {
  if (!alive(hud)) return
  const cfg = settings.get('hud')
  const status = tracker.status()
  const wanted =
    hudEditing || (cfg.enabled && hudSize.height > 0 && (!cfg.hideWithoutGame || status.gameActive || status.replay))
  if (hudSize.width > 0 && hudSize.height > 0) {
    const p = hudPosition()
    const next = clampToDisplay({ x: p.x, y: p.y, width: hudSize.width, height: hudSize.height })
    const now = hud.getBounds()
    if (next.x !== now.x || next.y !== now.y || next.width !== now.width || next.height !== now.height) hud.setBounds(next)
  }
  if (wanted && !hud.isVisible()) reveal(hud)
  if (!wanted && hud.isVisible()) hud.hide()
}

export function resizeHud(size: { width: number; height: number }): void {
  hudSize = { width: Math.ceil(size.width), height: Math.ceil(size.height) }
  refreshHud()
}

/**
 * `focus`: take the keyboard too (so Escape ends move mode). Not when the panel turned move mode
 * on: the panel keeps the focus it was just given.
 */
export function setHudEditing(editing: boolean, focus = true): void {
  if (!alive(hud) || hudEditing === editing) return
  hudEditing = editing
  // Edit mode is the only time the HUD takes the mouse: click-through the rest of the time.
  hud.setIgnoreMouseEvents(!editing)
  hud.setFocusable(editing)
  if (editing) {
    refreshHud()
    if (focus) hud.focus()
  }
  broadcast('hud:editing', editing)
  refreshHud()
}

export function hudIsEditing(): boolean {
  return hudEditing
}

export function moveHud(to: Point): void {
  if (!alive(hud)) return
  const next = clampToDisplay({ x: to.x, y: to.y, width: hudSize.width || 280, height: hudSize.height || 120 })
  hud.setBounds(next)
}

export function hudDragEnded(): void {
  if (!alive(hud)) return
  const { x, y } = hud.getBounds()
  settings.set('hud', { ...settings.get('hud'), position: { x, y } })
}

// ---- merchant -------------------------------------------------------------------------------

const MERCHANT_WIDTH = 400

function merchantPosition(): Point {
  const saved = settings.get('merchantWindow')
  if (saved) return saved
  const area = screen.getPrimaryDisplay().workArea
  return { x: Math.round(area.x + area.width / 2 - MERCHANT_WIDTH / 2), y: area.y + 120 }
}

/**
 * Open the merchant window (a tab of the shop was just opened), unless the setting is off. It
 * shows once its page has measured itself, and stays hidden while there is nothing worth buying.
 */
export function showMerchant(): void {
  if (!settings.get('hud').merchant) return
  if (alive(merchant)) return refreshMerchant()
  const p = merchantPosition()
  const win = overlayWindow({ x: p.x, y: p.y, width: MERCHANT_WIDTH, height: 200 })
  merchant = win
  merchantSize = { width: 0, height: 0 }
  win.on('closed', () => (merchant = null))
  load(win, 'merchant')
}

/** The X: closed until a tab of the shop is opened again (a closed window frees its renderer). */
export function closeMerchant(): void {
  if (alive(merchant)) merchant.destroy()
  merchant = null
}

function refreshMerchant(): void {
  if (!alive(merchant)) return
  const { width, height } = merchantSize
  if (width > 0 && height > 0) {
    const p = merchantPosition()
    merchant.setBounds(clampToDisplay({ x: p.x, y: p.y, width, height }))
    if (!merchant.isVisible()) reveal(merchant)
  } else if (merchant.isVisible()) {
    merchant.hide()
  }
}

/** Where the merchant window is while it shows, else null. */
export function merchantBounds(): Rectangle | null {
  return alive(merchant) && merchant.isVisible() ? merchant.getBounds() : null
}

export function resizeMerchant(size: { width: number; height: number }): void {
  merchantSize = { width: Math.ceil(size.width), height: Math.ceil(size.height) }
  refreshMerchant()
}

export function moveMerchant(to: Point): void {
  if (!alive(merchant)) return
  merchant.setBounds(clampToDisplay({ x: to.x, y: to.y, ...measured(merchant, merchantSize) }))
}

export function merchantDragEnded(): void {
  if (!alive(merchant)) return
  const { x, y } = merchant.getBounds()
  settings.set('merchantWindow', { x, y })
}

// ---- meter ----------------------------------------------------------------------------------

function meterPosition(): Point {
  const saved = settings.get('meter').position
  if (saved) return saved
  const area = screen.getPrimaryDisplay().workArea
  return { x: area.x + EDGE, y: area.y + 160 }
}

/** Open the meter window, unless it is turned off. It shows once its page has measured itself. */
export function createMeter(): void {
  if (!settings.get('meter').enabled || alive(meter)) return
  const p = meterPosition()
  const win = overlayWindow({ x: p.x, y: p.y, width: 320, height: 120 })
  meter = win
  meterSize = { width: 0, height: 0 }
  win.on('closed', () => (meter = null))
  load(win, 'meter')
}

export function closeMeter(): void {
  if (alive(meter)) meter.destroy()
  meter = null
}

function refreshMeter(): void {
  if (!alive(meter)) return
  const { width, height } = meterSize
  if (width > 0 && height > 0) {
    const p = meterPosition()
    meter.setBounds(clampToDisplay({ x: p.x, y: p.y, width, height }))
    if (!meter.isVisible()) reveal(meter)
  } else if (meter.isVisible()) {
    meter.hide()
  }
}

export function resizeMeter(size: { width: number; height: number }): void {
  meterSize = { width: Math.ceil(size.width), height: Math.ceil(size.height) }
  refreshMeter()
}

export function moveMeter(to: Point): void {
  if (!alive(meter)) return
  meter.setBounds(clampToDisplay({ x: to.x, y: to.y, ...measured(meter, meterSize) }))
}

export function meterDragEnded(): void {
  if (!alive(meter)) return
  const { x, y } = meter.getBounds()
  settings.set('meter', { ...settings.get('meter'), position: { x, y } })
}

// ---- measured overlays: your skills, the map, your buffs --------------------------------------

/**
 * An overlay that sizes itself to its page (which reports 0 x 0 with nothing to show, and is then
 * kept hidden), moved by its header, its position saved in its own setting.
 */
function measuredOverlay(o: {
  route: string
  enabled: () => boolean
  saved: () => Point | null
  fallback: () => Point
  save: (p: Point) => void
  /** Clicks go through to the game, except while the dashboard is up (to move it). */
  clickThrough?: boolean
}) {
  let win: BrowserWindow | null = null
  let size = { width: 0, height: 0 }
  const position = (): Point => o.saved() ?? o.fallback()
  const refresh = (): void => {
    if (!alive(win)) return
    if (size.width > 0 && size.height > 0) {
      const p = position()
      win.setBounds(clampToDisplay({ x: p.x, y: p.y, ...size }))
      if (!win.isVisible()) reveal(win)
    } else if (win.isVisible()) {
      win.hide()
    }
  }
  return {
    win: (): BrowserWindow | null => (alive(win) ? win : null),
    /** Open it, unless it is turned off. It shows once its page has measured itself. */
    create(): void {
      if (!o.enabled() || alive(win)) return
      const p = position()
      const w = overlayWindow({ x: p.x, y: p.y, width: 300, height: 120, ...(o.clickThrough ? { focusable: false } : {}) })
      if (o.clickThrough && !panelVisible()) w.setIgnoreMouseEvents(true)
      else if (o.clickThrough) w.setFocusable(true)
      win = w
      size = { width: 0, height: 0 }
      w.on('closed', () => {
        if (win === w) win = null
      })
      load(w, o.route)
    },
    close(): void {
      if (alive(win)) win.destroy()
      win = null
    },
    refresh,
    /** The dashboard came up (it can be moved) or went down (clicks pass through). */
    panelUp(up: boolean): void {
      if (!o.clickThrough || !alive(win)) return
      win.setIgnoreMouseEvents(!up)
      // As the HUD in move mode: a window that can never be activated loses its presses to
      // Windows over the game, and with no press there is no drag.
      win.setFocusable(up)
    },
    resize(to: { width: number; height: number }): void {
      size = { width: Math.ceil(to.width), height: Math.ceil(to.height) }
      refresh()
    },
    move(to: Point): void {
      if (alive(win)) win.setBounds(clampToDisplay({ x: to.x, y: to.y, ...measured(win, size) }))
    },
    dragEnded(): void {
      if (!alive(win)) return
      const { x, y } = win.getBounds()
      o.save({ x, y })
    },
  }
}

const skillsOverlay = measuredOverlay({
  route: 'skills',
  enabled: () => settings.get('skills').enabled,
  saved: () => settings.get('skills').position,
  fallback: () => {
    const area = screen.getPrimaryDisplay().workArea
    return { x: area.x + EDGE, y: area.y + 480 }
  },
  save: (position) => settings.set('skills', { ...settings.get('skills'), position }),
})
export const createSkills = skillsOverlay.create
export const closeSkills = skillsOverlay.close
export const resizeSkills = skillsOverlay.resize
export const moveSkills = skillsOverlay.move
export const skillsDragEnded = skillsOverlay.dragEnded

const miniMapOverlay = measuredOverlay({
  route: 'minimap',
  enabled: () => settings.get('minimap').enabled,
  saved: () => settings.get('minimap').position,
  fallback: () => {
    const area = screen.getPrimaryDisplay().workArea
    const size = settings.get('minimap').size
    return { x: area.x + area.width - size - 2 * EDGE, y: area.y + area.height - size - 4 * EDGE }
  },
  save: (position) => settings.set('minimap', { ...settings.get('minimap'), position }),
})
export const createMiniMap = miniMapOverlay.create
export const closeMiniMap = miniMapOverlay.close
export const resizeMiniMap = miniMapOverlay.resize
export const moveMiniMap = miniMapOverlay.move
export const miniMapDragEnded = miniMapOverlay.dragEnded

const buffsOverlay = measuredOverlay({
  route: 'buffs',
  enabled: () => settings.get('buffs').enabled,
  saved: () => settings.get('buffs').position,
  fallback: () => {
    const area = screen.getPrimaryDisplay().workArea
    return { x: Math.round(area.x + area.width / 2 - 200), y: area.y + area.height - 260 }
  },
  save: (position) => settings.set('buffs', { ...settings.get('buffs'), position }),
})
export const createBuffs = buffsOverlay.create
export const closeBuffs = buffsOverlay.close
export const resizeBuffs = buffsOverlay.resize
export const moveBuffs = buffsOverlay.move
export const buffsDragEnded = buffsOverlay.dragEnded

const ccOverlay = measuredOverlay({
  route: 'cc',
  enabled: () => settings.get('buffs').cc,
  saved: () => settings.get('buffs').ccPosition,
  fallback: () => {
    const area = screen.getPrimaryDisplay().workArea
    return { x: Math.round(area.x + area.width / 2 - 190), y: Math.round(area.y + area.height * 0.28) }
  },
  save: (ccPosition) => settings.set('buffs', { ...settings.get('buffs'), ccPosition }),
  clickThrough: true,
})
export const createCc = ccOverlay.create
export const resizeCc = ccOverlay.resize
export const moveCc = ccOverlay.move
export const ccDragEnded = ccOverlay.dragEnded

/** Enemies nearby: top centre, under where the CC banner sits. */
const enemiesOverlay = measuredOverlay({
  route: 'enemies',
  enabled: () => settings.get('enemies').enabled,
  saved: () => settings.get('enemies').position,
  fallback: () => {
    const area = screen.getPrimaryDisplay().workArea
    return { x: Math.round(area.x + area.width / 2 - 130), y: Math.round(area.y + area.height * 0.12) }
  },
  save: (position) => settings.set('enemies', { ...settings.get('enemies'), position }),
  clickThrough: true,
})
export const createEnemies = enemiesOverlay.create
export const resizeEnemies = enemiesOverlay.resize
export const moveEnemies = enemiesOverlay.move
export const enemiesDragEnded = enemiesOverlay.dragEnded

const trainingOverlay = measuredOverlay({
  route: 'training',
  enabled: () => settings.get('dummy').overlay,
  saved: () => settings.get('dummy').position,
  fallback: () => {
    const area = screen.getPrimaryDisplay().workArea
    return { x: area.x + area.width - 300 - EDGE, y: Math.round(area.y + area.height * 0.3) }
  },
  save: (position) => settings.set('dummy', { ...settings.get('dummy'), position }),
})
export const createTraining = trainingOverlay.create
export const resizeTraining = trainingOverlay.resize
export const moveTraining = trainingOverlay.move
export const trainingDragEnded = trainingOverlay.dragEnded

/** The packet log's pill (Alt+Shift+R): top left while it records, and a few seconds after. */
const packetsOverlay = measuredOverlay({
  route: 'packets',
  enabled: () => true,
  saved: () => null,
  fallback: () => {
    const area = screen.getPrimaryDisplay().workArea
    return { x: area.x + EDGE, y: area.y + EDGE }
  },
  save: () => {},
  clickThrough: true,
})
export const createPacketsHud = packetsOverlay.create
export const closePacketsHud = packetsOverlay.close
export const resizePacketsHud = packetsOverlay.resize

const MEASURED = [skillsOverlay, miniMapOverlay, buffsOverlay, ccOverlay, enemiesOverlay, trainingOverlay, packetsOverlay]
/** The measured overlays that are open. */
const measuredWins = (): BrowserWindow[] => MEASURED.map((m) => m.win()).filter((w): w is BrowserWindow => w !== null)

// ---- details ----------------------------------------------------------------------------------

const DETAILS_SIZE = { width: 600, height: 720 }

function detailsPosition(): Point {
  const saved = settings.get('detailsWindow')
  if (saved) return saved
  const area = screen.getPrimaryDisplay().workArea
  return { x: Math.round(area.x + (area.width - DETAILS_SIZE.width) / 2), y: Math.round(area.y + (area.height - DETAILS_SIZE.height) / 2) }
}

/** What the Details window shows, if it is open. */
export function detailsSource(): DetailsSource | null {
  return alive(details) ? detailsShowing : null
}

/** Open the Details window on `source`, or point the open one at it. */
export function openDetails(source: DetailsSource): void {
  detailsShowing = source
  if (alive(details)) {
    broadcast('details:source', source)
    reveal(details)
    return
  }
  const p = detailsPosition()
  const win = overlayWindow({ ...clampToDisplay({ x: p.x, y: p.y, ...DETAILS_SIZE }) })
  details = win
  win.on('closed', () => {
    details = null
    detailsShowing = null
  })
  win.once('ready-to-show', () => reveal(win))
  load(win, 'details')
}

export function closeDetails(): void {
  if (alive(details)) details.destroy()
  details = null
  detailsShowing = null
}

export function moveDetails(to: Point): void {
  if (!alive(details)) return
  details.setBounds(clampToDisplay({ x: to.x, y: to.y, ...DETAILS_SIZE }))
}

export function detailsDragEnded(): void {
  if (!alive(details)) return
  const { x, y } = details.getBounds()
  settings.set('detailsWindow', { x, y })
}

// ---- timer bar ------------------------------------------------------------------------------

function timerBarPosition(): Point {
  const saved = settings.get('timerBar').position
  if (saved) return saved
  const area = screen.getPrimaryDisplay().workArea
  return { x: Math.round(area.x + area.width / 2 - 150), y: area.y + EDGE }
}

/** Open the timer bar, unless it is turned off. It shows once its page has measured itself. */
export function createTimerBar(): void {
  if (!settings.get('timerBar').enabled || alive(timerBar)) return
  const p = timerBarPosition()
  const win = overlayWindow({ x: p.x, y: p.y, width: 300, height: 40 })
  timerBar = win
  timerBarSize = { width: 0, height: 0 }
  win.on('closed', () => (timerBar = null))
  load(win, 'timerbar')
}

function closeTimerBar(): void {
  if (alive(timerBar)) timerBar.destroy()
  timerBar = null
}

function refreshTimerBar(): void {
  if (!alive(timerBar)) return
  const { width, height } = timerBarSize
  if (width > 0 && height > 0) {
    const p = timerBarPosition()
    timerBar.setBounds(clampToDisplay({ x: p.x, y: p.y, width, height }))
    if (!timerBar.isVisible()) reveal(timerBar)
  } else if (timerBar.isVisible()) {
    timerBar.hide()
  }
}

export function resizeTimerBar(size: { width: number; height: number }): void {
  timerBarSize = { width: Math.ceil(size.width), height: Math.ceil(size.height) }
  refreshTimerBar()
}

export function moveTimerBar(to: Point): void {
  if (!alive(timerBar)) return
  timerBar.setBounds(clampToDisplay({ x: to.x, y: to.y, ...measured(timerBar, timerBarSize) }))
}

export function timerBarDragEnded(): void {
  if (!alive(timerBar)) return
  const { x, y } = timerBar.getBounds()
  settings.set('timerBar', { ...settings.get('timerBar'), position: { x, y } })
}

// ---- kill feed (from Nyerk 0.2.17) ----------------------------------------------------------

const KILL_FEED_WIDTH = 312

function killFeedPosition(): Point {
  const saved = settings.get('killFeed').position
  if (saved) return saved
  const area = screen.getPrimaryDisplay().workArea
  return { x: area.x + area.width - KILL_FEED_WIDTH - EDGE, y: area.y + 120 }
}

/** The kill feed window, if the PvP Log has it open: made with the other overlays. */
export function createKillFeed(): void {
  if (!settings.get('killFeed').open || alive(killFeed)) return
  const p = killFeedPosition()
  const win = overlayWindow({ x: p.x, y: p.y, width: KILL_FEED_WIDTH, height: 40 })
  killFeed = win
  killFeedSize = { width: 0, height: 0 }
  win.on('closed', () => (killFeed = null))
  load(win, 'killfeed')
  win.webContents.once('did-finish-load', () => alive(win) && reveal(win))
}

/** PvP Log → Open HUD / the window's X. Remembered, so it comes back with the game. */
export function setKillFeedOpen(open: boolean): void {
  settings.set('killFeed', { ...settings.get('killFeed'), open })
  if (open) createKillFeed()
  else if (alive(killFeed)) {
    killFeed.destroy()
    killFeed = null
  }
}

export function resizeKillFeed(size: { width: number; height: number }): void {
  if (!alive(killFeed) || size.width <= 0 || size.height <= 0) return
  killFeedSize = { width: Math.ceil(size.width), height: Math.ceil(size.height) }
  const { x, y } = killFeed.getBounds()
  killFeed.setBounds(clampToDisplay({ x, y, ...killFeedSize }))
}

export function moveKillFeed(to: Point): void {
  if (!alive(killFeed)) return
  killFeed.setBounds(clampToDisplay({ x: to.x, y: to.y, ...measured(killFeed, killFeedSize) }))
}

export function killFeedDragEnded(): void {
  if (!alive(killFeed)) return
  const { x, y } = killFeed.getBounds()
  settings.set('killFeed', { ...settings.get('killFeed'), position: { x, y } })
}

// ---- the game in front ----------------------------------------------------------------------

/**
 * How long another program must be in front before the overlays hide, so holding Alt+Tab (the
 * switcher is in front meanwhile) doesn't flicker them. A2Tools DPS Meter waits 1.5 s for this.
 */
const AWAY_GRACE_MS = 1000

/** Another program is in front (not the game, not one of ours): the overlays are hidden. */
let gameAway = false
/** The windows hidden for it, shown again when the game is back. */
const awayHidden = new Set<BrowserWindow>()
let awayTimer: NodeJS.Timeout | null = null

/** Every overlay hidden by hand (Alt+Shift+E) until shown again; the dashboard stays. */
let overlaysOff = false

/** Hidden now, by the game being away or by hand: shows once neither holds it. */
const held = (win: BrowserWindow): boolean => gameAway || (overlaysOff && win !== panel)

/** Show an overlay without taking the focus; while it is held hidden, once it is not. */
function reveal(win: BrowserWindow): void {
  if (held(win)) awayHidden.add(win)
  else win.showInactive()
}

/** Show again the windows hidden for a reason that is gone. */
function restoreHidden(): void {
  for (const win of [...awayHidden]) {
    if (alive(win) && held(win)) continue
    awayHidden.delete(win)
    // These decide below whether they have anything to show.
    if (alive(win) && win !== hud && win !== merchant && win !== meter && win !== timerBar && !measuredWins().includes(win)) win.showInactive()
  }
  refreshHud()
  refreshMerchant()
  refreshMeter()
  refreshTimerBar()
  for (const m of MEASURED) m.refresh()
}

/** Alt+Shift+E: every overlay off, or back on. The dashboard is left as it is. True when off. */
export function toggleOverlays(): boolean {
  overlaysOff = !overlaysOff
  if (overlaysOff) {
    for (const win of [bubble, hud, merchant, meter, killFeed, timerBar, details, ...measuredWins()]) {
      if (!alive(win) || !win.isVisible()) continue
      awayHidden.add(win)
      win.hide()
    }
  } else {
    restoreHidden()
  }
  broadcast('overlays:hidden', overlaysOff)
  return overlaysOff
}

export const overlaysHidden = (): boolean => overlaysOff

/** What is in front, as the engine sees it (Windows): the game, one of our windows, or neither. */
export function setForeground(game: boolean, app: boolean): void {
  if (game) panelLeftForGame()
  const away = settings.get('hideWhenGameAway') && !game && !app
  if (awayTimer) clearTimeout(awayTimer)
  awayTimer = null
  if (away === gameAway) return
  if (away) {
    awayTimer = setTimeout(() => {
      gameAway = true
      for (const win of [bubble, hud, merchant, meter, killFeed, timerBar, details, ...measuredWins()]) {
        if (!alive(win) || !win.isVisible()) continue
        awayHidden.add(win)
        win.hide()
      }
      // The dashboard stays in the taskbar: it only stops sitting above the other program.
      if (alive(panel)) panel.setAlwaysOnTop(false)
    }, AWAY_GRACE_MS)
    return
  }
  gameAway = false
  if (alive(panel)) panel.setAlwaysOnTop(settings.get('panelOnTop'), 'screen-saver')
  restoreHidden()
}

// ---- all ------------------------------------------------------------------------------------

const ON_TOP_EVERY_MS = 5_000

/**
 * Keep the overlays above the game. Windows can leave an always-on-top window below a game that
 * takes the foreground, with its topmost flag still set (seen 2026-10-13: the bubble 10 places below
 * the borderless game window, invisible, while the app thought it was showing). So every few seconds
 * each visible overlay is put back on top; moveTop() does not take the focus, and the game keeps it.
 * The panel is left alone: it is a window to click into, and has its own on-top setting.
 */
export function startOnTopWatch(): void {
  setInterval(() => {
    for (const win of [bubble, hud, merchant, meter, killFeed, timerBar, details, ...measuredWins()]) {
      if (!alive(win) || !win.isVisible()) continue
      win.setAlwaysOnTop(true, 'screen-saver')
      win.moveTop()
    }
  }, ON_TOP_EVERY_MS).unref()
}

/** Settings that change how the windows behave, applied live. */
export function applyWindowSettings(): void {
  const hidden = settings.get('hideFromCapture')
  for (const w of [bubble, panel, hud, merchant, meter, killFeed, timerBar, details, ...measuredWins()]) if (alive(w)) w.setContentProtection(hidden)
  if (!settings.get('minimap').enabled) closeMiniMap()
  else if (alive(bubble)) createMiniMap()
  if (!settings.get('skills').enabled) closeSkills()
  else if (alive(bubble)) createSkills()
  if (!settings.get('buffs').enabled) closeBuffs()
  else if (alive(bubble)) createBuffs()
  if (!settings.get('buffs').cc) ccOverlay.close()
  else if (alive(bubble)) createCc()
  if (!settings.get('enemies').enabled) enemiesOverlay.close()
  else if (alive(bubble)) createEnemies()
  if (!settings.get('dummy').overlay) trainingOverlay.close()
  else if (alive(bubble)) createTraining()
  // Turned on: with the other overlays, while they are up (the bubble is, awake).
  if (!settings.get('timerBar').enabled) closeTimerBar()
  else if (alive(bubble)) createTimerBar()
  if (!settings.get('hud').merchant) closeMerchant()
  if (!settings.get('meter').enabled) closeMeter()
  if (gameAway && !settings.get('hideWhenGameAway')) setForeground(true, false)
  if (alive(panel) && !gameAway) {
    const onTop = settings.get('panelOnTop')
    panel.setAlwaysOnTop(onTop, 'screen-saver')
  }
  refreshHud()
}

/**
 * Close the bubble, the HUD, the merchant window and the meter. The dashboard stays: it is the app,
 * in the taskbar.
 */
export function closeOverlays(): void {
  for (const win of [bubble, hud, merchant, meter, killFeed, timerBar]) if (alive(win)) win.destroy()
  for (const m of MEASURED) m.close()
  bubble = null
  hud = null
  merchant = null
  meter = null
  killFeed = null
  timerBar = null
  awayHidden.clear()
  hudEditing = false
  hudSize = { width: 0, height: 0 }

}

/**
 * Replace a window whose renderer cannot be brought back: destroy it and build a fresh one in the
 * same state. A frozen renderer survived reload(), loadURL() and killing its process in testing;
 * a new window always comes back. Returns which window it was.
 */
export function rebuildWindow(win: BrowserWindow): string | null {
  if (win === bubble) {
    win.destroy()
    bubble = null
    createBubble()
    return 'bubble'
  }
  if (win === hud) {
    const editing = hudEditing
    win.destroy()
    hud = null
    hudEditing = false
    createHud()
    if (editing) hud!.webContents.once('did-finish-load', () => setHudEditing(true, false))
    return 'hud'
  }
  if (win === merchant) {
    win.destroy()
    merchant = null
    showMerchant()
    return 'merchant'
  }
  for (const [m, route] of [[skillsOverlay, 'skills'], [miniMapOverlay, 'minimap'], [buffsOverlay, 'buffs'], [ccOverlay, 'cc'], [enemiesOverlay, 'enemies'], [trainingOverlay, 'training'], [packetsOverlay, 'packets']] as const) {
    if (win !== m.win()) continue
    m.close()
    m.create()
    return route
  }
  if (win === details) {
    const source = detailsShowing
    win.destroy()
    details = null
    if (source) openDetails(source)
    return 'details'
  }
  if (win === timerBar) {
    win.destroy()
    timerBar = null
    createTimerBar()
    return 'timerbar'
  }
  if (win === killFeed) {
    win.destroy()
    killFeed = null
    createKillFeed()
    return 'killfeed'
  }
  if (win === meter) {
    win.destroy()
    meter = null
    createMeter()
    return 'meter'
  }
  if (win === panel) {
    const up = panelVisible()
    win.destroy()
    panel = null
    showPanel()
    // It was down in the taskbar: back there.
    if (!up) hidePanel()
    return 'panel'
  }
  return null
}
