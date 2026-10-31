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
import { BrowserWindow, desktopCapturer, screen, session, shell } from 'electron'
import { join } from 'node:path'
import { broadcast } from './broadcast.ts'
import { settings } from './settings.ts'
import { gameMapLogPath, glog } from './gameMapLog.ts'
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
  win.once('ready-to-show', () => {
    if (!alive(win)) return
    win.showInactive()
    const b = win.getBounds()
    if (b.x !== region.x || b.y !== region.y || b.width !== region.width || b.height !== region.height) glog(`overlay window is ${b.width}x${b.height} at ${b.x},${b.y}, not where asked`)
  })
  win.on('closed', () => {
    if (overlay === win) overlay = null
  })
  load(win, 'gamemap')
  glog(`watching ${region.width}x${region.height} at ${region.x},${region.y}`)
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
    glog(
      `picking on display ${d.id} ${d.bounds.width}x${d.bounds.height} at ${d.bounds.x},${d.bounds.y}, ${d.scaleFactor * 100}% ` +
        `(displays: ${screen.getAllDisplays().map((x) => `${x.id} ${x.bounds.width}x${x.bounds.height} at ${x.bounds.x},${x.bounds.y} ${x.scaleFactor * 100}%`).join('; ')})`,
    )
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
  setRegion(box: Rect | null, view: { width: number; height: number } | null = null): void {
    const origin = alive(picker) ? picker.getBounds() : null
    if (alive(picker)) picker.destroy()
    picker = null
    if (!box || !origin) return
    // The box is in the picker page's pixels: scaled by how big the page really was against the
    // window (they differ when Windows sizes the window otherwise than asked, on a scaled display).
    const kx = view && view.width > 0 ? origin.width / view.width : 1
    const ky = view && view.height > 0 ? origin.height / view.height : 1
    const region = {
      x: Math.round(origin.x + box.x * kx),
      y: Math.round(origin.y + box.y * ky),
      width: Math.round(box.width * kx),
      height: Math.round(box.height * ky),
    }
    const d = screen.getDisplayMatching(region)
    glog(
      `region ${region.width}x${region.height} at ${region.x},${region.y}: box ${Math.round(box.width)}x${Math.round(box.height)} at ${Math.round(box.x)},${Math.round(box.y)} ` +
        `on the picker ${origin.width}x${origin.height} at ${origin.x},${origin.y} (page ${view ? `${view.width}x${view.height}` : '?'}), ` +
        `display ${d.id} ${d.bounds.width}x${d.bounds.height} at ${d.bounds.x},${d.bounds.y}, ${d.scaleFactor * 100}%`,
    )
    closeOverlay()
    settings.set('gameMap', { ...settings.get('gameMap'), region, enabled: true })
    createOverlay()
  },

  /**
   * Start over (Map V2's button): a new window, so a new screen capture and a new search from
   * scratch. The zone's detail is kept, so this takes a second or so.
   */
  restart(): void {
    glog('restarted by hand')
    closeOverlay()
    createOverlay()
  },

  /** A line from the overlay's page for the map log. */
  log(line: string): void {
    glog(`overlay: ${line.slice(0, 500)}`)
  },

  /** The map log, opened in the text editor. */
  openLog(): void {
    glog('log opened from Map V2')
    void shell.openPath(gameMapLogPath())
  },

  /** What the overlay's page last said about the game's map (shown on the Map page). */
  report(next: GameMapState): void {
    // Kept for the log: what changed, and what went wrong (each error once).
    if (next.status !== state.status || next.detail !== state.detail || next.capture !== state.capture) glog(`${next.status}, capture ${next.capture ?? '?'}, ${next.detail ?? '?'} map${next.world ? `, zone ${next.world}` : ''}`)
    if (next.error && next.error.at !== state.error?.at) glog(`${next.error.text}`)
    const merged = { ...next, preview: next.preview === undefined ? state.preview : next.preview }
    const changed = next.status !== state.status || next.world !== state.world || next.detail !== state.detail || next.mode !== state.mode || next.capture !== state.capture || next.error?.at !== state.error?.at || Math.abs(next.inliers - state.inliers) > 3
    if (changed || next.preview !== undefined) setState(merged)
    else state = merged
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
      // By the window, not the frame object: the frame may be handed over as another object.
      const fromOverlay = alive(overlay) && request.frame?.processId === overlay.webContents.mainFrame.processId && request.frame?.routingId === overlay.webContents.mainFrame.routingId
      const region = settings.get('gameMap').region
      if (!fromOverlay || !region) {
        glog(`screen capture asked for ${fromOverlay ? 'with no region picked' : 'by another window'}: refused`)
        return callback({})
      }
      const display = screen.getDisplayMatching(region)
      void desktopCapturer
        .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => {
          const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
          glog(
            `screen capture: display ${display.id} (${display.bounds.width}x${display.bounds.height} at ${display.bounds.x},${display.bounds.y}, ${display.scaleFactor * 100}%), ` +
              `screens offered ${sources.map((s) => `${s.display_id || '?'} "${s.name}"`).join(', ') || 'none'}, using ${source ? `${source.display_id || '?'} "${source.name}"` : 'none'}`,
          )
          callback(source ? { video: source } : {})
        })
        .catch((err: unknown) => {
          glog(`no screen to capture: ${String(err)}`)
          callback({})
        })
    },
    { useSystemPicker: false },
  )
}
