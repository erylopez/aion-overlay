/**
 * The engine (engine/, Rust) as a child process, and the state the windows render from: the pets,
 * the tracker's status, and souls as they arrive. The engine captures the game's traffic, runs
 * A2Tools DPS Meter's parser on it for the meter (main/meter.ts), and tracks the collection.
 *
 * The protocol is JSON lines both ways (engine/src/sidecar.rs documents it). The process is
 * restarted with a backoff if it dies, and killed synchronously when the app exits: on Windows a
 * child outlives its parent otherwise (a marnis-app lesson).
 *
 * Environment overrides, for development:
 *   A2T_ENGINE        the engine executable; <repo>/engine/target/{release,debug}/ otherwise
 *   A2T_REPLAY        a .pcap, .pcapng or A2Tools packet log to replay instead of watching the
 *                     game, to try the UI without it
 *   A2T_REPLAY_SPEED  its speed, as a multiple of real time (default 1)
 */
import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DISPLAY_NAME } from '../shared/app.ts'
import { broadcast } from './broadcast.ts'
import { settings } from './settings.ts'
import { kinaBalance, kinaRebase, NO_KINA, type KinaSession } from '../shared/kina.ts'
import { bossKilled, fieldBosses } from './fieldBosses.ts'
import type { FieldBosses } from '../shared/timers.ts'
import { pvpLog } from './pvpLog.ts'
import { serverFaction, serverRegion } from '../shared/servers.ts'
import { GAME_ACTIVE_S, NO_NEARBY, type Cube, type Enemy, type Nearby, type TargetPlayer, type Pet, type PvpKill, type ShopItem, type ShopStock, type SoulToast, type TrackerStatus } from '../shared/tracker.ts'
import { tr } from './i18n.ts'

const RESTART_DELAYS_MS = [1000, 3000, 10000, 30000]
const EXE = process.platform === 'win32' ? 'lokthar-engine.exe' : 'lokthar-engine'

let child: ChildProcessWithoutNullStreams | null = null
/** Whether the sidecar should be capturing: only while the game runs (see idle.ts). */
let capturing = true
let stopping = false
let restarts = 0
let restartTimer: NodeJS.Timeout | null = null
let stderrTail: string[] = []
const pets = new Map<number, Pet>()
let nearby: Nearby = NO_NEARBY
/** The Hidden Cubes in view, as the engine last listed them. */
let cubes: Cube[] = []
/** Players of the other faction in view, as the engine last listed them. */
let enemies: Enemy[] = []
/** The player you last targeted. */
let target: TargetPlayer | null = null
/** The Black Cloud Merchant's stock: the latest of each tab opened, kept until its restock or another character. */
const shopTabs = new Map<number, ShopStock>()
const currentShop = (): ShopStock[] => {
  const now = Date.now()
  for (const [tab, s] of shopTabs) if (s.nextAt !== null && s.nextAt <= now) shopTabs.delete(tab)
  return [...shopTabs.values()]
}
/** Kina earned since the app started (or the last reset). */
let kina: KinaSession = NO_KINA
function setKina(next: KinaSession): void {
  kina = next
  broadcast('tracker:kina', kina)
}
const soulListeners = new Set<(toast: SoulToast) => void>()
const statusListeners = new Set<(status: TrackerStatus) => void>()
const shopListeners = new Set<(stock: ShopStock[]) => void>()
/** Other modules' handlers for the engine's events, by type (the meter's, the kill feed's). */
const eventListeners = new Map<string, Set<(ev: Record<string, unknown>) => void>>()

let status: TrackerStatus = {
  state: 'starting',
  detail: null,
  lastPacketAgo: null,
  gameActive: false,
  replay: false,
  synced: null,
  dataFile: null,
  character: null,
  server: null,
  level: null,
  npcapMissing: false,
}

/**
 * `<userData>/logs/tracker.log`: what the tracker said on stderr and every state change, started
 * afresh each launch. For testers to send when something goes wrong.
 */
export function logPath(): string {
  return join(app.getPath('userData'), 'logs', 'tracker.log')
}
let logReady = false
export function log(line: string): void {
  try {
    if (!logReady) {
      mkdirSync(dirname(logPath()), { recursive: true })
      writeFileSync(logPath(), `${DISPLAY_NAME} ${app.getVersion()} (${app.isPackaged ? 'installed' : 'development'})\n`)
      logReady = true
    }
    appendFileSync(logPath(), `${new Date().toISOString()} ${line}\n`)
  } catch {
    // A log that cannot be written must not stop the tracker.
  }
}

function setStatus(patch: Partial<TrackerStatus>): void {
  if ((patch.state && patch.state !== status.state) || (patch.detail && patch.detail !== status.detail)) {
    log(`status: ${patch.state ?? status.state}${patch.detail ? ` (${patch.detail})` : ''}`)
  }
  status = { ...status, ...patch }
  status.gameActive = status.lastPacketAgo !== null && status.lastPacketAgo < GAME_ACTIVE_S
  broadcast('tracker:status', status)
  for (const fn of statusListeners) fn(status)
}

/** The repo's engine build, searched upwards from the app: release, then debug. */
function devEngine(): string | null {
  let dir = resolve(app.getAppPath())
  for (let i = 0; i < 6; i++) {
    for (const profile of ['release', 'debug']) {
      const exe = join(dir, 'engine', 'target', profile, EXE)
      if (existsSync(exe)) return exe
    }
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}

/** The collection file: <userData>/collection.json unless set. */
function dataFile(): string {
  return settings.get('tracker').dataFile || join(app.getPath('userData'), 'collection.json')
}

/** Npcap is what the tracker captures with; it cannot be bundled, so each user installs it. */
export function npcapInstalled(): boolean {
  const system = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32')
  return existsSync(join(system, 'Npcap', 'wpcap.dll')) || existsSync(join(system, 'wpcap.dll'))
}

/** What to run: the packaged engine (resources/engine) installed, the repo's build in development. */
function engineCommand(): string | { error: string } {
  if (app.isPackaged) {
    const packaged = join(process.resourcesPath, 'engine', EXE)
    return existsSync(packaged) ? packaged : { error: `The engine is missing from the install (${packaged}). Reinstall the app.` }
  }
  return process.env['A2T_ENGINE'] ?? devEngine() ?? { error: 'No engine build found: run `cargo build --release` in engine/ (or set A2T_ENGINE).' }
}

let npcapTimer: NodeJS.Timeout | null = null

/**
 * Whether Npcap is there, from the app's start (the tracker itself only starts with the game) and
 * again every few seconds while it is missing: once it is installed the tracker starts by itself,
 * with no restart of the app, and the checks stop.
 */
export function startNpcapWatch(): void {
  if (process.env['A2T_REPLAY'] || npcapTimer) return
  const check = (): void => {
    if (npcapInstalled()) {
      if (npcapTimer) clearInterval(npcapTimer)
      npcapTimer = null
      if (!status.npcapMissing) return
      log('npcap: installed')
      setStatus({ npcapMissing: false })
      if (status.state === 'error') startTracker()
    } else if (!status.npcapMissing) {
      log('npcap: not installed')
      setStatus({ npcapMissing: true })
    }
  }
  check()
  if (status.npcapMissing) npcapTimer = setInterval(check, 3000)
}

export function startTracker(): void {
  if (child) return
  stopping = false
  const replay = process.env['A2T_REPLAY']
  if (!replay && !npcapInstalled()) {
    setStatus({
      state: 'error',
      npcapMissing: true,
      detail: tr('Npcap is not installed. Install it from https://npcap.com (the default options are fine): the overlay starts by itself once it is there.'),
    })
    return
  }
  const exe = engineCommand()
  if (typeof exe !== 'string') {
    setStatus({ state: 'error', detail: exe.error })
    return
  }
  const data = dataFile()
  // The app's own windows in front count as the game's (the engine's focus events).
  const args = ['--data', data, '--app-pid', String(process.pid)]
  if (replay) args.push('--replay', replay, '--speed', process.env['A2T_REPLAY_SPEED'] ?? '1')
  else if (!capturing) args.push('--paused')

  stderrTail = []
  setStatus({ state: 'starting', detail: null, dataFile: data, replay: Boolean(replay), lastPacketAgo: null })
  const proc = spawn(exe, args, { cwd: dirname(exe), windowsHide: true })
  child = proc

  let buffer = ''
  proc.stdout.setEncoding('utf8')
  proc.stdout.on('data', (chunk: string) => {
    buffer += chunk
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line) handleLine(line)
    }
  })
  proc.stderr.setEncoding('utf8')
  proc.stderr.on('data', (chunk: string) => {
    const lines = chunk.split(/\r?\n/).filter(Boolean)
    for (const line of lines) log(`engine: ${line}`)
    stderrTail = [...stderrTail, ...lines].slice(-20)
  })
  proc.on('error', (err) => {
    setStatus({ state: 'error', detail: `Could not start the engine: ${err.message}` })
  })
  proc.on('exit', (code) => {
    if (child === proc) child = null
    if (stopping) return
    const why = stderrTail.at(-1) ?? `exit code ${code}`
    if (restarts >= RESTART_DELAYS_MS.length) {
      setStatus({ state: 'error', detail: `The engine keeps stopping: ${why}` })
      return
    }
    const delay = RESTART_DELAYS_MS[restarts++]!
    setStatus({ state: 'exited', detail: `Engine stopped (${why}); restarting in ${delay / 1000}s` })
    restartTimer = setTimeout(startTracker, delay)
  })
}

function handleLine(line: string): void {
  let ev: Record<string, unknown>
  try {
    ev = JSON.parse(line)
  } catch {
    stderrTail = [...stderrTail, `unparsed: ${line}`].slice(-20)
    return
  }
  for (const fn of eventListeners.get(ev['type'] as string) ?? []) fn(ev)
  switch (ev['type']) {
    case 'ready':
      restarts = 0
      // A (re)started engine knows no one in view yet.
      enemies = []
      broadcast('tracker:enemies', enemies)
      replacePets(ev['pets'] as Pet[])
      setStatus({
        character: (ev['character'] as { name: string } | null)?.name ?? null,
        server: (ev['character'] as { server?: number } | null)?.server ?? null,
      })
      learnServer(status.server)
      fieldBosses.setServer((ev['character'] as { server?: number } | null)?.server ?? null)
      break
    case 'character': {
      // Another character entered the world: its own collection (pet levels are per character).
      const name = ev['name'] as string
      log(`character: ${name}${ev['server'] ? ` (server ${ev['server']})` : ''}${ev['switched'] ? ', switched collection' : ''}`)
      replacePets(ev['pets'] as Pet[])
      // Each character has its own Black Cloud Merchant stock: the last one's is not this one's.
      if (name !== status.character && shopTabs.size) {
        shopTabs.clear()
        log('merchant: stock cleared (another character)')
        // Not to the shop listeners: they open the merchant window, for a tab just opened.
        broadcast('tracker:shop', currentShop())
      }
      setStatus({ character: name, server: (ev['server'] as number | undefined) ?? null })
      learnServer(status.server)
      fieldBosses.setServer((ev['server'] as number | undefined) ?? null)
      break
    }
    case 'status': {
      const state = ev['state'] as TrackerStatus['state']
      const detail = state === 'locked' ? `Game server ${ev['server']}` : ((ev['detail'] as string | undefined) ?? null)
      // Paused, the heartbeats stop: the last one must not keep saying the game is active.
      setStatus(state === 'idle' ? { state, detail, lastPacketAgo: null } : { state, detail })
      break
    }
    case 'player': {
      // Your level, as the game's record of you says: kept for the Nearby marks.
      const level = ev['level'] as number
      setStatus({ level })
      if (settings.get('playerLevel') !== level) settings.set('playerLevel', level)
      break
    }
    case 'heartbeat':
      setStatus({ lastPacketAgo: ev['lastPacketAgo'] as number | null })
      break
    case 'sync': {
      log(`login sync: ${ev['pets']} pets, ${ev['souls']} souls`)
      // Entering the world, maybe as another character: its Kina is a new starting point.
      setKina(kinaRebase(kina))
      replacePets(ev['collection'] as Pet[])
      setStatus({ synced: { at: Date.now(), pets: ev['pets'] as number, souls: ev['souls'] as number } })
      break
    }
    case 'soul': {
      const pet = ev['pet'] as Pet
      updatePet(pet)
      // Every soul, with the running totals: what to compare against when counts look wrong.
      const sessionTotal = [...pets.values()].reduce((n, p) => n + p.session, 0)
      log(`soul: +${ev['amount']} pet ${pet.id}${pet.name ? ` (${pet.name})` : ''} -> ${pet.souls} souls; session ${pet.session} for this pet, ${sessionTotal} in all`)
      const toast: SoulToast = {
        pet,
        amount: ev['amount'] as number,
        at: Date.now(),
        levelUp: ev['levelUp'] === true,
        crystal: false,
      }
      if (toast.levelUp) log(`level up: pet ${pet.id}${pet.name ? ` (${pet.name})` : ''} is now Lv${pet.level}`)
      broadcast('tracker:soul', toast)
      for (const fn of soulListeners) fn(toast)
      break
    }
    case 'crystal': {
      // Genus crystals: the pet is maxed. No pet when none of the kills just before could be it;
      // the kills it considered are logged then, and the raw body always.
      const pet = ev['pet'] as Pet | null
      const kills = (ev['kills'] as { npc: number | null; name: string | null; pet: number | null; ago: number }[] | undefined) ?? []
      const considered = kills.length
        ? kills.map((k) => `${k.name ?? `monster ${k.npc ?? '?'}`}${k.pet ? ` (pet ${k.pet})` : ' (no pet)'} ${k.ago}s before`).join(', ')
        : 'no kill just before'
      log(`crystal: +${ev['amount']} ${ev['genus'] ?? 'unknown genus'} ${pet ? `pet ${pet.id}${pet.name ? ` (${pet.name})` : ''} -> ${pet.crystals} crystals` : `credited to no pet; kills: ${considered}`} [${ev['raw']}]`)
      if (ev['levelCorrected'] === true && pet) log(`level: pet ${pet.id}${pet.name ? ` (${pet.name})` : ''} is at Lv${pet.level} in game (it gets crystals): corrected`)
      if (!pet) break
      updatePet(pet)
      const toast: SoulToast = { pet, amount: ev['amount'] as number, at: Date.now(), levelUp: false, crystal: true }
      broadcast('tracker:soul', toast)
      for (const fn of soulListeners) fn(toast)
      break
    }
    case 'combat':
      broadcast('tracker:combat', Date.now())
      break
    case 'cubes': {
      const before = new Map(cubes.map((c) => [c.id, c.seenAt]))
      const now = Date.now()
      cubes = (ev['cubes'] as Omit<Cube, 'seenAt'>[]).map((c) => ({ ...c, seenAt: before.get(c.id) ?? now }))
      for (const c of cubes) if (!before.has(c.id)) log(`hidden cube ${c.id} (template ${c.template}) at ${c.position.join(', ')}`)
      broadcast('tracker:cubes', cubes)
      break
    }
    case 'enemies': {
      const before = new Set(enemies.map((e) => e.entity))
      enemies = (ev['players'] as Enemy[] | undefined) ?? []
      for (const e of enemies) if (!before.has(e.entity)) log(`enemy in view: ${e.name}${e.server ? ` (${e.server})` : ''}${e.legion ? ` <${e.legion}>` : ''}`)
      broadcast('tracker:enemies', enemies)
      break
    }
    case 'target': {
      target = {
        name: ev['name'] as string,
        server: ev['server'] as number,
        level: ev['level'] as number,
        gearScore: ev['gearScore'] as number,
        combatPower: (ev['combatPower'] as number | null) ?? null,
        className: (ev['className'] as string | null) ?? null,
        legion: (ev['legion'] as string | null) ?? null,
        enemy: ev['enemy'] === true,
        at: Date.now(),
      }
      broadcast('tracker:target', target)
      break
    }
    case 'pvpKill': {
      const kill: PvpKill = {
        at: Date.now(),
        killer: ev['killer'] as PvpKill['killer'],
        victim: (ev['victim'] as PvpKill['victim']) ?? null,
        mine: ev['mine'] === true,
        died: ev['died'] === true,
        legion: ev['legion'] === true,
        fight: (ev['fight'] as string | null | undefined) ?? null,
      }
      if (kill.died && nearby.world !== null && nearby.position) kill.place = { world: nearby.world, position: nearby.position }
      pvpLog.add(kill)
      log(`pvp: ${kill.killer.name} (${kill.killer.server}) killed ${kill.victim ? `${kill.victim.name} (${kill.victim.server ?? '?'})` : 'a player out of view'}${kill.mine ? ' [you]' : kill.died ? ' [you died]' : ''}`)
      break
    }
    case 'fieldBosses':
      fieldBosses.fromMap(ev['world'] as number, ev['bosses'] as { id: number; up: boolean; at: number }[])
      break
    case 'bossKilled':
      bossKilled(ev['npc'] as number)
      break
    case 'kina':
      setKina(kinaBalance(kina, ev['balance'] as number, Date.now()))
      break
    case 'shop': {
      const stock: ShopStock = {
        tab: ev['tab'] as number,
        nextAt: (ev['nextAt'] as number | null) ?? null,
        at: Date.now(),
        items: ev['items'] as ShopItem[],
      }
      shopTabs.set(stock.tab, stock)
      const restock = stock.nextAt ? new Date(stock.nextAt).toISOString().slice(11, 16) + ' UTC' : 'unknown'
      log(`merchant: tab ${stock.tab}, ${stock.items.length} items (${stock.items.map((i) => `${i.item}@${i.price}`).join(' ')}); restocks ${restock}`)
      broadcast('tracker:shop', currentShop())
      for (const fn of shopListeners) fn(currentShop())
      break
    }
    case 'pet':
      updatePet(ev['pet'] as Pet)
      break
    case 'snapshot':
      replacePets(ev['pets'] as Pet[])
      break
    case 'nearby': {
      const position = ev['position'] as Nearby['position']
      // Stamped here, on change only: the helper resends the same position with every Nearby update.
      const moved = String(position) !== String(nearby.position) || ev['world'] !== nearby.world
      nearby = {
        world: ev['world'] as number | null,
        position,
        positionAt: position ? (moved ? Date.now() : nearby.positionAt) : null,
        monsters: ev['monsters'] as Nearby['monsters'],
      }
      broadcast('tracker:nearby', nearby)
      break
    }
    case 'error':
      stderrTail = [...stderrTail, `sidecar: ${ev['detail']}`].slice(-20)
      break
  }
}

/**
 * Your side and your timers' region follow from your server, and are kept in the settings: the
 * last ones seen stand for an app started mid-session, before the game names you.
 */
function learnServer(server: number | null): void {
  if (server === null) return
  const faction = serverFaction(server)
  if (faction && settings.get('faction') !== faction) settings.set('faction', faction)
  const region = serverRegion(server)
  const timers = settings.get('timers')
  if (region && timers.region !== region) settings.set('timers', { ...timers, region })
}

function replacePets(list: Pet[]): void {
  pets.clear()
  for (const p of list) pets.set(p.id, p)
  broadcast('tracker:pets', [...pets.values()])
}

function updatePet(pet: Pet): void {
  pets.set(pet.id, pet)
  broadcast('tracker:pet', pet)
}

export function command(cmd: Record<string, unknown>): void {
  if (child?.stdin.writable) child.stdin.write(JSON.stringify(cmd) + '\n')
}

export const tracker = {
  status: (): TrackerStatus => status,
  pets: (): Pet[] => [...pets.values()],
  nearby: (): Nearby => nearby,
  cubes: (): Cube[] => cubes,
  enemies: (): Enemy[] => enemies,
  target: (): TargetPlayer | null => target,
  shop: (): ShopStock[] => currentShop(),
  kina: (): KinaSession => kina,
  fieldBosses: (): FieldBosses => fieldBosses.all(),
  pvp: (): PvpKill[] => pvpLog.all(),
  clearPvp: (): void => pvpLog.clear(),
  /** Start the session again: the souls (the helper answers with every pet) and the Kina. */
  resetSession(): void {
    log('session reset')
    command({ cmd: 'resetSession' })
    setKina({ ...NO_KINA, balance: kina.balance, gains: [] })
  },
  setSouls: (pet: number, souls: number): void => command({ cmd: 'set', pet, souls }),
  setName: (pet: number, name: string): void => command({ cmd: 'name', pet, name }),
  onSoul(fn: (toast: SoulToast) => void): () => void {
    soulListeners.add(fn)
    return () => soulListeners.delete(fn)
  },
  /** A tab of the Black Cloud Merchant was opened: its stock (with the other tabs'). */
  onShop(fn: (stock: ShopStock[]) => void): () => void {
    shopListeners.add(fn)
    return () => shopListeners.delete(fn)
  },
  onStatus(fn: (status: TrackerStatus) => void): () => void {
    statusListeners.add(fn)
    return () => statusListeners.delete(fn)
  },
  /** Handle the engine's events of this type too (after the tracker's own handling). */
  onEvent(type: string, fn: (ev: Record<string, unknown>) => void): () => void {
    if (!eventListeners.has(type)) eventListeners.set(type, new Set())
    eventListeners.get(type)!.add(fn)
    return () => eventListeners.get(type)?.delete(fn)
  },
  /** The sidecar process is up (capturing or not). */
  running: (): boolean => child !== null,
  /**
   * Capture or not. A running sidecar is told; one that is not running starts when capture is
   * wanted, and otherwise is left off.
   */
  setCapture(on: boolean): void {
    const changed = capturing !== on
    capturing = on
    if (changed) log(`capture ${on ? 'on' : 'off'}`)
    if (child) {
      if (changed) command({ cmd: 'capture', on })
    } else if (on) startTracker()
    else setStatus({ state: 'idle', detail: null, lastPacketAgo: null })
  },
  restart(): void {
    restarts = 0
    stopTracker()
    startTracker()
  },
}

/** Ask the sidecar to quit, and make sure it is gone. Safe to call from `process.on('exit')`. */
export function stopTracker(): void {
  stopping = true
  pvpLog.flush()
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = null
  const proc = child
  child = null
  if (!proc) return
  try {
    proc.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n')
    proc.stdin.end()
  } catch {
    // already closed
  }
  // A capture thread may be blocked in Npcap; a quit it cannot act on promptly is a kill.
  setTimeout(() => proc.exitCode === null && proc.kill(), 1500).unref()
}

/** For process exit, where timers never fire. */
export function killTrackerNow(): void {
  stopping = true
  pvpLog.flush()
  if (child && child.exitCode === null) child.kill()
  child = null
}
