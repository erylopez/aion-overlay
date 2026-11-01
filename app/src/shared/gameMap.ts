/** Markers on the game's own map (main/gameMap.ts): how the search for the game's map is going. */
export interface GameMapState {
  /**
   * off: no overlay; nomap: no picture of your zone to match; searching: the game's map is not on
   * the screen (or not found yet); found: it is, and the markers are on it.
   */
  status: 'off' | 'nomap' | 'searching' | 'found'
  /** The zone matched against (questlog.gg world id). */
  world: number | null
  /** How many points agreed on where the map is (more is surer). */
  inliers: number
  /** Or, found by comparing the picture whole, how well it compared (0 to 100). */
  score?: number
  /** How long a match takes, in ms. */
  ms: number
  /**
   * The map matched against: the one the app ships, the game's own at full detail, or that one
   * being downloaded (once per zone; the shipped one is used meanwhile).
   */
  detail?: 'shipped' | 'loading' | 'ready'
  /** How the last picture was placed: local, flow, near, zone; wait or error when it was not. */
  mode?: string
  /** The last thing that went wrong (capture, OpenCV), and when. */
  error?: { at: number; text: string } | null
  /** The screen capture: being started, running, running the slow way (the stream gave no pictures), or not to be had (see the map log). */
  capture?: 'starting' | 'on' | 'slow' | 'failed'
  /** Pictures taken since the overlay opened. */
  pictures?: number
  /** What the overlay sees, now and then: a small JPEG (Map V2 shows it). */
  preview?: string | null
}
