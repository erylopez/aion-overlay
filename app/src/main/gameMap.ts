/**
 * Markers on the game's own map: a transparent, click-through window over the part of the screen
 * where you keep the game's map open (picked once, by dragging a box). The window's page captures
 * that part of the screen, finds the zone's map on it (renderer/src/workers/mapVision.ts) and draws
 * the markers where they fall on it, following the game's map as it is zoomed and moved.
 *
 * The window is always kept out of screen captures (Windows' "exclude from capture"): its own
 * markers must never be in the picture it matches, so they never show in recordings either.
 * The approach (capture a region, match it against the zone's map image, draw over it) is
 * problem-xyz's Aion 2 - Map Overlay's, with the author's leave; the code is this app's own.
 */
import { BrowserWindow, desktopCapturer, screen, session } from 'electron'
import { join } from 'node:path'
import { broadcast } from './broadcast.ts'
import { settings } from './settings.ts'
import { log } from './tracker.ts'
import { load } from './windows.ts'
import type { GameMapState } from '../shared/gameMap.ts'
import type { Rect } from '../shared/settings.ts'

let overlay: BrowserWindow | null = null
let picker: BrowserWindow | null = null
let awake = false
let state: GameMapState = { status: 'off', world: null, inliers: 0, ms: 0 }

const alive = (w: BrowserWindow | null): w is BrowserWindow => !!w && !w.isDestroyed()

const PREFS: Electron.WebPreferences = {
  preload: join(__dirname, '../preload/index.js'),
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  backgroundThrottling: false,
  spellcheck: false,
}

/** The display the region is on, as the page needs it to cut the region out of the screen. */
export function regionDisplay(): { bounds: Rect; scaleFactor: number } | null {
  const region = settings.get('gameMap').region
  if (!region) return null
  const d = screen.getDisplayMatching(region)
  return { bounds: d.bounds, scaleFactor: d.scaleFactor }
}

function createOverlay(): void {
  const { enabled, region } = settings.get('gameMap')
  if (!awake || !enabled || !region || alive(overlay)) return
  const win = new BrowserWindow({
    ...region,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: PREFS,
  })
  overlay = win
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true)
  // Never in the picture it matches (nor in recordings).
  win.setContentProtection(true)
  win.once('ready-to-show', () => alive(win) && win.showInactive())
  win.on('closed', () => {
    if (overlay === win) overlay = null
  })
  load(win, 'gamemap')
  log(`game map: watching ${region.width}x${region.height} at ${region.x},${region.y}`)
}

function closeOverlay(): void {
  if (alive(overlay)) overlay.destroy()
  overlay = null
  setState({ status: 'off', world: null, inliers: 0, ms: 0 })
}

function setState(next: GameMapState): void {
  state = next
  broadcast('gamemap:state', state)
}

export const gameMap = {
  state: (): GameMapState => state,

  /** Drag a box around the game's map: a dimmed layer over the display the pointer is on. */
  pick(): void {
    if (alive(picker)) return picker.focus()
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const win = new BrowserWindow({
      ...d.bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      webPreferences: PREFS,
    })
    picker = win
    win.setAlwaysOnTop(true, 'screen-saver')
    win.once('ready-to-show', () => {
      if (!alive(win)) return
      win.show()
      win.focus()
    })
    win.on('closed', () => {
      if (picker === win) picker = null
    })
    load(win, 'regionpick')
  },

  /** The box dragged on the picker, in its own coordinates; null when it was cancelled. */
  setRegion(box: Rect | null): void {
    const origin = alive(picker) ? picker.getBounds() : null
    if (alive(picker)) picker.destroy()
    picker = null
    if (!box || !origin) return
    const region = { x: origin.x + Math.round(box.x), y: origin.y + Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }
    log(`game map: region ${region.width}x${region.height} at ${region.x},${region.y}`)
    closeOverlay()
    settings.set('gameMap', { ...settings.get('gameMap'), region, enabled: true })
    createOverlay()
  },

  /** What the overlay's page last said about the game's map (shown on the Map page). */
  report(next: GameMapState): void {
    if (next.status !== state.status || next.world !== state.world || Math.abs(next.inliers - state.inliers) > 3) setState(next)
    else state = next
  },
}

/** The game is up (or not): the overlay goes with the other overlays. */
export function setGameMapAwake(on: boolean): void {
  awake = on
  if (on) createOverlay()
  else closeOverlay()
}

/** Settings changed: open, close or move the overlay to match. */
export function applyGameMap(): void {
  const { enabled, region } = settings.get('gameMap')
  if (!enabled || !region) return closeOverlay()
  if (alive(overlay)) {
    const b = overlay.getBounds()
    if (b.x !== region.x || b.y !== region.y || b.width !== region.width || b.height !== region.height) overlay.setBounds(region)
    return
  }
  createOverlay()
}

export function startGameMap(): void {
  // The overlay's page asks for the screen its region is on; nothing else in the app captures it.
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      const fromOverlay = alive(overlay) && request.frame === overlay.webContents.mainFrame
      const region = settings.get('gameMap').region
      if (!fromOverlay || !region) return callback({})
      const display = screen.getDisplayMatching(region)
      void desktopCapturer
        .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => {
          const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
          callback(source ? { video: source } : {})
        })
        .catch((err: unknown) => {
          log(`game map: no screen to capture: ${String(err)}`)
          callback({})
        })
    },
    { useSystemPicker: false },
  )
}
