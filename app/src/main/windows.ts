/**
 * The app's three windows, all loading the same renderer on different routes:
 *
 *   bubble  #/bubble  a small floating icon: drag it anywhere, click it to open the panel
 *   panel   #/panel   the app itself: collection, session, settings; opens beside the bubble
 *   hud       #/hud       the in-game overlay: click-through, sized to its content
 *   merchant  #/merchant  the Black Cloud Merchant's pets worth buying: opened when a tab of the
 *                         shop is, always movable, closed with its X
 *
 * Overlay rules carried over from marnis-app (docs/09 there): 'screen-saver' level so they sit
 * above a borderless game (exclusive fullscreen cannot be drawn over by anything), shown with
 * showInactive() so they never take focus from the game, and each window only as large as what it
 * shows. A big transparent window made the game drop frames on every alt-tab there.
 *
 * While the game is closed the bubble and the HUD do not exist at all (idle.ts): the panel can
 * still be opened from the tray, where the bubble would be.
 */
import { app, BrowserWindow, screen, shell, type Rectangle } from 'electron'
import { join } from 'node:path'
import { broadcast } from './broadcast.ts'
import { settings } from './settings.ts'
import { tracker } from './tracker.ts'
import type { EventChannels } from '../shared/ipc.ts'
import type { Point } from '../shared/settings.ts'
import type { TimerId } from '../shared/timers.ts'

const BUBBLE_SIZE = 64
const PANEL_GAP = 8
/** The panel's size while a map is open in it. */
const PANEL_EXPANDED = { width: 900, height: 680 }
const EDGE = 24

let bubble: BrowserWindow | null = null
let panel: BrowserWindow | null = null
let hud: BrowserWindow | null = null
let merchant: BrowserWindow | null = null
let merchantSize = { width: 0, height: 0 }
let panelExpanded = false
let hudEditing = false
let hudSize = { width: 0, height: 0 }
let quitting = false
const panelListeners = new Set<(visible: boolean) => void>()

/** Told when the panel is shown or hidden. */
export function onPanelVisible(fn: (visible: boolean) => void): () => void {
  panelListeners.add(fn)
  return () => panelListeners.delete(fn)
}

export function panelVisible(): boolean {
  return alive(panel) && panel.isVisible()
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

function load(win: BrowserWindow, route: string): void {
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && dev) void win.loadURL(`${dev}#/${route}`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: `/${route}` })
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
  win.once('ready-to-show', () => win.showInactive())
  win.on('closed', () => (bubble = null))
  load(win, 'bubble')
  return win
}

export function moveBubble(to: Point): void {
  if (!alive(bubble)) return
  bubble.setBounds(clampToDisplay({ x: to.x, y: to.y, width: BUBBLE_SIZE, height: BUBBLE_SIZE }))
  if (alive(panel) && panel.isVisible()) placePanel()
}

export function bubbleDragEnded(): void {
  if (!alive(bubble)) return
  const { x, y } = bubble.getBounds()
  settings.set('bubble', { x, y })
}

// ---- panel ----------------------------------------------------------------------------------

/**
 * Beside the bubble, on whichever side has room, aligned to the bubble's nearer edge. Where the
 * bubble would be while it is gone (the game is closed).
 */
function placePanel(): void {
  if (!alive(panel)) return
  const b = alive(bubble) ? bubble.getBounds() : bubbleBounds(settings.get('bubble'))
  const saved = settings.get('panel')
  const width = panelExpanded ? Math.max(saved.width, PANEL_EXPANDED.width) : saved.width
  const height = panelExpanded ? Math.max(saved.height, PANEL_EXPANDED.height) : saved.height
  const area = screen.getDisplayMatching(b).workArea
  const right = b.x + b.width / 2 > area.x + area.width / 2
  const lower = b.y + b.height / 2 > area.y + area.height / 2
  const x = right ? b.x - width - PANEL_GAP : b.x + b.width + PANEL_GAP
  const y = lower ? b.y + b.height - height : b.y
  panel.setBounds(clampToDisplay({ x, y, width, height }))
}

export function createPanel(): BrowserWindow {
  if (alive(panel)) return panel
  const { width, height } = settings.get('panel')
  const win = overlayWindow({ width, height, alwaysOnTop: settings.get('panelOnTop') })
  if (!settings.get('panelOnTop')) win.setAlwaysOnTop(false)
  panel = win
  win.on('close', (event) => {
    // The X hides it; only quitting closes it.
    if (quitting) return
    event.preventDefault()
    hidePanel()
  })
  win.on('closed', () => (panel = null))
  load(win, 'panel')
  return win
}

export function showPanel(): void {
  const win = createPanel()
  placePanel()
  const reveal = (): void => {
    win.show()
    win.focus()
    broadcast('panel:visible', true)
    for (const fn of panelListeners) fn(true)
    // While the panel is open the HUD can be moved: it shows (even when empty) and takes the mouse.
    setHudEditing(true, false)
  }
  if (win.webContents.isLoading()) win.once('ready-to-show', reveal)
  else reveal()
}

/**
 * Open the panel on a pet's drop locations (a click in the merchant window). A panel that is still
 * loading is told once it has: its page listens from when it mounts.
 */
export function showPetInPanel(pet: number): void {
  sendToPanel('panel:showPet', pet)
}

/** The panel on its Timers tab, these timers highlighted: a click on the bubble during an alert. */
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

/** Larger while a map is open; back to the saved size after. Not persisted. */
export function setPanelExpanded(expanded: boolean): void {
  if (panelExpanded === expanded) return
  panelExpanded = expanded
  placePanel()
}

export function hidePanel(): void {
  if (!alive(panel)) return
  panel.hide()
  broadcast('panel:visible', false)
  for (const fn of panelListeners) fn(false)
  // Back to click-through, so the HUD never catches a click meant for the game.
  setHudEditing(false)
}

export function togglePanel(): void {
  if (alive(panel) && panel.isVisible()) hidePanel()
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
  if (wanted && !hud.isVisible()) hud.showInactive()
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
    if (!merchant.isVisible()) merchant.showInactive()
  } else if (merchant.isVisible()) {
    merchant.hide()
  }
}

export function resizeMerchant(size: { width: number; height: number }): void {
  merchantSize = { width: Math.ceil(size.width), height: Math.ceil(size.height) }
  refreshMerchant()
}

export function moveMerchant(to: Point): void {
  if (!alive(merchant)) return
  const { width, height } = merchant.getBounds()
  merchant.setBounds(clampToDisplay({ x: to.x, y: to.y, width, height }))
}

export function merchantDragEnded(): void {
  if (!alive(merchant)) return
  const { x, y } = merchant.getBounds()
  settings.set('merchantWindow', { x, y })
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
    for (const win of [bubble, hud, merchant]) {
      if (!alive(win) || !win.isVisible()) continue
      win.setAlwaysOnTop(true, 'screen-saver')
      win.moveTop()
    }
  }, ON_TOP_EVERY_MS).unref()
}

/** Settings that change how the windows behave, applied live. */
export function applyWindowSettings(): void {
  const hidden = settings.get('hideFromCapture')
  for (const w of [bubble, panel, hud, merchant]) if (alive(w)) w.setContentProtection(hidden)
  if (!settings.get('hud').merchant) closeMerchant()
  if (alive(panel)) {
    const onTop = settings.get('panelOnTop')
    panel.setAlwaysOnTop(onTop, 'screen-saver')
    if (panel.isVisible()) placePanel()
  }
  refreshHud()
}

/**
 * Close the bubble, the HUD and the merchant window, and the panel if it is hidden: a window that
 * is only hidden keeps its renderer process. An open panel stays open.
 */
export function closeOverlays(): void {
  for (const win of [bubble, hud, merchant]) if (alive(win)) win.destroy()
  bubble = null
  hud = null
  merchant = null
  hudEditing = false
  hudSize = { width: 0, height: 0 }
  if (alive(panel) && !panel.isVisible()) {
    panel.destroy()
    panel = null
  }
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
  if (win === panel) {
    const visible = win.isVisible()
    win.destroy()
    panel = null
    if (visible) showPanel()
    return 'panel'
  }
  return null
}
