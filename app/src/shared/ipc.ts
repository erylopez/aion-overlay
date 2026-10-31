/**
 * The IPC contract: every channel, its arguments and its result, in one place. Main registers
 * handlers against it, preload builds the bridge from it, the renderer calls the bridge. The
 * pattern is marnis-app's (shared/ipc-contract.ts), with this app's channels.
 */
import type { Buff } from './buffs.ts'
import type { Characters } from './characters.ts'
import type { GameMapState } from './gameMap.ts'
import type { DummyState } from './dummy.ts'
import type { UpdateState } from './update.ts'
import type { KinaSession } from './kina.ts'
import type { DetailsSource, DetailsView, FightSummary, MeterData, PacketLog, PersonalView, Recordings } from './meter.ts'
import type { SyncResult } from './lokthar.ts'
import type { CustomSoundResult, SoundSlot } from './sounds.ts'
import type { Point, Rect, SettingKey, Settings } from './settings.ts'
import type { FieldBosses, TimerAlert, TimerId } from './timers.ts'
import type { Cube, Enemy, Nearby, TargetPlayer, Pet, PvpKill, ShopStock, SoulToast, TrackerStatus } from './tracker.ts'

/** Renderer → main, request/response. */
export interface InvokeChannels {
  'app:info': { args: []; result: { version: string; settingsFile: string; logFile: string } }
  'app:quit': { args: []; result: void }
  'app:openPath': { args: [path: string]; result: void }

  'settings:all': { args: []; result: Settings }
  'settings:set': { args: [key: SettingKey, value: unknown]; result: void }

  'tracker:get': { args: []; result: { status: TrackerStatus; pets: Pet[]; nearby: Nearby; shop: ShopStock[]; kina: KinaSession; fieldBosses: FieldBosses; pvp: PvpKill[]; cubes: Cube[]; enemies: Enemy[]; target: TargetPlayer | null } }
  /** Markers on the game's map: drag a box around it (opens the picker). */
  'gamemap:pick': { args: []; result: void }
  /** From the picker: the box dragged, in its own coordinates; null when cancelled. */
  'gamemap:setRegion': { args: [box: Rect | null, view?: { width: number; height: number }]; result: void }
  /** From the overlay: how the search for the game's map is going. */
  'gamemap:report': { args: [state: GameMapState]; result: void }
  'gamemap:get': { args: []; result: GameMapState }
  /** A line from the game map's overlay for its log; and that log, opened. */
  'gamemap:log': { args: [line: string]; result: void }
  'gamemap:openLog': { args: []; result: void }
  /** Start the markers on the game's map over: a new screen capture and a new search. */
  'gamemap:restart': { args: []; result: void }
  /** A zone's map at full detail (downloaded once, then kept): its keypoints, or its tiles; null while it cannot be had. */
  'gamemap:detail': { args: [key: string, cols: number, rows: number]; result: { kind: 'features'; data: ArrayBuffer } | { kind: 'tiles'; cols: number; rows: number; tiles: ArrayBuffer[] } | null }
  /** The keypoints the worker made of a zone's tiles, kept for next time. */
  'gamemap:saveFeatures': { args: [key: string, data: ArrayBuffer]; result: void }
  /** The display the region is on (the overlay cuts the region out of its picture). */
  'gamemap:display': { args: []; result: { bounds: Rect; scaleFactor: number } | null }
  /** Your characters (the Characters page). */
  'characters:get': { args: []; result: Characters }
  /** Ask NCSoft for a character's combat power and portrait again. */
  'characters:refresh': { args: [id: string]; result: void }
  /** Stop tracking a character. */
  'characters:forget': { args: [id: string]; result: void }
  /** Empty the PvP log. */
  'tracker:clearPvp': { args: []; result: void }
  'tracker:setSouls': { args: [pet: number, souls: number]; result: void }
  'tracker:setName': { args: [pet: number, name: string]; result: void }
  'tracker:restart': { args: []; result: void }
  /** Start the session again: its souls and its Kina. */
  'tracker:resetSession': { args: []; result: void }

  'bubble:moveTo': { args: [to: Point]; result: void }
  'bubble:dragEnd': { args: []; result: void }
  'panel:toggle': { args: []; result: void }
  'panel:hide': { args: []; result: void }
  'panel:minimize': { args: []; result: void }
  /** Maximise the dashboard, or back from maximised. */
  'panel:maximize': { args: []; result: void }

  'hud:setEditing': { args: [editing: boolean]; result: void }
  'hud:moveTo': { args: [to: Point]; result: void }
  'hud:dragEnd': { args: []; result: void }
  'hud:resize': { args: [size: { width: number; height: number }]; result: void }
  'merchant:moveTo': { args: [to: Point]; result: void }
  'merchant:dragEnd': { args: []; result: void }
  'merchant:resize': { args: [size: { width: number; height: number }]; result: void }
  'merchant:close': { args: []; result: void }
  /** The timers' countdown bar over the game. */
  'timerbar:moveTo': { args: [to: Point]; result: void }
  'timerbar:dragEnd': { args: []; result: void }
  'timerbar:resize': { args: [size: { width: number; height: number }]; result: void }
  /** The kill feed over the game: opened from the PvP page, closed there or with its X. */
  'killfeed:open': { args: []; result: void }
  'killfeed:close': { args: []; result: void }
  'killfeed:moveTo': { args: [to: Point]; result: void }
  'killfeed:dragEnd': { args: []; result: void }
  'killfeed:resize': { args: [size: { width: number; height: number }]; result: void }
  /** The timers alerting now; and dismissing them (a click on the bubble). */
  'timers:get': { args: []; result: TimerAlert[] }
  'timers:dismiss': { args: []; result: void }
  /** The bubble was clicked during an alert: dismiss it and show its timer in the panel. */
  'timers:open': { args: []; result: void }
  /** Open the panel on a pet's drop locations (from the merchant window). */
  'panel:showPet': { args: [pet: number]; result: void }
  /** The DPS meter: the fight as it stands. */
  'meter:get': { args: []; result: MeterData }
  /** Start the fight over: no target, no damage. */
  'meter:reset': { args: []; result: void }
  /** One target's breakdown by skill (A2Tools DPS Meter's TargetDetailsResponse). */
  /** The map overlay. */
  'minimap:moveTo': { args: [to: Point]; result: void }
  'minimap:dragEnd': { args: []; result: void }
  'minimap:resize': { args: [size: { width: number; height: number }]; result: void }
  /** Your own skills on the meter's target (the skills window). */
  'skills:get': { args: []; result: PersonalView }
  'skills:moveTo': { args: [to: Point]; result: void }
  'skills:dragEnd': { args: []; result: void }
  'skills:resize': { args: [size: { width: number; height: number }]; result: void }
  /** Every overlay off, or back on (Alt+Shift+E): true when off; and whether they are off now. */
  'overlays:toggle': { args: []; result: boolean }
  'overlays:hidden': { args: []; result: boolean }
  /** The engine's recordings of the game's traffic: the list, start or stop, and their folder. */
  'recordings:get': { args: []; result: Recordings }
  'recordings:set': { args: [on: boolean]; result: void }
  'recordings:open': { args: []; result: void }
  /** The packet log (Settings → Developer): its state, start or stop, a mark, its file shown. */
  'packets:get': { args: []; result: PacketLog }
  'packets:set': { args: [on: boolean]; result: void }
  'packets:mark': { args: [text: string]; result: void }
  'packets:show': { args: []; result: void }
  /** Choose an mp3 for an alert's sound: it is copied into the data folder. */
  'sounds:pickCustom': { args: [slot: SoundSlot]; result: CustomSoundResult }
  /** That mp3's bytes, to play (null: none chosen). */
  'sounds:custom': { args: [slot: SoundSlot]; result: Uint8Array | null }
  /** App updates, by hand: the state, look for one, download it, restart to install it. */
  'update:get': { args: []; result: UpdateState }
  /** The newest release's version, nothing downloaded (the Updates page opened). */
  'update:peek': { args: []; result: void }
  'update:check': { args: []; result: void }
  'update:download': { args: []; result: void }
  'update:install': { args: []; result: void }
  /** Training dummy runs: the runs and the one going on; start, stop, a new group, delete. */
  'dummy:get': { args: []; result: DummyState }
  /** Start a run (the settings' goal), named or the next "Run N"; stop it, saved or dropped. */
  'dummy:start': { args: [name?: string]; result: void }
  'dummy:stop': { args: [save: boolean]; result: void }
  'dummy:newGroup': { args: []; result: void }
  'dummy:delete': { args: [id: string]; result: void }
  /** Your buffs and debuffs (the buffs overlay). */
  'buffs:get': { args: []; result: Buff[] }
  'buffs:moveTo': { args: [to: Point]; result: void }
  'buffs:dragEnd': { args: []; result: void }
  'buffs:resize': { args: [size: { width: number; height: number }]; result: void }
  /** The Training overlay. */
  'training:moveTo': { args: [to: Point]; result: void }
  'training:dragEnd': { args: []; result: void }
  'training:resize': { args: [size: { width: number; height: number }]; result: void }
  /** The CC / Debuffs banner. */
  'cc:moveTo': { args: [to: Point]; result: void }
  'enemies:moveTo': { args: [to: Point]; result: void }
  'enemies:dragEnd': { args: []; result: void }
  'enemies:resize': { args: [size: { width: number; height: number }]; result: void }
  'cc:dragEnd': { args: []; result: void }
  'cc:resize': { args: [size: { width: number; height: number }]; result: void }
  /** The packet log's pill over the game. */
  'packets:resize': { args: [size: { width: number; height: number }]; result: void }
  /** Open the Details window on a fight (a meter row, a saved fight), or what it shows now. */
  'details:open': { args: [source: DetailsSource]; result: void }
  'details:get': { args: []; result: DetailsView | null }
  'details:close': { args: []; result: void }
  'details:moveTo': { args: [to: Point]; result: void }
  'details:dragEnd': { args: []; result: void }
  /** The saved boss fights, newest first; and deleting one. */
  'history:list': { args: []; result: FightSummary[] }
  'history:delete': { args: [id: string]; result: void }
  'meter:moveTo': { args: [to: Point]; result: void }
  'meter:dragEnd': { args: []; result: void }
  'meter:resize': { args: [size: { width: number; height: number }]; result: void }
  /** The Lokthar sync: check the address and token; the last attempt's outcome. */
  'lokthar:test': { args: []; result: SyncResult }
  'lokthar:sync': { args: []; result: SyncResult }
  'lokthar:last': { args: []; result: SyncResult | null }
}

/** Main → renderer, broadcast. */
export interface EventChannels {
  'settings:changed': Settings
  'tracker:status': TrackerStatus
  'tracker:pets': Pet[]
  'tracker:pet': Pet
  'tracker:soul': SoulToast
  'tracker:nearby': Nearby
  /** The Hidden Cubes in view, whenever they change. */
  'tracker:cubes': Cube[]
  'tracker:enemies': Enemy[]
  'tracker:target': TargetPlayer | null
  /** You killed something (at most every 5 s): keeps the HUD up between souls. */
  'tracker:combat': number
  /** The merchant's stock: the latest of each tab opened, until its restock. */
  'tracker:shop': ShopStock[]
  /** This session's Kina, whenever the balance changes. */
  'tracker:kina': KinaSession
  /** The whole PvP log (a window opening, or a Clear); then each kill as it comes. */
  'tracker:pvp': PvpKill[]
  'tracker:pvpKill': PvpKill
  /** The field bosses, whenever the map's list changes them. */
  'tracker:fieldBosses': FieldBosses
  /** The search for the game's map, when it changes. */
  'gamemap:state': GameMapState
  /** Your characters, whenever one changes. */
  'characters:changed': Characters
  /** A timer started alerting (once per start: the chime). */
  'timers:alert': TimerAlert
  /** Every timer alerting now (the bubble shakes while there are any). */
  'timers:alerting': TimerAlert[]
  /** To the panel: show this pet's drop locations. */
  'panel:showPet': number
  /** To the panel: show the Event Alerts and Field Bosses pages and highlight these timers (the ones that alerted). */
  'panel:showTimers': TimerId[]
  'hud:editing': boolean
  'panel:visible': boolean
  /** The dashboard was maximised (true) or restored. */
  'panel:maximized': boolean
  /** The fight, as the engine last reported it (checked 5 times a second, sent on change). */
  'meter:dps': MeterData
  /** The Details window was pointed at another fight. */
  'details:source': DetailsSource
  /** Boss fights were saved or deleted. */
  'history:changed': number
  /** What is on your character, whenever it changes (while the buffs overlay is on). */
  'buffs:list': Buff[]
  /** An update check or download moved on. */
  'update:state': UpdateState
  /** The training dummy runs changed, or the one going on moved. */
  'dummy:state': DummyState
  /** A recording started or stopped. */
  'recordings:changed': Recordings
  /** The packet log started, stopped or was marked. */
  'packets:state': PacketLog
  /** The overlays were hidden by hand (true) or shown again. */
  'overlays:hidden': boolean
}

export type InvokeChannel = keyof InvokeChannels
export type EventChannel = keyof EventChannels
export type InvokeArgs<C extends InvokeChannel> = InvokeChannels[C]['args']
export type InvokeResult<C extends InvokeChannel> = InvokeChannels[C]['result']
export type EventPayload<C extends EventChannel> = EventChannels[C]

/** What preload exposes as `window.a2t`. */
export interface Bridge {
  invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResult<C>>
  on<C extends EventChannel>(channel: C, listener: (payload: EventPayload<C>) => void): () => void
}

export const INVOKE_CHANNELS: readonly InvokeChannel[] = [
  'app:info', 'app:quit', 'app:openPath',
  'settings:all', 'settings:set',
  'tracker:get', 'gamemap:pick', 'gamemap:setRegion', 'gamemap:report', 'gamemap:get', 'gamemap:log', 'gamemap:openLog', 'gamemap:restart', 'gamemap:detail', 'gamemap:saveFeatures', 'gamemap:display', 'characters:get', 'characters:refresh', 'characters:forget', 'tracker:setSouls', 'tracker:setName', 'tracker:restart', 'tracker:resetSession', 'tracker:clearPvp',
  'killfeed:open', 'killfeed:close', 'killfeed:moveTo', 'killfeed:dragEnd', 'killfeed:resize',
  'timerbar:moveTo', 'timerbar:dragEnd', 'timerbar:resize',
  'bubble:moveTo', 'bubble:dragEnd', 'panel:toggle', 'panel:hide', 'panel:minimize', 'panel:maximize',
  'hud:setEditing', 'hud:moveTo', 'hud:dragEnd', 'hud:resize',
  'merchant:moveTo', 'merchant:dragEnd', 'merchant:resize', 'merchant:close', 'panel:showPet', 'timers:get', 'timers:dismiss', 'timers:open',
  'lokthar:test', 'lokthar:sync', 'lokthar:last',
  'meter:get', 'meter:reset', 'meter:moveTo', 'meter:dragEnd', 'meter:resize',
  'minimap:moveTo', 'minimap:dragEnd', 'minimap:resize',
  'skills:get', 'skills:moveTo', 'skills:dragEnd', 'skills:resize',
  'buffs:get', 'buffs:moveTo', 'buffs:dragEnd', 'buffs:resize', 'cc:moveTo', 'cc:dragEnd', 'cc:resize', 'enemies:moveTo', 'enemies:dragEnd', 'enemies:resize', 'training:moveTo', 'training:dragEnd', 'training:resize', 'overlays:toggle', 'overlays:hidden', 'recordings:get', 'recordings:set', 'recordings:open', 'packets:get', 'packets:set', 'packets:mark', 'packets:show', 'packets:resize', 'sounds:pickCustom', 'sounds:custom', 'update:get', 'update:peek', 'update:check', 'update:download', 'update:install', 'dummy:get', 'dummy:start', 'dummy:stop', 'dummy:newGroup', 'dummy:delete',
  'details:open', 'details:get', 'details:close', 'details:moveTo', 'details:dragEnd', 'history:list', 'history:delete',
]

export const EVENT_CHANNELS: readonly EventChannel[] = [
  'settings:changed', 'tracker:status', 'tracker:pets', 'tracker:pet', 'tracker:soul', 'tracker:nearby', 'tracker:cubes', 'tracker:enemies', 'tracker:target', 'tracker:combat', 'tracker:shop', 'tracker:kina', 'tracker:fieldBosses', 'characters:changed', 'gamemap:state', 'tracker:pvp', 'tracker:pvpKill', 'panel:showPet', 'panel:showTimers', 'timers:alert', 'timers:alerting', 'hud:editing', 'panel:visible', 'panel:maximized', 'meter:dps', 'details:source', 'history:changed', 'buffs:list', 'overlays:hidden', 'recordings:changed', 'packets:state', 'dummy:state', 'update:state',
]
